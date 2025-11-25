import { ModelModality } from "@aws-sdk/client-bedrock";
import type {
  ConverseStreamCommandInput,
  CountTokensCommandInput,
  Message,
  SystemContentBlock,
  ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { inspect, MIMEType } from "node:util";
import type {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelResponsePart,
  Progress,
} from "vscode";
import * as vscode from "vscode";

import { BedrockAPIClient } from "./bedrock-client";
import { convertMessages } from "./converters/messages";
import { convertTools } from "./converters/tools";
import { logger } from "./logger";
import { getModelProfile, getModelTokenLimits } from "./profiles";
import { getBedrockSettings } from "./settings";
import { StreamProcessor, type ThinkingBlock } from "./stream-processor";
import type { AuthConfig, AuthMethod } from "./types";
import { validateBedrockMessages } from "./validation";

export class BedrockChatModelProvider implements vscode.Disposable, LanguageModelChatProvider {
  // Event to notify VS Code that model information has changed
  private readonly _onDidChangeLanguageModelInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelInformation = this._onDidChangeLanguageModelInformation.event;

  private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
  private readonly client: BedrockAPIClient;
  private lastThinkingBlock?: ThinkingBlock;
  private readonly streamProcessor: StreamProcessor;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
  ) {
    // Initialize with default region - will be updated on first use
    this.client = new BedrockAPIClient("us-east-1", undefined);
    this.streamProcessor = new StreamProcessor();
  }

  /**
   * Dispose resources held by the provider
   */
  public dispose(): void {
    try {
      this._onDidChangeLanguageModelInformation.dispose();
    } catch {
      // ignore
    }
  }

  /**
   * Notify the workbench that the available model information should be refreshed.
   * Hooked up from extension activation to configuration, secrets, and model selection changes.
   */
  public notifyModelInformationChanged(reason?: string): void {
    const suffix = reason ? `: ${reason}` : "";
    logger.debug(`[Bedrock Model Provider] Signaling model info refresh${suffix}`);
    this._onDidChangeLanguageModelInformation.fire();
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Provider bootstrapping requires multiple guarded flows
  async prepareLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const settings = await getBedrockSettings(this.globalState);

    // Check if this is the first run by checking if we've shown the welcome prompt before
    const hasRunBefore = this.globalState.get<boolean>("bedrock.hasRunBefore", false);

    if (!hasRunBefore && !options.silent) {
      const action = await vscode.window.showInformationMessage(
        "Amazon Bedrock integration requires AWS credentials. Would you like to configure your AWS profile and region first?",
        "Configure Settings",
        "Use Default Credentials",
      );

      // Mark that we've shown the prompt
      await this.globalState.update("bedrock.hasRunBefore", true);

      if (action === "Configure Settings") {
        await vscode.commands.executeCommand("bedrock.manage");
        // Return empty array - user will need to refresh after configuring
        return [];
      } else if (action !== "Use Default Credentials") {
        // User cancelled
        return [];
      }
      // If "Use Default Credentials" was selected, continue with the fetch
    }

    const authConfig = await this.getAuthConfig(options.silent);
    if (!authConfig) {
      if (!options.silent) {
        vscode.window.showErrorMessage(
          "AWS Bedrock authentication not configured. Please run 'Manage Amazon Bedrock Provider'.",
        );
      }
      return [];
    }

    this.client.setRegion(settings.region);
    if (authConfig.method === "profile") {
      this.client.setProfile(settings.profile);
    }
    this.client.setAuthConfig(authConfig);

    try {
      // Create AbortController for cancellation support
      const abortController = new AbortController();

      // Set up cancellation handling
      const cancellationListener = token.onCancellationRequested(() => {
        abortController.abort();
      });

      try {
        const fetchModels = async (
          progress?: vscode.Progress<{ message?: string }>,
        ): Promise<LanguageModelChatInformation[]> => {
          progress?.report({ message: "Fetching model list..." });

          const [models, apiProfileIds] = await Promise.all([
            this.client.fetchModels(abortController.signal),
            this.client.fetchInferenceProfiles(abortController.signal),
          ]);

          // Merge normal profile detection with any fallback profiles we detected when ListFoundationModels is blocked
          const availableProfileIds = new Set<string>(apiProfileIds);
          for (const fallbackId of this.client.getFallbackInferenceProfileIds()) {
            availableProfileIds.add(fallbackId);
          }

          // Fetch application inference profiles after we have foundation models
          const applicationProfiles = await this.client.fetchApplicationInferenceProfiles(
            models,
            abortController.signal,
          );

          const regionPrefix = settings.region.split("-")[0];

          // First, filter models by basic requirements and build candidate list
          const candidates: {
            hasInferenceProfile: boolean;
            model: (typeof models)[0];
            modelIdToUse: string;
          }[] = [];

          for (const m of models) {
            if (!m.responseStreamingSupported || !m.outputModalities.includes(ModelModality.TEXT)) {
              continue;
            }

            // Determine which model ID to use (with or without inference profile)
            // Prefer global inference profiles for best availability, then regional, then base model
            const globalProfileId = `global.${m.modelId}`;
            const regionalProfileId = `${regionPrefix}.${m.modelId}`;

            let modelIdToUse = m.modelId;
            let hasInferenceProfile = false;

            if (availableProfileIds.has(globalProfileId)) {
              modelIdToUse = globalProfileId;
              hasInferenceProfile = true;
              logger.trace(
                `[Bedrock Model Provider] Using global inference profile for ${m.modelId}`,
              );
            } else if (availableProfileIds.has(regionalProfileId)) {
              modelIdToUse = regionalProfileId;
              hasInferenceProfile = true;
              logger.trace(
                `[Bedrock Model Provider] Using regional inference profile for ${m.modelId}`,
              );
            }

            candidates.push({ hasInferenceProfile, model: m, modelIdToUse });
          }

          progress?.report({
            message: `Checking availability of ${candidates.length} models...`,
          });

          // Check model accessibility in parallel using allSettled to handle failures gracefully
          const accessibilityChecks = await Promise.allSettled(
            candidates.map(async (candidate) => {
              // First check if base model is accessible
              const baseModelAccessible = await this.client.isModelAccessible(
                candidate.model.modelId,
                abortController.signal,
              );

              if (!baseModelAccessible) {
                return { ...candidate, isAccessible: false };
              }

              // Base model is accessible, now check if the selected profile is accessible
              // This is crucial for accounts with regional deny policies
              if (candidate.hasInferenceProfile) {
                const profileAccessible = await this.client.isModelAccessible(
                  candidate.modelIdToUse,
                  abortController.signal,
                );

                if (profileAccessible) {
                  return { ...candidate, isAccessible: true };
                }

                // Profile is denied, try to find an alternative
                logger.info(
                  `[Bedrock Model Provider] Inference profile ${candidate.modelIdToUse} denied, trying alternatives for ${candidate.model.modelId}`,
                );

                // If this was a global profile, try regional
                if (candidate.modelIdToUse.startsWith("global.")) {
                  const regionalProfileId = `${regionPrefix}.${candidate.model.modelId}`;
                  if (availableProfileIds.has(regionalProfileId)) {
                    const regionalAccessible = await this.client.isModelAccessible(
                      regionalProfileId,
                      abortController.signal,
                    );
                    if (regionalAccessible) {
                      logger.info(
                        `[Bedrock Model Provider] Using regional profile ${regionalProfileId} instead of global profile`,
                      );
                      return {
                        ...candidate,
                        hasInferenceProfile: true,
                        isAccessible: true,
                        modelIdToUse: regionalProfileId,
                      };
                    }
                  }
                }

                // No accessible profile found, fall back to base model
                logger.info(
                  `[Bedrock Model Provider] No accessible inference profile found for ${candidate.model.modelId}, using base model`,
                );
                return {
                  ...candidate,
                  hasInferenceProfile: false,
                  isAccessible: true,
                  modelIdToUse: candidate.model.modelId,
                };
              }

              // No inference profile, base model is accessible
              return { ...candidate, isAccessible: true };
            }),
          );

          progress?.report({ message: "Building model list..." });

          // Build final list of accessible models
          const infos: LanguageModelChatInformation[] = [];
          for (const result of accessibilityChecks) {
            // If the check failed, treat as inaccessible
            if (result.status === "rejected") {
              logger.error("[Bedrock Model Provider] Accessibility check failed", result.reason);
              continue;
            }

            const { hasInferenceProfile, isAccessible, model: m, modelIdToUse } = result.value;

            if (!isAccessible) {
              logger.debug(
                `[Bedrock Model Provider] Excluding inaccessible model: ${modelIdToUse} (not authorized or not available)`,
              );
              continue;
            }

            const limits = getModelTokenLimits(modelIdToUse, settings.context1M.enabled);
            const maxInput = limits.maxInputTokens;
            const maxOutput = limits.maxOutputTokens;
            const vision = m.inputModalities.includes(ModelModality.IMAGE);

            // Determine tooltip suffix based on inference profile type
            let tooltipSuffix = "";
            if (hasInferenceProfile) {
              tooltipSuffix = modelIdToUse.startsWith("global.")
                ? " (Global Inference Profile)"
                : " (Regional Inference Profile)";
            }

            const modelInfo: LanguageModelChatInformation = {
              capabilities: {
                imageInput: vision,
                toolCalling: true,
              },
              family: "bedrock",
              id: modelIdToUse,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              name: m.modelName,
              tooltip: `Amazon Bedrock - ${m.providerName}${tooltipSuffix}`,
              version: "1.0.0",
            };
            infos.push(modelInfo);
          }

          // Add application inference profiles
          progress?.report({
            message: `Processing ${applicationProfiles.length} application profiles...`,
          });

          for (const profile of applicationProfiles) {
            // Filter profiles similar to foundation models - must support streaming and text output
            if (
              !profile.responseStreamingSupported ||
              !profile.outputModalities.includes(ModelModality.TEXT)
            ) {
              logger.debug(
                `[Bedrock Model Provider] Excluding application profile: ${profile.modelId} (no streaming or text output)`,
              );
              continue;
            }

            // Use base model ID for token limits (falls back to profile ID if not available)
            const modelIdForLimits = profile.baseModelId ?? profile.modelId;
            const limits = getModelTokenLimits(modelIdForLimits, settings.context1M.enabled);
            const maxInput = limits.maxInputTokens;
            const maxOutput = limits.maxOutputTokens;
            const vision = profile.inputModalities.includes(ModelModality.IMAGE);

            const profileInfo: LanguageModelChatInformation = {
              capabilities: {
                imageInput: vision,
                toolCalling: true,
              },
              family: "bedrock",
              id: profile.modelArn,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              name: profile.modelName,
              tooltip: `Amazon Bedrock - ${profile.providerName} (Application Inference Profile)`,
              version: "1.0.0",
            };
            infos.push(profileInfo);
          }

          this.chatEndpoints = infos.map((info) => ({
            model: info.id,
            modelMaxPromptTokens: info.maxInputTokens + info.maxOutputTokens,
          }));

          return infos;
        };

        // Show progress notification only if not silent
        if (options.silent) {
          return await fetchModels();
        }

        return await vscode.window.withProgress(
          {
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: "Loading Bedrock models",
          },
          fetchModels,
        );
      } finally {
        cancellationListener.dispose();
      }
    } catch (error) {
      // Don't log or show errors if the operation was cancelled by the user
      if (error instanceof Error && error.name === "AbortError") {
        logger.info("[Bedrock Model Provider] Model fetch cancelled by user");
        return [];
      }

      if (!options.silent) {
        logger.error("[Bedrock Model Provider] Failed to fetch models", error);
        if ((error as { code?: string }).code === "LIST_FOUNDATION_MODELS_DENIED") {
          const manualModelId = await vscode.window.showInputBox({
            placeHolder: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            prompt:
              "Model listing is blocked by AWS permissions. Enter a Bedrock model ID or inference profile ID to use.",
          });

          if (manualModelId) {
            const manualInfo = await this.buildManualModelInformation(
              manualModelId,
              settings,
              token,
            );

            if (manualInfo) {
              this.chatEndpoints = [
                {
                  model: manualInfo.id,
                  modelMaxPromptTokens: manualInfo.maxInputTokens + manualInfo.maxOutputTokens,
                },
              ];
              return [manualInfo];
            }
          }

          vscode.window.showErrorMessage(
            "Could not detect any Bedrock models with current permissions. Please update your AWS policy or provide a reachable model ID.",
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to fetch Bedrock models. Please check your AWS profile and region settings. Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return [];
    }
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    return this.prepareLanguageModelChatInformation({ silent: options.silent ?? false }, token);
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const trackingProgress: Progress<LanguageModelResponsePart> = {
      report: (part) => {
        try {
          progress.report(part);
        } catch (error) {
          logger.warn("[Bedrock Model Provider] Progress.report failed", {
            error:
              error instanceof Error ? { message: error.message, name: error.name } : String(error),
            modelId: model.id,
          });
        }
      },
    };

    try {
      // Get authentication configuration (silent to avoid prompting during active chat)
      const authConfig = await this.getAuthConfig(true);
      if (!authConfig) {
        throw new Error("AWS Bedrock authentication not configured");
      }

      // Configure client with authentication
      this.client.setAuthConfig(authConfig);

      // Resolve model ID for application inference profiles (ARNs) to base model ID
      // This is needed because internal logic (getModelProfile, getModelTokenLimits) expects base model IDs
      // Note: For the actual API call, we still use the original model.id (ARN for app profiles)
      const abortController = new AbortController();
      const cancellationListener = token.onCancellationRequested(() => {
        abortController.abort();
      });

      let baseModelId: string;
      try {
        baseModelId = await this.client.resolveModelId(model.id, abortController.signal);
        logger.info("[Bedrock Model Provider] Resolved model ID", {
          originalModelId: model.id,
          resolvedBaseModelId: baseModelId,
        });
      } catch (error) {
        // If resolution fails, use the original model ID
        baseModelId = model.id;
        logger.warn("[Bedrock Model Provider] Failed to resolve model ID, using original", {
          error: error instanceof Error ? error.message : String(error),
          modelId: model.id,
        });
      } finally {
        cancellationListener.dispose();
      }

      // Log incoming messages
      this.logIncomingMessages(messages);

      // Get settings and model configuration
      const settings = await getBedrockSettings(this.globalState);
      const modelProfile = getModelProfile(baseModelId);
      const modelLimits = getModelTokenLimits(baseModelId, settings.context1M.enabled);

      // Calculate thinking configuration
      const maxTokensForRequest =
        typeof options.modelOptions?.max_tokens === "number"
          ? options.modelOptions.max_tokens
          : 4096;
      const { budgetTokens, extendedThinkingEnabled } = this.calculateThinkingConfig(
        modelProfile,
        modelLimits,
        maxTokensForRequest,
        settings.thinking.enabled,
      );

      // Convert messages with thinking configuration
      const converted = convertMessages(messages, baseModelId, {
        extendedThinkingEnabled,
        lastThinkingBlock: this.lastThinkingBlock,
        promptCachingEnabled: settings.promptCaching.enabled,
      });

      // Log converted messages
      this.logConvertedMessages(converted.messages);

      // Validate messages and tools
      validateBedrockMessages(converted.messages);

      const toolConfig = convertTools(
        options,
        baseModelId,
        extendedThinkingEnabled,
        settings.promptCaching.enabled,
      );

      if (options.tools && options.tools.length > 128) {
        throw new Error("Cannot have more than 128 tools per request.");
      }

      // Build beta headers
      const betaHeaders = this.buildBetaHeaders(
        modelProfile,
        extendedThinkingEnabled,
        settings.context1M.enabled,
      );

      // Build request input
      const requestInput = this.buildRequestInput(
        model,
        converted,
        options,
        toolConfig,
        extendedThinkingEnabled,
        budgetTokens,
        betaHeaders,
      );

      // Log request details
      this.logRequestDetails(requestInput);

      // Validate token count
      await this.validateTokenCount(model, requestInput, token);

      // Process the stream
      await this.processResponseStream(
        requestInput,
        trackingProgress,
        extendedThinkingEnabled,
        token,
      );
    } catch (error) {
      // Check for context window overflow errors and provide better error messages
      // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L852-L860
      if (isContextWindowOverflowError(error)) {
        const errorMessage =
          "Input exceeds model context window. " +
          "Consider reducing conversation history, removing tool results, or adjusting model parameters.";
        logger.error("[Bedrock Model Provider] Context window overflow", {
          messageCount: messages.length,
          modelId: model.id,
          originalError: error instanceof Error ? error.message : String(error),
        });
        throw new Error(errorMessage);
      }

      logger.error("[Bedrock Model Provider] Chat request failed", {
        error:
          error instanceof Error
            ? { message: error.message, name: error.name, stack: error.stack }
            : String(error),
        messageCount: messages.length,
        modelId: model.id,
      });
      throw error;
    }
  }

  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: LanguageModelChatMessage | string,
    token: CancellationToken,
  ): Promise<number> {
    // Fallback estimation function
    const estimateTokens = (input: LanguageModelChatMessage | string): number => {
      if (typeof input === "string") {
        return Math.ceil(input.length / 4);
      }
      let totalTokens = 0;
      for (const part of input.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          totalTokens += Math.ceil(part.value.length / 4);
        }
      }
      return totalTokens;
    };

    try {
      // Create AbortController for cancellation support
      const abortController = new AbortController();
      const cancellationListener = token.onCancellationRequested(() => {
        abortController.abort();
      });

      // Resolve model ID for application inference profiles (ARNs) to base model ID
      // This is needed because convertMessages calls getModelProfile which expects base model IDs
      let baseModelId: string;
      try {
        baseModelId = await this.client.resolveModelId(model.id, abortController.signal);
        logger.debug("[Bedrock Model Provider] Resolved model ID", {
          originalModelId: model.id,
          resolvedBaseModelId: baseModelId,
        });
      } catch (error) {
        // If resolution fails, use the original model ID
        baseModelId = model.id;
        logger.warn("[Bedrock Model Provider] Failed to resolve model ID, using original", {
          error: error instanceof Error ? error.message : String(error),
          modelId: model.id,
        });
      }

      try {
        // For simple string input, use estimation (CountTokens API expects structured messages)
        if (typeof text === "string") {
          return estimateTokens(text);
        }

        // Convert the message to Bedrock format
        const settings = await getBedrockSettings(this.globalState);
        const converted = convertMessages([text], baseModelId, {
          extendedThinkingEnabled: false,
          lastThinkingBlock: undefined,
          promptCachingEnabled: settings.promptCaching.enabled,
        });

        // Use the CountTokens API
        const tokenCount = await this.client.countTokens(
          model.id,
          {
            converse: {
              messages: converted.messages,
              ...(converted.system.length > 0 ? { system: converted.system } : {}),
            },
          },
          abortController.signal,
        );

        // If CountTokens API is available, use its result
        if (tokenCount !== undefined) {
          logger.debug(`[Bedrock Model Provider] Token count from API: ${tokenCount}`);
          return tokenCount;
        }

        // Fall back to estimation if CountTokens is not available
        logger.debug("[Bedrock Model Provider] CountTokens not available, using estimation");
        return estimateTokens(text);
      } finally {
        cancellationListener.dispose();
      }
    } catch (error) {
      // If there's any error (including cancellation), fall back to estimation
      if (error instanceof Error && error.name === "AbortError") {
        logger.debug("[Bedrock Model Provider] Token count cancelled, using estimation");
      } else {
        logger.warn("[Bedrock Model Provider] Token count failed, using estimation", error);
      }
      return estimateTokens(text);
    }
  }

  /**
   * Build beta headers array for the request
   */
  private buildBetaHeaders(
    modelProfile: ReturnType<typeof getModelProfile>,
    extendedThinkingEnabled: boolean,
    context1MEnabled: boolean,
  ): string[] {
    const anthropicBeta: string[] = [];

    if (extendedThinkingEnabled) {
      // Add interleaved-thinking beta header for Claude 4 models
      if (modelProfile.requiresInterleavedThinkingHeader) {
        anthropicBeta.push("interleaved-thinking-2025-05-14");
      }

      // Add 1M context beta header for models that support it and setting is enabled
      if (modelProfile.supports1MContext && context1MEnabled) {
        anthropicBeta.push("context-1m-2025-08-07");
      }
    } else if (modelProfile.supports1MContext && context1MEnabled) {
      // Even if thinking is not enabled, add 1M context beta header
      anthropicBeta.push("context-1m-2025-08-07");
    }

    return anthropicBeta;
  }

  /**
   * Allow users with restricted permissions to manually supply a model or inference profile ID.
   */
  private async buildManualModelInformation(
    modelId: string,
    settings: Awaited<ReturnType<typeof getBedrockSettings>>,
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation | undefined> {
    const abortController = new AbortController();
    const cancellationListener = token.onCancellationRequested(() => abortController.abort());

    try {
      let baseModelId = modelId;
      try {
        baseModelId = await this.client.resolveModelId(modelId, abortController.signal);
      } catch (resolveError) {
        logger.warn("[Bedrock Model Provider] Manual model resolution failed, using provided ID", {
          error:
            resolveError instanceof Error
              ? { message: resolveError.message, name: resolveError.name }
              : String(resolveError),
          modelId,
        });
      }

      const limits = getModelTokenLimits(baseModelId, settings.context1M.enabled);
      const likelyVisionCapable = /anthropic\.|nova\.|llama\.|pixtral|gpt-oss/i.test(baseModelId);

      return {
        capabilities: {
          imageInput: likelyVisionCapable,
          toolCalling: true,
        },
        family: "bedrock",
        id: modelId,
        maxInputTokens: limits.maxInputTokens,
        maxOutputTokens: limits.maxOutputTokens,
        name: modelId,
        tooltip: "Amazon Bedrock - manual model entry",
        version: "1.0.0",
      };
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        logger.error("[Bedrock Model Provider] Manual model setup failed", error);
      }
      return undefined;
    } finally {
      cancellationListener.dispose();
    }
  }

  /**
   * Build and configure the request input for Bedrock API
   */
  private buildRequestInput(
    model: LanguageModelChatInformation,
    converted: { messages: Message[]; system: SystemContentBlock[] },
    options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
    toolConfig: ToolConfiguration | undefined,
    extendedThinkingEnabled: boolean,
    budgetTokens: number,
    betaHeaders: string[],
  ): ConverseStreamCommandInput {
    const requestInput: ConverseStreamCommandInput = {
      inferenceConfig: {
        maxTokens: Math.min(
          typeof options.modelOptions?.max_tokens === "number"
            ? options.modelOptions.max_tokens
            : 4096,
          model.maxOutputTokens,
        ),
        temperature:
          typeof options.modelOptions?.temperature === "number"
            ? options.modelOptions?.temperature
            : 0.7,
      },
      messages: converted.messages,
      modelId: model.id,
    };

    if (converted.system.length > 0) {
      requestInput.system = converted.system;
    }

    if (options.modelOptions) {
      const mo = options.modelOptions;
      if (typeof mo.top_p === "number") {
        requestInput.inferenceConfig!.topP = mo.top_p;
      }
      if (typeof mo.stop === "string") {
        requestInput.inferenceConfig!.stopSequences = [mo.stop];
      } else if (Array.isArray(mo.stop)) {
        requestInput.inferenceConfig!.stopSequences = mo.stop;
      }
    }

    if (toolConfig) {
      requestInput.toolConfig = toolConfig;
    }

    // Add thinking configuration if enabled
    if (extendedThinkingEnabled) {
      // Extended thinking requires temperature 1.0
      requestInput.inferenceConfig!.temperature = 1;

      // Add thinking configuration to additionalModelRequestFields
      requestInput.additionalModelRequestFields = {
        thinking: {
          budget_tokens: budgetTokens,
          type: "enabled",
        },
      };

      if (betaHeaders.length > 0) {
        requestInput.additionalModelRequestFields.anthropic_beta = betaHeaders;
      }

      logger.debug("[Bedrock Model Provider] Extended thinking enabled", {
        anthropicBeta: betaHeaders.length > 0 ? betaHeaders : undefined,
        budgetTokens,
        interleavedThinking: betaHeaders.includes("interleaved-thinking-2025-05-14"),
        modelId: model.id,
        supports1MContext: betaHeaders.includes("context-1m-2025-08-07"),
        temperature: 1,
      });
    } else if (betaHeaders.length > 0) {
      // Even if thinking is not enabled, add beta headers if needed
      requestInput.additionalModelRequestFields = {
        anthropic_beta: betaHeaders,
      };

      logger.debug("[Bedrock Model Provider] 1M context enabled", {
        modelId: model.id,
      });
    }

    return requestInput;
  }

  /**
   * Calculate thinking configuration parameters
   */
  private calculateThinkingConfig(
    modelProfile: ReturnType<typeof getModelProfile>,
    modelLimits: ReturnType<typeof getModelTokenLimits>,
    maxTokensForRequest: number,
    thinkingEnabled: boolean,
  ): { budgetTokens: number; extendedThinkingEnabled: boolean } {
    const dynamicBudget = Math.floor(modelLimits.maxOutputTokens * 0.2);
    const budgetTokens = Math.min(dynamicBudget, maxTokensForRequest - 100);
    const extendedThinkingEnabled =
      thinkingEnabled && modelProfile.supportsThinking && budgetTokens >= 1024;

    return { budgetTokens, extendedThinkingEnabled };
  }

  /**
   * Count tokens for a complete request using the CountTokens API.
   * Falls back to estimation if the API is unavailable or fails.
   * @param modelId The model ID to count tokens for
   * @param input The complete input structure (messages, system, toolConfig)
   * @param token Cancellation token
   * @returns The number of input tokens
   */
  private async countRequestTokens(
    modelId: string,
    input: {
      messages: Message[];
      system?: SystemContentBlock[];
      toolConfig?: ToolConfiguration;
    },
    token: CancellationToken,
  ): Promise<number> {
    // Fallback estimation function
    const estimateTokens = (): number => {
      let total = 0;

      // Estimate messages tokens
      for (const msg of input.messages) {
        for (const content of msg.content ?? []) {
          if ("text" in content && content.text) {
            total += Math.ceil(content.text.length / 4);
          }
        }
      }

      // Estimate system tokens
      if (input.system) {
        for (const sys of input.system) {
          if ("text" in sys && sys.text) {
            total += Math.ceil(sys.text.length / 4);
          }
        }
      }

      // Estimate tool tokens
      if ((input.toolConfig?.tools?.length ?? 0) > 0) {
        try {
          const json = JSON.stringify(input.toolConfig);
          total += Math.ceil(json.length / 4);
        } catch {
          // Ignore serialization errors
        }
      }

      return total;
    };

    try {
      // Create AbortController for cancellation support
      const abortController = new AbortController();
      const cancellationListener = token.onCancellationRequested(() => {
        abortController.abort();
      });

      try {
        // Build the CountTokens API input
        const countInput: CountTokensCommandInput["input"] = {
          converse: {
            messages: input.messages,
            ...(input.system && input.system.length > 0 ? { system: input.system } : {}),
            ...(input.toolConfig ? { toolConfig: input.toolConfig } : {}),
          },
        };

        // Use the CountTokens API
        const tokenCount = await this.client.countTokens(
          modelId,
          countInput,
          abortController.signal,
        );

        // If CountTokens API is available, use its result
        if (tokenCount !== undefined) {
          logger.debug(`[Bedrock Model Provider] Request token count from API: ${tokenCount}`);
          return tokenCount;
        }

        // Fall back to estimation if CountTokens is not available
        logger.debug(
          "[Bedrock Model Provider] CountTokens not available for request, using estimation",
        );
        return estimateTokens();
      } finally {
        cancellationListener.dispose();
      }
    } catch (error) {
      // If there's any error (including cancellation), fall back to estimation
      if (error instanceof Error && error.name === "AbortError") {
        logger.debug("[Bedrock Model Provider] Request token count cancelled, using estimation");
      } else {
        logger.warn("[Bedrock Model Provider] Request token count failed, using estimation", error);
      }
      return estimateTokens();
    }
  }

  /**
   * Get authentication configuration based on the stored auth method.
   * Retrieves credentials from SecretStorage for sensitive data (API keys, access keys)
   * and from globalState for non-sensitive data (profile name, auth method).
   * @param silent If true, don't prompt for missing credentials
   * @returns AuthConfig or undefined if authentication is not configured
   */
  private async getAuthConfig(silent = false): Promise<AuthConfig | undefined> {
    const method = this.globalState.get<AuthMethod>("bedrock.authMethod") ?? "profile";

    if (method === "api-key") {
      let apiKey = await this.secrets.get("bedrock.apiKey");
      if (!apiKey && !silent) {
        const entered = await vscode.window.showInputBox({
          ignoreFocusOut: true,
          password: true,
          prompt: "Enter your AWS Bedrock API key",
          title: "AWS Bedrock API Key",
        });
        if (entered?.trim()) {
          apiKey = entered.trim();
          await this.secrets.store("bedrock.apiKey", apiKey);
        }
      }
      if (!apiKey) {
        return undefined;
      }
      return { apiKey, method: "api-key" };
    }

    if (method === "profile") {
      const settings = await getBedrockSettings(this.globalState);
      return { method: "profile", profile: settings.profile };
    }

    if (method === "access-keys") {
      const accessKeyId = await this.secrets.get("bedrock.accessKeyId");
      const secretAccessKey = await this.secrets.get("bedrock.secretAccessKey");
      const sessionToken = await this.secrets.get("bedrock.sessionToken");

      if (!accessKeyId || !secretAccessKey) {
        if (!silent) {
          vscode.window.showErrorMessage(
            "AWS access keys not configured. Please run 'Manage Amazon Bedrock Provider'.",
          );
        }
        return undefined;
      }

      const result: AuthConfig = {
        accessKeyId,
        method: "access-keys",
        secretAccessKey,
      };
      if (sessionToken) {
        result.sessionToken = sessionToken;
      }
      return result;
    }

    return undefined;
  }

  /**
   * Log converted Bedrock messages for debugging
   */
  private logConvertedMessages(messages: Message[]): void {
    logger.debug("[Bedrock Model Provider] Converted to Bedrock messages:", messages.length);
    for (const [idx, msg] of messages.entries()) {
      const contentTypes = msg.content?.map((c) => {
        if ("text" in c) return "text";
        if ("image" in c) return "image";
        if ("toolUse" in c) return "toolUse";
        if ("toolResult" in c) return "toolResult";
        if ("reasoningContent" in c) return "reasoningContent";
        if ("thinking" in c || "redacted_thinking" in c) return "thinking";
        if ("cachePoint" in c) return "cachePoint";
        return "unknown";
      });
      logger.debug(`[Bedrock Model Provider] Bedrock message ${idx} (${msg.role}):`, contentTypes);
    }
  }

  /**
   * Log incoming VSCode messages for debugging and reproduction
   */
  private logIncomingMessages(messages: readonly LanguageModelChatMessage[]): void {
    logger.info("[Bedrock Model Provider] === NEW REQUEST ===");
    logger.info("[Bedrock Model Provider] Converting messages, count:", messages.length);

    // Log full incoming VSCode messages at trace level for reproduction
    logger.trace("[Bedrock Model Provider] Full VSCode messages for reproduction:", {
      messages: messages.map((msg) => ({
        content: msg.content.map((part) => {
          if (part instanceof vscode.LanguageModelTextPart) {
            return { type: "text", value: part.value };
          }
          if (part instanceof vscode.LanguageModelToolCallPart) {
            return { callId: part.callId, input: part.input, name: part.name, type: "toolCall" };
          }
          if (part instanceof vscode.LanguageModelToolResultPart) {
            return { callId: part.callId, content: part.content, type: "toolResult" };
          }
          if (typeof part === "object" && part != null && "mimeType" in part && "data" in part) {
            const dataPart = part as { data: Uint8Array; mimeType: string };
            return {
              dataLength: dataPart.data.length,
              mimeType: dataPart.mimeType,
              type: "data",
            };
          }
          return { type: "unknown" };
        }),
        role: msg.role,
      })),
    });

    for (const [idx, msg] of messages.entries()) {
      const partTypes = msg.content.map((p) => {
        if (p instanceof vscode.LanguageModelTextPart) return "text";
        if (p instanceof vscode.LanguageModelToolCallPart) {
          return `toolCall(${p.name})`;
        }
        if (p instanceof vscode.LanguageModelToolResultPart) {
          return `toolResult(${p.callId})`;
        }
        if (typeof p === "object" && p != null && "mimeType" in p) {
          try {
            const dataPart = p as { mimeType: string };
            const mime = new MIMEType(dataPart.mimeType);
            if (mime.type === "image") {
              return `image(${mime.essence})`;
            }
            return `data(${mime.essence})`;
          } catch {
            // Invalid MIME type, skip
          }
        }
        return "unknown";
      });
      logger.debug(`[Bedrock Model Provider] Message ${idx} (${msg.role}):`, partTypes);
      // Log tool result details
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelToolResultPart) {
          let contentPreview = "[Unable to preview]";
          try {
            const contentStr =
              typeof part.content === "string" ? part.content : JSON.stringify(part.content);
            contentPreview = contentStr.slice(0, 100);
          } catch {
            // Keep default
          }
          logger.debug(`[Bedrock Model Provider]   Tool Result:`, {
            callId: part.callId,
            contentPreview,
            contentType: typeof part.content,
            isError: "isError" in part ? part.isError : false,
          });
        }
      }
    }
  }

  /**
   * Log request details for debugging
   */
  private logRequestDetails(requestInput: ConverseStreamCommandInput): void {
    logger.info("[Bedrock Model Provider] Starting streaming request", {
      hasTools: !!requestInput.toolConfig,
      messageCount: requestInput.messages?.length,
      modelId: requestInput.modelId,
      systemMessageCount: requestInput.system?.length,
      toolCount: requestInput.toolConfig?.tools?.length,
    });

    // Log the actual request for debugging
    logger.debug("[Bedrock Model Provider] Request details:", {
      messages: requestInput.messages?.map((m) => ({
        contentBlocks: Array.isArray(m.content)
          ? m.content.map((c) => {
              if (c.text) return "text";
              if (c.image) return `image(${c.image.format})`;
              if (c.toolResult) {
                const preview =
                  c.toolResult.content?.[0]?.text?.slice(0, 100) ??
                  (JSON.stringify(c.toolResult.content?.[0]?.json)?.slice(0, 100) || "[empty]");
                return `toolResult(${c.toolResult.toolUseId},preview:${preview})`;
              }
              if (c.toolUse) return `toolUse(${c.toolUse.name})`;
              if ("reasoningContent" in c) return "reasoningContent";
              if ("thinking" in c) return "thinking";
              if ("redacted_thinking" in c) return "redacted_thinking";
              if ("cachePoint" in c) return "cachePoint";
              return "unknown";
            })
          : undefined,
        role: m.role,
      })),
    });

    // Log full message structures at trace level for detailed debugging
    logger.trace("[Bedrock Model Provider] Full request structure for reproduction:", {
      messages: requestInput.messages,
      system: requestInput.system,
      toolConfig: requestInput.toolConfig
        ? {
            toolChoice: requestInput.toolConfig.toolChoice,
            toolCount: requestInput.toolConfig.tools?.length,
          }
        : undefined,
    });
  }

  /**
   * Process the response stream and handle thinking blocks
   */
  private async processResponseStream(
    requestInput: ConverseStreamCommandInput,
    trackingProgress: Progress<LanguageModelResponsePart>,
    extendedThinkingEnabled: boolean,
    token: CancellationToken,
  ): Promise<void> {
    const abortController = new AbortController();
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    try {
      const stream = await this.client.startConversationStream(
        requestInput,
        abortController.signal,
      );

      logger.info("[Bedrock Model Provider] Processing stream events");
      const result = await this.streamProcessor.processStream(stream, trackingProgress, token);

      // Store thinking block for next request ONLY if it has a signature
      // API requires signatures for interleaved thinking, so we only store blocks we can inject
      if (extendedThinkingEnabled && result.thinkingBlock?.signature) {
        this.lastThinkingBlock = result.thinkingBlock;
        logger.info(
          "[Bedrock Model Provider] Stored thinking block with signature for next request:",
          {
            signatureLength: result.thinkingBlock.signature.length,
            textLength: result.thinkingBlock.text.length,
          },
        );
      } else if (extendedThinkingEnabled && result.thinkingBlock) {
        logger.info(
          "[Bedrock Model Provider] Discarding thinking block without signature (cannot be reused):",
          {
            textLength: result.thinkingBlock.text.length,
          },
        );
      }

      logger.info("[Bedrock Model Provider] Finished processing stream");
    } finally {
      cancellationListener.dispose();
    }
  }

  /**
   * Validate token count against model limits
   */
  private async validateTokenCount(
    model: LanguageModelChatInformation,
    requestInput: ConverseStreamCommandInput,
    token: CancellationToken,
  ): Promise<void> {
    const inputTokenCount = await this.countRequestTokens(
      model.id,
      {
        messages: requestInput.messages!,
        system: requestInput.system,
        toolConfig: requestInput.toolConfig,
      },
      token,
    );

    const tokenLimit = Math.max(1, model.maxInputTokens);
    if (inputTokenCount > tokenLimit) {
      logger.error("[Bedrock Model Provider] Message exceeds token limit", {
        inputTokenCount,
        tokenLimit,
      });
      throw new Error(
        `Message exceeds token limit. Input: ${inputTokenCount} tokens, Limit: ${tokenLimit} tokens.`,
      );
    }

    logger.debug("[Bedrock Model Provider] Token count validation passed", {
      inputTokenCount,
      tokenLimit,
    });
  }
}

/**
 * Known error messages that indicate context window overflow from Bedrock API
 * Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L28-L32
 */
const CONTEXT_WINDOW_OVERFLOW_MESSAGES = [
  "Input is too long for requested model",
  "input length and `max_tokens` exceed context limit",
  "too many total text bytes",
];

/**
 * Check if an error is due to context window overflow
 * @param error The error to check
 * @returns true if the error is due to context window overflow
 */
function isContextWindowOverflowError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const errorMessage = error instanceof Error ? error.message : inspect(error);
  return CONTEXT_WINDOW_OVERFLOW_MESSAGES.some((msg) => errorMessage.includes(msg));
}
