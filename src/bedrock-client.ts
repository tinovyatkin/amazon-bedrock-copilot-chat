import type { BedrockClientConfig } from "@aws-sdk/client-bedrock";
import {
  BedrockClient,
  GetFoundationModelAvailabilityCommand,
  GetInferenceProfileCommand,
  ListFoundationModelsCommand,
  ModelModality,
  paginateListInferenceProfiles,
} from "@aws-sdk/client-bedrock";
import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  CountTokensCommand,
  type CountTokensCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import { AdaptiveRetryStrategy, DefaultRateLimiter } from "@smithy/util-retry";
import * as nodeNativeFetch from "smithy-node-native-fetch";

import { logger } from "./logger";
import type { BedrockModelSummary } from "./types";

export class BedrockAPIClient {
  private bedrockClient: BedrockClient;
  private bedrockRuntimeClient: BedrockRuntimeClient;
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
            modelId: profile.inferenceProfileId,
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
      logger.error("[Bedrock API Client] Failed to fetch Bedrock models", error);
      throw error;
    }
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
      logger.error(`[Bedrock API Client] Failed to check availability for model ${modelId}`, error);
      return false;
    }
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
    return this.profileName
      ? { ...base, credentials: fromIni({ profile: this.profileName }) }
      : base;
  }

  private recreateClients(): void {
    this.bedrockClient = new BedrockClient(this.getClientConfig());
    this.bedrockRuntimeClient = new BedrockRuntimeClient(this.getClientConfig());

    // Clear inference profile cache since profiles may differ across regions/credentials
    this.inferenceProfileCache.clear();
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
  private async resolveModelId(modelId: string, abortSignal?: AbortSignal): Promise<string> {
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
    // - ARN: full ARN format (arn:aws:bedrock:region:account:inference-profile/...)
    const dotProfilePattern = /^(global|[a-z]{2,3})\./;
    const arnProfilePattern = /^arn:aws(-[a-z0-9]+)?:bedrock:[a-z0-9-]+:\d{12}:inference-profile\//;
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
}
