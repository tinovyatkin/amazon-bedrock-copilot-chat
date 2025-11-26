import type { BedrockClientConfig } from "@aws-sdk/client-bedrock";
import {
  AccessDeniedException,
  BedrockClient,
  GetFoundationModelAvailabilityCommand,
  GetInferenceProfileCommand,
  ListFoundationModelsCommand,
  ModelModality,
  paginateListInferenceProfiles,
  ResourceNotFoundException,
} from "@aws-sdk/client-bedrock";
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  CountTokensCommand,
  type CountTokensCommandInput,
  AccessDeniedException as RuntimeAccessDeniedException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@aws-sdk/types";
import type { TokenIdentity, TokenIdentityProvider } from "@smithy/types";
import { AdaptiveRetryStrategy, DefaultRateLimiter } from "@smithy/util-retry";
import * as nodeNativeFetch from "smithy-node-native-fetch";

import { logger } from "./logger";
import type { AuthConfig, BedrockModelSummary } from "./types";

export class BedrockAPIClient {
  private authConfig?: AuthConfig;
  private bedrockClient: BedrockClient;
  private bedrockRuntimeClient: BedrockRuntimeClient;
  // Tracks base model IDs detected when no inference profile is accessible
  private readonly fallbackBaseModelIds = new Set<string>();
  // Tracks which inference profile IDs we were able to detect when ListFoundationModels is denied
  private readonly fallbackInferenceProfileIds = new Set<string>();
  // Cache for inference profile ID -> base model ID mappings
  // This avoids repeated API calls to GetInferenceProfile
  private readonly inferenceProfileCache = new Map<string, string>();
  private profileName?: string;

  private region: string;

  constructor(region: string, profileName?: string) {
    this.region = region;
    this.profileName = profileName;
    this.bedrockClient = new BedrockClient(this.getClientConfig());
    this.bedrockRuntimeClient = new BedrockRuntimeClient(this.getClientConfig());
  }

