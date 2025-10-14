import { ConverseStreamCommandInput, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";
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
import { StreamProcessor } from "./stream-processor";
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
 */
const TOOL_INCAPABLE_MODEL_PATTERNS: RegExp[] = [
  // Amazon Titan Text (legacy models)
  /^([a-z]{2}\.)?amazon\.titan-text-/,

  // Stability AI (image generation)
  /^([a-z]{2}\.)?stability\./,

  // AI21 Jurassic 2 (older models)
  /^([a-z]{2}\.)?ai21\.j2-/,

  // Meta Llama 2 (doesn't support tools)
  /^([a-z]{2}\.)?meta\.llama-?2/,

  // Meta Llama 3.0 (only 3.1+ supports tools)
  /^([a-z]{2}\.)?meta\.llama-?3\.0/,

  // Cohere Embed (embedding models)
  /^([a-z]{2}\.)?cohere\.embed-/,

  // Amazon Titan Embed (embedding models)
  /^([a-z]{2}\.)?amazon\.titan-embed-/,
];

export class BedrockChatModelProvider implements LanguageModelChatProvider {
  private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
  private client: BedrockAPIClient;
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
            const inferenceProfileId = `${regionPrefix}.${m.modelId}`;
            const hasInferenceProfile = availableProfileIds.has(inferenceProfileId);
            const modelIdToUse = hasInferenceProfile ? inferenceProfileId : m.modelId;

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
              tooltip: `Amazon Bedrock - ${m.providerName}${hasInferenceProfile ? " (Cross-Region)" : ""}`,
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
        } catch (e) {
          logger.warn("[Bedrock Model Provider] Progress.report failed", {
            error: e instanceof Error ? { message: e.message, name: e.name } : String(e),
            modelId: model.id,
          });
        }
      },
    };

    try {
      logger.info("[Bedrock Model Provider] === NEW REQUEST ===");
      logger.info("[Bedrock Model Provider] Converting messages, count:", messages.length);
      messages.forEach((msg, idx) => {
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
        msg.content.forEach((part) => {
          if (part instanceof vscode.LanguageModelToolResultPart) {
            let contentPreview = "[Unable to preview]";
            try {
              const contentStr =
                typeof part.content === "string" ? part.content : JSON.stringify(part.content);
              contentPreview = contentStr.substring(0, 100);
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
        });
      });

      const converted = convertMessages(messages, model.id);

      logger.debug(
        "[Bedrock Model Provider] Converted to Bedrock messages:",
        converted.messages.length,
      );
      converted.messages.forEach((msg, idx) => {
        const contentTypes = msg.content?.map((c) => {
          if ("text" in c) return "text";
          if ("toolUse" in c) return "toolUse";
          return "toolResult";
        });
        logger.debug(
          `[Bedrock Model Provider] Bedrock message ${idx} (${msg.role}):`,
          contentTypes,
        );
      });

      // Validate the converted Bedrock messages, not the original VSCode messages
      // System messages are extracted separately and don't count in the alternating pattern
      validateBedrockMessages(converted.messages);

      const toolConfig = convertTools(options, model.id);

      if (options.tools && options.tools.length > 128) {
        throw new Error("Cannot have more than 128 tools per request.");
      }

      const inputTokenCount = this.estimateMessagesTokens(messages);
      const toolTokenCount = this.estimateToolTokens(toolConfig);
      const tokenLimit = Math.max(1, model.maxInputTokens);
      if (inputTokenCount + toolTokenCount > tokenLimit) {
        logger.error("[Bedrock Model Provider] Message exceeds token limit", {
          tokenLimit,
          total: inputTokenCount + toolTokenCount,
        });
        throw new Error("Message exceeds token limit.");
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

      // Add thinking configuration for supported models
      const settings = getBedrockSettings(this.globalState);
      const modelProfile = getModelProfile(model.id);
      if (settings.thinking.enabled && modelProfile.supportsThinking) {
        // For Anthropic models, calculate thinking budget as 20% of maxOutputTokens
        // This ensures the budget scales appropriately with the model's capabilities
        const modelLimits = getModelTokenLimits(model.id, settings.context1M.enabled);
        const dynamicBudget = Math.floor(modelLimits.maxOutputTokens * 0.2);

        // Validate thinking budget is less than configured maxTokens for this request
        const maxTokens = requestInput.inferenceConfig?.maxTokens ?? 4096;
        const budgetTokens = Math.min(dynamicBudget, maxTokens - 100); // Reserve 100 tokens for output

        if (budgetTokens >= 1024) {
          // Extended thinking requires temperature 1.0
          requestInput.inferenceConfig!.temperature = 1.0;

          requestInput.performanceConfig = {
            latency: "optimized",
          };

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
            temperature: 1.0,
          });
        }
      } else if (modelProfile.supports1MContext && settings.context1M.enabled) {
        // Even if thinking is not enabled, add 1M context beta header for supported models when setting is enabled
        const existingBeta = (requestInput.additionalModelRequestFields as Record<string, unknown>)
          ?.anthropic_beta;
        const betaArray = Array.isArray(existingBeta) ? existingBeta : [];

        requestInput.additionalModelRequestFields = {
          ...(requestInput.additionalModelRequestFields as Record<string, unknown>),
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
                    c.toolResult.content?.[0]?.text?.substring(0, 100) ||
                    JSON.stringify(c.toolResult.content?.[0]?.json)?.substring(0, 100) ||
                    "[empty]";
                  return `toolResult(${c.toolResult.toolUseId},preview:${preview})`;
                }
                if (c.toolUse) return `toolUse(${c.toolUse.name})`;
                return "unknown";
              })
            : undefined,
          role: m.role,
        })),
      });

      const stream = await this.client.startConversationStream(requestInput);

      logger.info("[Bedrock Model Provider] Processing stream events");
      await this.streamProcessor.processStream(stream, trackingProgress, token);
      logger.info("[Bedrock Model Provider] Finished processing stream");
    } catch (err) {
      logger.error("[Bedrock Model Provider] Chat request failed", {
        error: err instanceof Error ? { message: err.message, name: err.name } : String(err),
        messageCount: messages.length,
        modelId: model.id,
      });
      throw err;
    }
  }

  async provideTokenCount(
    _model: LanguageModelChatInformation,
    text: LanguageModelChatMessage | string,
    _token: CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Math.ceil(text.length / 4);
    } else {
      let totalTokens = 0;
      for (const part of text.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          totalTokens += Math.ceil(part.value.length / 4);
        }
      }
      return totalTokens;
    }
  }

  private estimateMessagesTokens(msgs: readonly vscode.LanguageModelChatMessage[]): number {
    let total = 0;
    for (const m of msgs) {
      for (const part of m.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          total += Math.ceil(part.value.length / 4);
        }
      }
    }
    return total;
  }

  private estimateToolTokens(toolConfig: ToolConfiguration | undefined): number {
    if (!toolConfig || toolConfig?.tools?.length === 0) {
      return 0;
    }
    try {
      const json = JSON.stringify(toolConfig);
      return Math.ceil(json.length / 4);
    } catch {
      return 0;
    }
  }
}

/**
 * Check if a model ID matches any of the tool-incapable patterns.
 * @param modelId The model ID to check (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0" or "us.anthropic.claude-...")
 * @returns true if the model is tool-incapable and should be excluded
 */
function isToolIncapableModel(modelId: string): boolean {
  return TOOL_INCAPABLE_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}
