import {
  ConverseStreamCommandInput,
  CountTokensCommandInput,
  Message,
  SystemContentBlock,
  ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { inspect } from "node:util";
import * as vscode from "vscode";
import {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelResponsePart,
  Progress,
} from "vscode";

import { hasAwsCredentials } from "./aws-profiles";
import { BedrockAPIClient } from "./bedrock-client";
import { convertMessages } from "./converters/messages";
import { convertTools } from "./converters/tools";
import { logger } from "./logger";
import { getModelProfile, getModelTokenLimits } from "./profiles";
import { getBedrockSettings } from "./settings";
import { StreamProcessor, ThinkingBlock } from "./stream-processor";
import { validateBedrockMessages } from "./validation";

/**
 * Patterns for models that do not support tool calling.
 * These models will be completely excluded from the provider list.
 *
 * Based on AWS Bedrock documentation:
 * - Legacy Titan Text models don't support Converse API tool use
 * - Stability AI models are for image generation only
 * - AI21 Jurassic 2 models don't support tool calling
 * - Meta Llama 2 and Llama 3.0 don't support tools (but 3.1+ do)
 * - Embedding models don't support conversational tool use
 *
 * Patterns support both regular model IDs and inference profiles (regional/global):
 * - Regular: anthropic.claude-...
 * - Regional: us.anthropic.claude-...
 * - Global: global.anthropic.claude-...
 */
const TOOL_INCAPABLE_MODEL_PATTERNS: RegExp[] = [
  // Amazon Titan Text (legacy models)
  /^(global|[a-z]{2,3}\.)?amazon\.titan-text-/,

  // Stability AI (image generation)
  /^(global|[a-z]{2,3}\.)?stability\./,

  // AI21 Jurassic 2 (older models)
  /^(global|[a-z]{2,3}\.)?ai21\.j2-/,

  // Meta Llama 2 (doesn't support tools)
  /^(global|[a-z]{2,3}\.)?meta\.llama-?2/,

  // Meta Llama 3.0 (only 3.1+ supports tools)
  /^(global|[a-z]{2,3}\.)?meta\.llama-?3\.0/,

  // Cohere Embed (embedding models)
  /^(global|[a-z]{2,3}\.)?cohere\.embed-/,

  // Amazon Titan Embed (embedding models)
  /^(global|[a-z]{2,3}\.)?amazon\.titan-embed-/,
];

export class BedrockChatModelProvider implements LanguageModelChatProvider {
  private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
  private client: BedrockAPIClient;
  private lastThinkingBlock?: ThinkingBlock;
  private streamProcessor: StreamProcessor;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly userAgent: string,
  ) {
    const settings = getBedrockSettings(this.globalState);
    this.client = new BedrockAPIClient(settings.region, settings.profile);
    this.streamProcessor = new StreamProcessor();
  }

  async prepareLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const settings = getBedrockSettings(this.globalState);

    // Check if this appears to be a first run (no profile configured and using default region)
    // Only prompt if credentials are also not available
    const isFirstRun = settings.region === "us-east-1" && !settings.profile && !hasAwsCredentials();

    if (isFirstRun && !options.silent) {
      const action = await vscode.window.showInformationMessage(
        "Amazon Bedrock integration requires AWS credentials. Would you like to configure your AWS profile and region first?",
        "Configure Settings",
        "Use Default Credentials",
      );

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

    this.client.setRegion(settings.region);
    this.client.setProfile(settings.profile);

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

          const [models, availableProfileIds] = await Promise.all([
            this.client.fetchModels(abortController.signal),
            this.client.fetchInferenceProfiles(abortController.signal),
          ]);

          const regionPrefix = settings.region.split("-")[0];

          // First, filter models by basic requirements and build candidate list
          const candidates: Array<{
            hasInferenceProfile: boolean;
            model: (typeof models)[0];
            modelIdToUse: string;
          }> = [];

          for (const m of models) {
            if (!m.responseStreamingSupported || !m.outputModalities.includes("TEXT")) {
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

            // Exclude models that don't support tool calling
            if (isToolIncapableModel(modelIdToUse)) {
              logger.debug(
                `[Bedrock Model Provider] Excluding tool-incapable model: ${modelIdToUse}`,
              );
              continue;
            }

            candidates.push({ hasInferenceProfile, model: m, modelIdToUse });
          }

          progress?.report({
            message: `Checking availability of ${candidates.length} models...`,
          });

          // Check model accessibility in parallel using allSettled to handle failures gracefully
          const accessibilityChecks = await Promise.allSettled(
            candidates.map(async (candidate) => {
              const isAccessible = await this.client.isModelAccessible(
                candidate.model.modelId,
                abortController.signal,
              );
              return { ...candidate, isAccessible };
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
            const vision = m.inputModalities.includes("IMAGE");

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
        vscode.window.showErrorMessage(
          `Failed to fetch Bedrock models. Please check your AWS profile and region settings. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
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

      // Check if extended thinking will be enabled for this request
      // We need this information before converting messages
      const settings = getBedrockSettings(this.globalState);
      const modelProfile = getModelProfile(model.id);
      const modelLimits = getModelTokenLimits(model.id, settings.context1M.enabled);
      const dynamicBudget = Math.floor(modelLimits.maxOutputTokens * 0.2);
      const maxTokensForRequest =
        typeof options.modelOptions?.max_tokens === "number"
          ? options.modelOptions.max_tokens
          : 4096;
      const budgetTokens = Math.min(dynamicBudget, maxTokensForRequest - 100);
      // Extended thinking enabled using official reasoningContent format
      const extendedThinkingEnabled =
        settings.thinking.enabled && modelProfile.supportsThinking && budgetTokens >= 1024;

      const converted = convertMessages(messages, model.id, {
        extendedThinkingEnabled,
        lastThinkingBlock: this.lastThinkingBlock,
        promptCachingEnabled: settings.promptCaching.enabled,
      });

      logger.debug(
        "[Bedrock Model Provider] Converted to Bedrock messages:",
        converted.messages.length,
      );
      for (const [idx, msg] of converted.messages.entries()) {
        const contentTypes = msg.content?.map((c) => {
          if ("text" in c) return "text";
          if ("toolUse" in c) return "toolUse";
          if ("toolResult" in c) return "toolResult";
          if ("reasoningContent" in c) return "reasoningContent";
          if ("thinking" in c || "redacted_thinking" in c) return "thinking";
          if ("cachePoint" in c) return "cachePoint";
          return "unknown";
        });
        logger.debug(
          `[Bedrock Model Provider] Bedrock message ${idx} (${msg.role}):`,
          contentTypes,
        );
      }

      // Validate the converted Bedrock messages, not the original VSCode messages
      // System messages are extracted separately and don't count in the alternating pattern
      validateBedrockMessages(converted.messages);

      // Pass extendedThinkingEnabled to skip tool_choice (incompatible with thinking)
      const toolConfig = convertTools(
        options,
        model.id,
        extendedThinkingEnabled,
        settings.promptCaching.enabled,
      );

      if (options.tools && options.tools.length > 128) {
        throw new Error("Cannot have more than 128 tools per request.");
      }

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
        const mo = options.modelOptions as Record<string, unknown>;
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

        // Build anthropic_beta array with required features
        const anthropicBeta: string[] = [];

        // Add interleaved-thinking beta header for Claude 4 models
        if (modelProfile.requiresInterleavedThinkingHeader) {
          anthropicBeta.push("interleaved-thinking-2025-05-14");
        }

        // Add 1M context beta header for models that support it and setting is enabled
        if (modelProfile.supports1MContext && settings.context1M.enabled) {
          anthropicBeta.push("context-1m-2025-08-07");
        }

        if (anthropicBeta.length > 0) {
          requestInput.additionalModelRequestFields.anthropic_beta = anthropicBeta;
        }

        logger.debug("[Bedrock Model Provider] Extended thinking enabled", {
          anthropicBeta: anthropicBeta.length > 0 ? anthropicBeta : undefined,
          budgetTokens,
          interleavedThinking: modelProfile.requiresInterleavedThinkingHeader,
          modelId: model.id,
          supports1MContext: modelProfile.supports1MContext,
          temperature: 1,
        });
      } else if (modelProfile.supports1MContext && settings.context1M.enabled) {
        // Even if thinking is not enabled, add 1M context beta header for supported models when setting is enabled
        const existingFields = (requestInput.additionalModelRequestFields ?? {}) as Record<
          string,
          unknown
        >;
        const existingBeta = existingFields.anthropic_beta;
        const betaArray = Array.isArray(existingBeta) ? (existingBeta as string[]) : [];

        requestInput.additionalModelRequestFields = {
          ...existingFields,
          anthropic_beta: [...betaArray, "context-1m-2025-08-07"],
        };

        logger.debug("[Bedrock Model Provider] 1M context enabled", {
          modelId: model.id,
        });
      }

      logger.info("[Bedrock Model Provider] Starting streaming request", {
        hasTools: !!toolConfig,
        messageCount: requestInput.messages?.length,
        modelId: model.id,
        systemMessageCount: requestInput.system?.length,
        toolCount: toolConfig?.tools?.length,
      });

      // Log the actual request for debugging
      logger.debug("[Bedrock Model Provider] Request details:", {
        messages: requestInput.messages?.map((m) => ({
          contentBlocks: Array.isArray(m.content)
            ? m.content.map((c) => {
                if (c.text) return "text";
                if (c.toolResult) {
                  const preview =
                    c.toolResult.content?.[0]?.text?.slice(0, 100) ||
                    JSON.stringify(c.toolResult.content?.[0]?.json)?.slice(0, 100) ||
                    "[empty]";
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

      // Count tokens and validate against model limits before sending request
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

      // Create AbortController for cancellation support
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
        if (extendedThinkingEnabled && result.thinkingBlock && result.thinkingBlock.signature) {
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

      try {
        // For simple string input, use estimation (CountTokens API expects structured messages)
        if (typeof text === "string") {
          return estimateTokens(text);
        }

        // Convert the message to Bedrock format
        const settings = getBedrockSettings(this.globalState);
        const converted = convertMessages([text], model.id, {
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
              ...(converted.system.length > 0 && { system: converted.system }),
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
            ...(input.system && input.system.length > 0 && { system: input.system }),
            ...(input.toolConfig && { toolConfig: input.toolConfig }),
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

  const errorMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : inspect(error);
  return CONTEXT_WINDOW_OVERFLOW_MESSAGES.some((msg) => errorMessage.includes(msg));
}

/**
 * Check if a model ID matches any of the tool-incapable patterns.
 * @param modelId The model ID to check (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0" or "us.anthropic.claude-...")
 * @returns true if the model is tool-incapable and should be excluded
 */
function isToolIncapableModel(modelId: string): boolean {
  return TOOL_INCAPABLE_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}