  /**
   * Count tokens using the Bedrock CountTokens API.
   *
   * Note: CountTokens API does not support cross-region inference profile IDs.
   * For inference profiles, this method resolves the base model ID using GetInferenceProfile API.
   *
   * @param modelId The model ID or cross-region inference profile ID
   * @param input The input to count tokens for (Converse format)
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns The number of input tokens, or undefined if the API is not supported
   */
  async countTokens(
    modelId: string,
    input: CountTokensCommandInput["input"],
    abortSignal?: AbortSignal,
  ): Promise<number | undefined> {
    try {
      // Resolve the base model ID (uses GetInferenceProfile API for cross-region profiles)
      const baseModelId = await this.resolveModelId(modelId, abortSignal);

      const command = new CountTokensCommand({
        input,
        modelId: baseModelId,
      });
      const response = await this.bedrockRuntimeClient.send(command, { abortSignal });

      if (baseModelId !== modelId) {
        logger.trace(
          `[Bedrock API Client] CountTokens used base model ID ${baseModelId} for inference profile ${modelId}`,
        );
      }

      return response.inputTokens;
    } catch (error) {
      // Log detailed error information at trace level for debugging
      logger.trace(`[Bedrock API Client] CountTokens failed for model ${modelId}`, {
        error:
          error instanceof Error
            ? {
                message: error.message,
                name: error.name,
                stack: error.stack,
              }
            : error,
        modelId,
      });

      // If the CountTokens API is not supported for this model/region, return undefined
      // The caller should fall back to estimation
      logger.debug(
        `[Bedrock API Client] CountTokens not available for model ${modelId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Fetch application inference profiles (custom user-created profiles).
   * These profiles are matched to foundation models to inherit their capabilities.
   *
   * @param foundationModels List of foundation models to match profiles against
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns Array of application profiles as BedrockModelSummary objects
   */
  async fetchApplicationInferenceProfiles(
    foundationModels: BedrockModelSummary[],
    abortSignal?: AbortSignal,
  ): Promise<BedrockModelSummary[]> {
    try {
      const profiles: BedrockModelSummary[] = [];
      const paginator = paginateListInferenceProfiles(
        { client: this.bedrockClient },
        { typeEquals: "APPLICATION" },
        { abortSignal },
      );

      for await (const page of paginator) {
        // Check if the operation was cancelled
        if (abortSignal?.aborted) {
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          throw error;
        }

        for (const profile of page.inferenceProfileSummaries ?? []) {
          if (!profile.inferenceProfileId || profile.status !== "ACTIVE") {
            continue;
          }

          // Match profile to a foundation model to inherit capabilities
          // Extract base model ID from the profile's models array (same pattern as resolveModelId)
          let matchedModel: BedrockModelSummary | undefined;
          let baseModelId: string | undefined;

          if (profile.models && profile.models.length > 0) {
            baseModelId = profile.models[0].modelArn?.split("/").pop();
            if (baseModelId) {
              matchedModel = foundationModels.find((fm) => fm.modelId === baseModelId);
            }
          }

          // Create profile summary with inherited or default capabilities
          profiles.push({
            baseModelId,
            customizationsSupported: matchedModel?.customizationsSupported,
            inferenceTypesSupported: matchedModel?.inferenceTypesSupported ?? [],
            inputModalities: matchedModel?.inputModalities ?? [],
            modelArn: profile.inferenceProfileArn ?? "",
            modelId: profile.inferenceProfileArn ?? "", // Use ARN as ID for inference profiles
            modelLifecycle: matchedModel?.modelLifecycle ?? { status: "" },
            modelName: profile.inferenceProfileName ?? profile.inferenceProfileId,
            outputModalities: matchedModel?.outputModalities ?? [],
            providerName: matchedModel?.providerName ?? "Application Inference Profile",
            responseStreamingSupported: matchedModel?.responseStreamingSupported ?? false,
          });
        }
      }

      logger.debug(`[Bedrock API Client] Found ${profiles.length} application inference profiles`);
      return profiles;
    } catch (error) {
      logger.error("[Bedrock API Client] Failed to fetch application inference profiles", error);
      return [];
    }
  }

  async fetchInferenceProfiles(abortSignal?: AbortSignal): Promise<Set<string>> {
    try {
      const profileIds = new Set<string>();
      const paginator = paginateListInferenceProfiles(
        { client: this.bedrockClient },
        {},
        { abortSignal },
      );

      for await (const page of paginator) {
        // Check if the operation was cancelled
        if (abortSignal?.aborted) {
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          throw error;
        }

        for (const profile of page.inferenceProfileSummaries ?? []) {
          if (profile.inferenceProfileId) {
            profileIds.add(profile.inferenceProfileId);
          }
        }
      }

      return profileIds;
    } catch (error) {
      logger.error("[Bedrock API Client] Failed to fetch inference profiles", error);
      return new Set();
    }
  }

  async fetchModels(abortSignal?: AbortSignal): Promise<BedrockModelSummary[]> {
    try {
      // Clear any fallback state before fetching
      this.fallbackInferenceProfileIds.clear();
      this.fallbackBaseModelIds.clear();

      const command = new ListFoundationModelsCommand({
        byOutputModality: ModelModality.TEXT,
      });
      const response = await this.bedrockClient.send(command, { abortSignal });

      return (response.modelSummaries ?? []).map((summary) => ({
        customizationsSupported: summary.customizationsSupported,
        inferenceTypesSupported: summary.inferenceTypesSupported,
        inputModalities: summary.inputModalities ?? [],
        modelArn: summary.modelArn ?? "",
        modelId: summary.modelId ?? "",
        modelLifecycle: summary.modelLifecycle,
        modelName: summary.modelName ?? "",
        outputModalities: summary.outputModalities ?? [],
        providerName: summary.providerName ?? "",
        responseStreamingSupported: summary.responseStreamingSupported ?? false,
      }));
    } catch (error) {
      if (error instanceof AccessDeniedException) {
        logger.warn(
          "[Bedrock API Client] ListFoundationModels denied, attempting fallback Anthropic profiles",
          error,
        );

        const fallbackModels = await this.detectAnthropicFallbackModels(abortSignal);
        if (fallbackModels.length > 0) {
          return fallbackModels;
        }

        throw new ListFoundationModelsDeniedError(error);
      }

      logger.error("[Bedrock API Client] Failed to fetch Bedrock models", error);
      throw error;
    }
  }

  /**
   * Return base model IDs detected via fallback when no inference profile is available.
   */
  getFallbackBaseModelIds(): Set<string> {
    return new Set(this.fallbackBaseModelIds);
  }

  /**
   * Return inference profile IDs detected via fallback when ListFoundationModels is denied.
   * Consumers should merge this with results from fetchInferenceProfiles().
   */
  getFallbackInferenceProfileIds(): Set<string> {
    return new Set(this.fallbackInferenceProfileIds);
  }

  /**
   * Check if a model is accessible (authorized and available in the region).
   * @param modelId The model ID to check
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns true if the model is accessible, false otherwise
   */
  async isModelAccessible(modelId: string, abortSignal?: AbortSignal): Promise<boolean> {
    try {
      const command = new GetFoundationModelAvailabilityCommand({ modelId });
      const response = await this.bedrockClient.send(command, { abortSignal });

      // Model is accessible if it's authorized and available in the region
      return (
        response.authorizationStatus === "AUTHORIZED" && response.regionAvailability === "AVAILABLE"
      );
    } catch (error) {
      if (error instanceof AccessDeniedException || error instanceof ResourceNotFoundException) {
        // Fall back to a test Converse call to verify actual model access
        return this.testModelAccess(modelId, abortSignal);
      }

      logger.error(`[Bedrock API Client] Failed to check availability for model ${modelId}`, error);
      return false;
    }
  }

  /**
   * Resolve the base model ID for a given model ID or inference profile ID.
   * For inference profiles, this uses the GetInferenceProfile API
   * to retrieve the underlying model ID. Results are cached to avoid repeated API calls.
   *
   * Inference profiles have various formats:
   * - Regional: "us.anthropic.claude-sonnet-4-20250514-v1:0" (routes to specific regions)
   * - Global: "global.anthropic.claude-sonnet-4-5-20250929-v1:0" (routes across all regions)
   * - Application: "ip-..." (custom user-created profiles)
   * - ARN: "arn:aws:bedrock:region:account:inference-profile/..." (full ARN format)
   *
   * Regular model IDs may also contain dots (e.g., "anthropic.claude-...") but don't
   * start with a known inference profile prefix.
   *
   * @param modelId The model ID or inference profile ID/ARN
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns The base model ID (may be the same as input if not an inference profile)
   */
  async resolveModelId(modelId: string, abortSignal?: AbortSignal): Promise<string> {
    // Check cache first
    const cached = this.inferenceProfileCache.get(modelId);
    if (cached) {
      logger.trace(
        `[Bedrock API Client] Using cached model ID for inference profile ${modelId}: ${cached}`,
      );
      return cached;
    }

    // Check if this looks like an inference profile
    // Patterns:
    // - Regional/Global: starts with 2-3 letter region code or "global" (us.*, eu.*, global.*)
    // - Application: starts with "ip-" (ip-...)
    // - ARN: full ARN format (arn:aws:bedrock:region:account:inference-profile/... or application-inference-profile/...)
    const dotProfilePattern = /^(global|[a-z]{2,3})\./;
    const arnProfilePattern =
      /^arn:aws(-[a-z0-9]+)?:bedrock:[a-z0-9-]+:\d{12}:(application-)?inference-profile\//;
    const appProfileIdPattern = /^ip-[a-z0-9]+/i;
    const looksLikeProfile =
      dotProfilePattern.test(modelId) ||
      arnProfilePattern.test(modelId) ||
      appProfileIdPattern.test(modelId);
    if (!looksLikeProfile) {
      // Not an inference profile, return as-is
      return modelId;
    }

    try {
      // Try to get the inference profile to resolve the base model ID
      const command = new GetInferenceProfileCommand({
        inferenceProfileIdentifier: modelId,
      });

      const response = await this.bedrockClient.send(command, { abortSignal });

      // Extract the model ID from the models array
      // According to AWS docs, inference profiles can contain multiple models, but we take the first one
      const baseModelId = response.models?.[0]?.modelArn?.split("/").pop() ?? modelId;

      // Cache the result
      this.inferenceProfileCache.set(modelId, baseModelId);

      logger.trace(
        `[Bedrock API Client] Resolved inference profile ${modelId} to model ID: ${baseModelId}`,
      );

      return baseModelId;
    } catch (error) {
      // If GetInferenceProfile fails, assume it's a regular model ID
      // This could happen if the ID format looks like a profile but isn't, or if we don't have permissions
      logger.trace(
        `[Bedrock API Client] GetInferenceProfile failed for ${modelId}, treating as regular model ID`,
        error,
      );
      return modelId;
    }
  }

  setAuthConfig(authConfig: AuthConfig | undefined): void {
    this.authConfig = authConfig;
    this.recreateClients();
  }

  setProfile(profileName: string | undefined): void {
    this.profileName = profileName;
    this.recreateClients();
  }

  setRegion(region: string): void {
    this.region = region;
    this.recreateClients();
  }

  async startConversationStream(
    input: ConverseStreamCommandInput,
    abortSignal?: AbortSignal,
  ): Promise<AsyncIterable<ConverseStreamOutput>> {
    const command = new ConverseStreamCommand(input);
    const response = await this.bedrockRuntimeClient.send(command, { abortSignal });

    if (!response.stream) {
      throw new Error("No stream in response");
    }

    return response.stream;
  }

  /**
   * Test inference profile accessibility by making a minimal Converse call.
   * This method is specifically designed for testing inference profiles and should be used
   * instead of isModelAccessible() when verifying profile access.
   * @param profileId The inference profile ID to test
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns true if the profile is accessible, false otherwise
   */
  async testInferenceProfileAccess(profileId: string, abortSignal?: AbortSignal): Promise<boolean> {
    return this.testAccessViaConverse(profileId, "Inference profile", abortSignal);
  }

  /**
   * Detect Anthropic models reachable via known global/regional inference profiles when ListFoundationModels is blocked.
   * Checks global profiles first, then falls back to regional profiles if access is denied.
   */
  private async detectAnthropicFallbackModels(
    abortSignal?: AbortSignal,
  ): Promise<BedrockModelSummary[]> {
    const candidates: {
      baseModelId: string;
      displayName: string;
      globalProfileId: string;
      regionalProfileIds: string[];
    }[] = [
      {
        baseModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        displayName: "Claude Sonnet 4.5",
        globalProfileId: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
        regionalProfileIds: ["us.anthropic.claude-sonnet-4-5-20250929-v1:0"],
      },
      {
        baseModelId: "anthropic.claude-opus-4-5-20251101-v1:0",
        displayName: "Claude Opus 4.5",
        globalProfileId: "global.anthropic.claude-opus-4-5-20251101-v1:0",
        regionalProfileIds: ["us.anthropic.claude-opus-4-5-20251101-v1:0"],
      },
      {
        baseModelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
        displayName: "Claude Haiku 4.5",
        globalProfileId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        regionalProfileIds: ["us.anthropic.claude-haiku-4-5-20251001-v1:0"],
      },
    ];

    const detected: BedrockModelSummary[] = [];
    const accessibilityChecks = await Promise.allSettled(
      candidates.map(async (candidate) => {
        // Try global profile first
        const globalProfileAccessible = await this.testInferenceProfileAccess(
          candidate.globalProfileId,
          abortSignal,
        );
        if (globalProfileAccessible) {
          return { accessible: true, candidate, profileId: candidate.globalProfileId };
        }

        // Global profile denied, try regional profiles
        for (const regionalProfileId of candidate.regionalProfileIds) {
          const regionalProfileAccessible = await this.testInferenceProfileAccess(
            regionalProfileId,
            abortSignal,
          );
          if (regionalProfileAccessible) {
            logger.info(
              `[Bedrock API Client] Global profile ${candidate.globalProfileId} denied, using regional profile ${regionalProfileId}`,
            );
            return { accessible: true, candidate, profileId: regionalProfileId };
          }
        }

        // No accessible profile found, fall back to base model if reachable
        const baseModelAccessible = await this.isModelAccessible(
          candidate.baseModelId,
          abortSignal,
        );
        if (baseModelAccessible) {
          logger.info(
            `[Bedrock API Client] No accessible inference profile for ${candidate.baseModelId}, using base model`,
          );
          return { accessible: true, candidate, profileId: candidate.baseModelId };
        }

        logger.info(
          `[Bedrock API Client] No accessible inference profile or base model for ${candidate.baseModelId}`,
        );
        return { accessible: false, candidate, profileId: undefined };
      }),
    );

    for (const result of accessibilityChecks) {
      if (result.status !== "fulfilled") {
        logger.debug(
          "[Bedrock API Client] Fallback accessibility check failed, skipping candidate",
          result.reason,
        );
        continue;
      }

      if (!result.value.accessible) {
        continue;
      }

      const { candidate, profileId } = result.value;
      if (!profileId) {
        logger.warn(
          `[Bedrock API Client] Skipping ${candidate.baseModelId}: accessible but no profileId`,
        );
        continue;
      }
      if (profileId === candidate.baseModelId) {
        this.fallbackBaseModelIds.add(profileId);
      } else {
        this.fallbackInferenceProfileIds.add(profileId);
      }
      detected.push({
        baseModelId: candidate.baseModelId,
        customizationsSupported: [],
        inferenceTypesSupported: ["ON_DEMAND"],
        inputModalities: [ModelModality.TEXT, ModelModality.IMAGE],
        modelArn: candidate.baseModelId,
        modelId: candidate.baseModelId,
        modelLifecycle: { status: "ACTIVE" },
        modelName: `${candidate.displayName} (Detected via inference profile)`,
        outputModalities: [ModelModality.TEXT],
        providerName: "Anthropic",
        responseStreamingSupported: true,
      });
    }

    logger.info(
      `[Bedrock API Client] Fallback detection found ${detected.length} Anthropic model(s)`,
    );
    return detected;
  }

  private getClientConfig(): BedrockClientConfig & BedrockRuntimeClientConfig {
    const base = {
      ...nodeNativeFetch,
      region: this.region,
      retryStrategy: new AdaptiveRetryStrategy(
        async () => 10, // maxAttempts provider function
        {
          rateLimiter: new DefaultRateLimiter({
            beta: 0.5, // Conservative smoothing factor (default is 0.7)
          }),
        },
      ),
    } as BedrockClientConfig & BedrockRuntimeClientConfig;

    // If authConfig is set, use it (new approach)
    if (this.authConfig) {
      const authResult = this.getCredentialsOrToken(this.authConfig);
      if (authResult) {
        return { ...base, ...authResult };
      }
      return base;
    }

    // Otherwise, use profileName (legacy approach for backward compatibility)
    return this.profileName
      ? { ...base, credentials: fromIni({ profile: this.profileName }) }
      : base;
  }

  /**
   * Get AWS credentials or token configuration based on the authentication configuration.
   * For API key authentication, returns a token provider using AWS SDK's native bearer token support.
   * @param authConfig Authentication configuration
   * @returns Object with credentials or token provider, or undefined for default credentials
   */
  private getCredentialsOrToken(authConfig: AuthConfig):
    | undefined
    | {
        credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider;
        token?: TokenIdentityProvider;
      } {
    if (authConfig.method === "api-key") {
      // Use AWS SDK's native bearer token support instead of environment variables
      if (!authConfig.apiKey) {
        return undefined;
      }

      const tokenProvider: TokenIdentityProvider = async (): Promise<TokenIdentity> => ({
        token: authConfig.apiKey,
      });

      return { token: tokenProvider };
    }

    if (authConfig.method === "profile") {
      return authConfig.profile
        ? { credentials: fromIni({ profile: authConfig.profile }) }
        : undefined;
    }

    if (authConfig.method === "access-keys") {
      if (!authConfig.accessKeyId || !authConfig.secretAccessKey) {
        return undefined;
      }
      // Static credentials are process-scoped and not refreshed automatically
      const creds: AwsCredentialIdentity = {
        accessKeyId: authConfig.accessKeyId,
        secretAccessKey: authConfig.secretAccessKey,
        ...(authConfig.sessionToken ? { sessionToken: authConfig.sessionToken } : {}),
      };
      return { credentials: creds };
    }

    return undefined;
  }

  private recreateClients(): void {
    this.bedrockClient = new BedrockClient(this.getClientConfig());
    this.bedrockRuntimeClient = new BedrockRuntimeClient(this.getClientConfig());

    // Clear inference profile cache since profiles may differ across regions/credentials
    this.inferenceProfileCache.clear();
  }

  /**
   * Internal helper to test access via a minimal Converse call.
   * Used by both testInferenceProfileAccess and testModelAccess.
   * @param modelId The model ID or inference profile ID to test
   * @param resourceType Description of resource type for logging (e.g., "Model", "Inference profile")
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns true if accessible, false otherwise
   */
  private async testAccessViaConverse(
    modelId: string,
    resourceType: string,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    try {
      await this.bedrockRuntimeClient.send(
        new ConverseCommand({
          inferenceConfig: { maxTokens: 1 },
          messages: [{ content: [{ text: "hi" }], role: "user" }],
          modelId,
        }),
        { abortSignal },
      );
      return true;
    } catch (error) {
      if (error instanceof RuntimeAccessDeniedException) {
        logger.debug(`[Bedrock API Client] ${resourceType} ${modelId} not accessible`, error);
        return false;
      }
      if (error instanceof ValidationException) {
        logger.debug(`[Bedrock API Client] ${resourceType} ${modelId} validation failed`, error);
        return false;
      }
      if (error instanceof ThrottlingException) {
        logger.debug(
          `[Bedrock API Client] ${resourceType} ${modelId} accessible (throttled)`,
          error,
        );
        return true;
      }
      logger.warn(
        `[Bedrock API Client] Unexpected error testing ${resourceType} ${modelId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Test model access by making a minimal Converse call.
   * @returns true if the model is accessible, false otherwise
   */
  private async testModelAccess(modelId: string, abortSignal?: AbortSignal): Promise<boolean> {
    return this.testAccessViaConverse(modelId, "Model", abortSignal);
  }
}

export class ListFoundationModelsDeniedError extends Error {
  constructor(cause?: unknown) {
    super("ListFoundationModelsAccessDenied", { cause });
    this.name = "ListFoundationModelsDeniedError";
  }
}
