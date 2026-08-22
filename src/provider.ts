/* eslint-disable unicorn/consistent-boolean-name -- provider parameters match VS Code and settings API names */
/* eslint-disable unicorn/consistent-class-member-order -- lifecycle event is exposed before private implementation state */
/* eslint-disable unicorn/consistent-function-scoping -- helper remains local to the token-counting workflow */
/* eslint-disable unicorn/no-break-in-nested-loop -- message scanning intentionally skips unsupported parts */
/* eslint-disable unicorn/prefer-includes-over-repeated-comparisons -- protocol checks are intentionally explicit */
/* eslint-disable unicorn/prefer-simple-condition-first -- condition order preserves short-circuit safety */
/* eslint-disable unicorn/prefer-ternary -- branches contain logging and control-flow side effects */

import { ModelModality } from "@aws-sdk/client-bedrock";
import type {
    ConverseStreamCommandInput,
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
    LanguageModelConfigurationSchema,
    LanguageModelResponsePart,
    LanguageModelResponsePart2,
    Progress,
} from "vscode";
import * as vscode from "vscode";

import { getRegionPrefix } from "./aws-partition";
import { BedrockAPIClient, ListFoundationModelsDeniedError } from "./bedrock-client";
import { convertMessages } from "./converters/messages";
import { convertTools } from "./converters/tools";
import { logger } from "./logger";
import { loadModelsDevData as loadModelsDevelopmentData } from "./models-dev";
import {
    getModelProfile,
    getModelTokenLimits,
    normalizeModelId,
    requires1MContextBetaHeader,
} from "./profiles";
import { getBedrockSettings, type ReasoningEffort, type ThinkingEffort } from "./settings";
import { StreamProcessor, type ThinkingBlock } from "./stream-processor";
import type {
    AuthConfig,
    AuthMethod,
    BedrockModelSummary,
    ModelsDevEntry as ModelsDevelopmentEntry,
    ModelsDevMap as ModelsDevelopmentMap,
} from "./types";
import { validateBedrockMessages } from "./validation";

type PickerLanguageModelChatInformation = LanguageModelChatInformation & {
  readonly capabilities: LanguageModelChatInformation["capabilities"] & {
    readonly agentMode: boolean;
  };
  readonly isUserSelectable: boolean;
};

class NoAccessibleModelsError extends Error {
  constructor() {
    super("No accessible Bedrock models detected");
    this.name = "NoAccessibleModelsError";
  }
}

export class BedrockChatModelProvider implements vscode.Disposable, LanguageModelChatProvider {
  // Event to notify VS Code that model information has changed
  private readonly _onDidChangeLanguageModelInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelInformation = this._onDidChangeLanguageModelInformation.event;

  private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
  private readonly client: BedrockAPIClient;
  /**
  Tracks whether the initial model fetch has completed (for avoiding startup feedback loops)
  */
  private initialFetchComplete = false;
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
   * Returns true if the initial model fetch has completed.
   * Used to avoid feedback loops when responding to onDidChangeChatModels during startup.
   */
  public isInitialFetchComplete(): boolean {
    return this.initialFetchComplete;
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
      }
      if (action !== "Use Default Credentials") {
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

          const [models, apiProfileIds, modelsDevelopmentMap] = await Promise.all([
            this.client.fetchModels(abortController.signal),
            this.client.fetchInferenceProfiles(abortController.signal),
            // Fetch models.dev data in parallel — provides live token limits, capability flags,
            // and pricing. Fails silently if offline.
            this.client.fetchModelsDevData(abortController.signal),
          ]);

          // Merge normal profile detection with any fallback profiles we detected when ListFoundationModels is blocked
          const availableProfileIds = new Set<string>(apiProfileIds);
          for (const fallbackId of this.client.getFallbackInferenceProfileIds()) {
            availableProfileIds.add(fallbackId);
          }

          // Fetch application inference profiles after we have foundation models
          const appProfiles = await this.client.fetchApplicationInferenceProfiles(
            models,
            abortController.signal,
          );

          // Extract region prefix for inference profile IDs (handles GovCloud, China, and commercial regions)
          const regionPrefix = getRegionPrefix(settings.region);
          const candidates = this.buildModelCandidates(
            models,
            availableProfileIds,
            regionPrefix,
            settings.inferenceProfiles.preferRegional,
            settings.region,
          );

          progress?.report({
            message: `Checking availability of ${candidates.length} models...`,
          });

          // Check model accessibility in parallel using allSettled to handle failures gracefully
          const accessibilityChecks = await Promise.allSettled(
            candidates.map(async (candidate) =>
              this.evaluateCandidateAccessibility(
                candidate,
                regionPrefix,
                availableProfileIds,
                settings.inferenceProfiles.preferRegional,
                abortController.signal,
                settings.region,
              ),
            ),
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

            const limits = this.resolveModelLimits(
              modelIdToUse,
              settings.context1M.enabled,
              modelsDevelopmentMap,
            );
            const maxInput = limits.maxInputTokens;
            const maxOutput = limits.maxOutputTokens;
            // Use models.dev modalities when available (more accurate than Bedrock API)
            const developmentEntry = modelsDevelopmentMap.get(modelIdToUse);
            const isVision = developmentEntry
              ? (developmentEntry.modalities?.input?.includes("image") ?? false)
              : m.inputModalities.includes(ModelModality.IMAGE);

            // Classify the invocation route so the tooltip can state it plainly.
            let route: string;
            if (!hasInferenceProfile) {
              route = "Direct foundation model";
            } else if (modelIdToUse.startsWith("global.")) {
              route = "Global inference profile";
            } else {
              route = "Local/regional inference profile";
            }

            const modelProfile = getModelProfile(modelIdToUse);
            const modelInfo: PickerLanguageModelChatInformation = {
              capabilities: {
                agentMode: true,
                imageInput: isVision,
                // Advertise tool calling for all models: profiles.ts correctly gates
                // tool use at request time via supportsToolChoice, but advertising
                // false here would break agent mode for any model not yet enumerated.
                toolCalling: true,
              },
              configurationSchema: this.buildConfigurationSchema(
                modelIdToUse,
                modelProfile,
                modelsDevelopmentMap,
              ),
              detail: this.formatDetail(modelIdToUse, maxInput, maxOutput, isVision),
              family: "bedrock",
              id: modelIdToUse,
              isUserSelectable: true,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              name: m.modelName,
              tooltip: this.formatTooltip({
                maxInput,
                maxOutput,
                modelId: modelIdToUse,
                providerName: m.providerName,
                route,
                vision: isVision,
              }),
              version: "1.0.0",
            };
            infos.push(modelInfo);
          }

          // Add application inference profiles
          progress?.report({
            message: `Processing ${appProfiles.length} application profiles...`,
          });

          for (const profile of appProfiles) {
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
            const limits = this.resolveModelLimits(
              modelIdForLimits,
              settings.context1M.enabled,
              modelsDevelopmentMap,
            );
            const maxInput = limits.maxInputTokens;
            const maxOutput = limits.maxOutputTokens;
            const developmentEntryForProfile = modelsDevelopmentMap.get(modelIdForLimits);
            const isVision = developmentEntryForProfile
              ? (developmentEntryForProfile.modalities?.input?.includes("image") ?? false)
              : profile.inputModalities.includes(ModelModality.IMAGE);

            const appProfileModelProfile = getModelProfile(modelIdForLimits);
            const profileInfo: PickerLanguageModelChatInformation = {
              capabilities: {
                agentMode: true,
                imageInput: isVision,
                toolCalling: true,
              },
              configurationSchema: this.buildConfigurationSchema(
                modelIdForLimits,
                appProfileModelProfile,
                modelsDevelopmentMap,
              ),
              detail: this.formatDetail(modelIdForLimits, maxInput, maxOutput, isVision),
              family: "bedrock",
              id: profile.modelArn,
              isUserSelectable: true,
              maxInputTokens: maxInput,
              maxOutputTokens: maxOutput,
              name: profile.modelName,
              tooltip: this.formatTooltip({
                maxInput,
                maxOutput,
                modelId: modelIdForLimits,
                providerName: profile.providerName,
                route: "Application inference profile",
                vision: isVision,
              }),
              version: "1.0.0",
            };
            infos.push(profileInfo);
          }

          // Sort models: inference profiles by updatedAt/createdAt (newest first), then others
          progress?.report({ message: "Sorting models..." });

          // Build lookup map for O(1) access during sorting
          const modelDateMap = new Map<string, Date | undefined>();
          for (const c of candidates) {
            const date = c.model.updatedAt ?? c.model.createdAt;
            modelDateMap.set(c.model.modelId, date);
            modelDateMap.set(c.model.modelArn, date);
          }
          for (const p of appProfiles) {
            const date = p.updatedAt ?? p.createdAt;
            modelDateMap.set(p.modelId, date);
            modelDateMap.set(p.modelArn, date);
          }

          infos.sort((a, b) => {
            const aDate = modelDateMap.get(a.id);
            const bDate = modelDateMap.get(b.id);

            // If both have dates, sort by date (newest first)
            if (aDate && bDate) {
              return bDate.getTime() - aDate.getTime();
            }

            // Models with dates come before models without dates
            if (aDate) return -1;
            if (bDate) return 1;

            // If neither has a date, maintain original order
            return 0;
          });

          if (infos.length === 0) {
            throw new NoAccessibleModelsError();
          }

          this.chatEndpoints = infos.map((info) => ({
            model: info.id,
            modelMaxPromptTokens: info.maxInputTokens,
          }));

          // Mark initial fetch as complete to allow onDidChangeChatModels handling
          this.initialFetchComplete = true;

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
        if (error instanceof ListFoundationModelsDeniedError) {
          const manualModelId = await vscode.window.showInputBox({
            placeHolder: "global.anthropic.claude-sonnet-4-6",
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
                  modelMaxPromptTokens: manualInfo.maxInputTokens,
                },
              ];
              return [manualInfo];
            }
          }

          vscode.window.showErrorMessage(
            "Could not detect any Bedrock models with current permissions. Please update your AWS policy or provide a reachable model ID.",
          );
        } else if (error instanceof NoAccessibleModelsError) {
          const manualModelId = await vscode.window.showInputBox({
            placeHolder: "global.anthropic.claude-sonnet-4-6",
            prompt:
              "No accessible Bedrock models were detected. Enter a Bedrock model ID or inference profile ID to use.",
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
                  modelMaxPromptTokens: manualInfo.maxInputTokens,
                },
              ];
              return [manualInfo];
            }
          }

          vscode.window.showErrorMessage(
            "Could not detect any accessible Bedrock models. Please update your AWS policy or provide a reachable model ID.",
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

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Chat response handling requires validation of thinking config and error handling
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const trackingProgress: Progress<LanguageModelResponsePart2> = {
      report: (part) => {
        try {
          // progress is typed as Progress<LanguageModelResponsePart> (stable API surface)
          // but VS Code's runtime accepts the full LanguageModelResponsePart2 union
          // (including LanguageModelDataPart and LanguageModelThinkingPart). Cast the
          // progress object once so we can pass extended parts without per-call assertions.
          (progress as Progress<LanguageModelResponsePart2>).report(part);
        } catch (error) {
          logger.warn("[Bedrock Model Provider] Progress.report failed", {
            error:
              error instanceof Error ? { message: error.message, name: error.name } : String(error),
            modelId: model.id,
          });
          // Re-throw so callers can detect emission failures (e.g. stream-processor
          // uses try-catch around ThinkingPart emission to track hasEmittedThinking).
          throw error;
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

      // Resolve model ID for application inference profiles (ARNs) to base model ID.
      // getModelProfile and resolveModelLimits expect base model IDs, not ARNs.
      // For the actual API call we still use the original model.id (ARN for app profiles).
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

      // Look up the bundled models.dev entry for this model. Used as a fallback
      // for capability flags that profiles.ts may not yet enumerate for newly-added
      // models (temperatureDeprecated, tool_call support).
      const modelsDevelopmentMap = loadModelsDevelopmentData();
      const normalizedBaseId = normalizeModelId(baseModelId);
      const chatDevelopmentEntry = resolveModelsDevelopmentEntry(
        baseModelId,
        normalizedBaseId,
        modelsDevelopmentMap,
      );

      // temperatureDeprecated: profiles.ts is authoritative; fall back to
      // models.dev `temperature: false` for models not yet enumerated.
      // User can override with bedrock.temperature.override setting:
      // - null/undefined = use auto-detection (default)
      // - true = disable temperature on all models (temperatureDeprecated = true)
      // - false = enable temperature on all models (temperatureDeprecated = false)
      let isEffectiveTemperatureDeprecated =
        modelProfile.temperatureDeprecated || chatDevelopmentEntry?.temperature === false;

      if (settings.temperature.override !== undefined) {
        // User override: true means disable temp (deprecated), false means enable temp (not deprecated)
        isEffectiveTemperatureDeprecated = settings.temperature.override;
      }

      // tool_call: profiles.ts is authoritative; fall back to models.dev
      // `tool_call: false` to suppress tool configs for unknown models that
      // reject them (avoids ValidationException on new text-only additions).
      const isEffectiveToolCallSupported =
        modelProfile.supportsToolChoice || chatDevelopmentEntry?.tool_call !== false;

      // Apply per-request overrides from the VS Code model-picker UI.
      // When the user selects a context size, thinking effort, or reasoning
      // effort in the model picker, VS Code passes those choices back as
      // `options.modelConfiguration` (proposed `chatProvider` API).  We merge
      // them on top of the workspace/user settings so the UI controls take
      // precedence for this specific request without permanently changing the
      // saved settings.
      const mc = (options as { modelConfiguration?: Record<string, unknown> }).modelConfiguration;

      // context1M override: the picker value fully overrides settings.context1M.enabled
      // for this request — so the user can turn 1M *off* for a single request even when
      // the workspace setting has it enabled.
      const isContext1MEnabled =
        typeof mc?.contextSize === "number"
          ? mc.contextSize >= 1_000_000
          : settings.context1M.enabled;

      // thinkingEffort override: picker value wins over workspace setting.
      const validThinkingEfforts: readonly ThinkingEffort[] = [
        "high",
        "low",
        "max",
        "medium",
        "xhigh",
      ];
      const thinkingEffortOverride =
        typeof mc?.thinkingEffort === "string" &&
        validThinkingEfforts.includes(mc.thinkingEffort as ThinkingEffort)
          ? (mc.thinkingEffort as ThinkingEffort)
          : undefined;
      const effectiveThinkingEffort: ThinkingEffort =
        thinkingEffortOverride ?? settings.thinking.effort;

      // reasoningEffort: profiles.ts is authoritative. A models.dev entry with
      // reasoning=true can only ADD support when profiles.ts has no explicit
      // opinion; it must never override an explicit profiles.ts opt-out (e.g.
      // gpt-5.x named variants -- Luna/Sol/Terra -- which are CLI-verified to
      // reject the field).
      const isAnthropicBaseModel = baseModelId.toLowerCase().includes("anthropic.");
      const isEffectiveSupportsReasoningEffort =
        !isNamedGpt5Variant(baseModelId) &&
        (modelProfile.supportsReasoningEffort ||
          (chatDevelopmentEntry?.reasoning === true && !isAnthropicBaseModel));

      // reasoningEffort override: picker value wins over workspace setting.
      const validReasoningEfforts: readonly ReasoningEffort[] = [
        "minimal",
        "low",
        "medium",
        "high",
      ];
      const reasoningEffortOverride =
        typeof mc?.reasoningEffort === "string" &&
        validReasoningEfforts.includes(mc.reasoningEffort as ReasoningEffort)
          ? (mc.reasoningEffort as ReasoningEffort)
          : undefined;
      const effectiveReasoningEffort: ReasoningEffort | undefined =
        reasoningEffortOverride ?? settings.reasoningEffort;

      if (mc && Object.keys(mc).length > 0) {
        logger.debug("[Bedrock Model Provider] Applying modelConfiguration overrides", {
          context1MEnabled: isContext1MEnabled,
          modelConfiguration: mc,
          reasoningEffort: effectiveReasoningEffort,
          thinkingEffort: effectiveThinkingEffort,
        });
      }

      // Use the model's live limits (already resolved via resolveModelLimits at construction time).
      // model.maxOutputTokens reflects models.dev data where available, with getModelTokenLimits
      // as fallback — no need to call getModelTokenLimits again here.
      const effectiveMaxOutputTokens = model.maxOutputTokens;

      // Calculate thinking configuration
      // Use model's maxOutputTokens as default when VSCode doesn't provide max_tokens.
      // This prevents thinking budget starvation that causes MAX_TOKENS errors
      // (GitHub Copilot uses server-configured large values + 16K thinking budget by default)
      const maxTokensForRequest =
        typeof options.modelOptions?.max_tokens === "number"
          ? options.modelOptions.max_tokens
          : effectiveMaxOutputTokens;
      const { budgetTokens, extendedThinkingEnabled: initialThinkingEnabled } =
        this.calculateThinkingConfig(
          modelProfile,
          effectiveMaxOutputTokens,
          maxTokensForRequest,
          settings.thinking.enabled,
        );
      let isExtendedThinkingEnabled = initialThinkingEnabled;

      // Check if we can actually use extended thinking with the current conversation history
      // When thinking is enabled, ALL assistant messages must have thinking blocks.
      // VSCode doesn't preserve thinking blocks, so we can only inject our stored lastThinkingBlock.
      // This means we can only support thinking when:
      // - There are no previous assistant messages (first turn), OR
      // - There is exactly one previous assistant message AND we have a stored thinking block
      // If there are 2+ assistant messages, we can't provide thinking blocks for all of them.
      if (isExtendedThinkingEnabled) {
        const assistantMessageCount = messages.filter(
          (m) => m.role === vscode.LanguageModelChatMessageRole.Assistant,
        ).length;

        if (assistantMessageCount > 1) {
          // Can't inject thinking blocks for multiple previous assistant messages
          // Each assistant message needs its own unique thinking block, but we only have one stored
          logger.warn(
            "[Bedrock Model Provider] Disabling extended thinking - multiple assistant messages in history require individual thinking blocks",
            { assistantMsgCount: assistantMessageCount },
          );
          isExtendedThinkingEnabled = false;
          // Clear stale thinking block to prevent it from being misapplied if conversation
          // history later truncates back to a single assistant message (signatures are
          // integrity-bound to specific thinking blocks)
          this.lastThinkingBlock = undefined;
        } else if (assistantMessageCount === 1 && !this.lastThinkingBlock?.signature) {
          // Have one assistant message but no thinking block to inject
          logger.warn(
            "[Bedrock Model Provider] Disabling extended thinking - no stored thinking block available for previous assistant message",
          );
          isExtendedThinkingEnabled = false;
        }
      }

      // Convert messages with thinking configuration
      const converted = convertMessages(messages, baseModelId, {
        extendedThinkingEnabled: isExtendedThinkingEnabled,
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
        isExtendedThinkingEnabled,
        settings.promptCaching.enabled,
        isEffectiveToolCallSupported,
      );

      if (options.tools && options.tools.length > 128) {
        throw new Error("Cannot have more than 128 tools per request.");
      }

      // Determine if thinking effort should be applied (only for Opus 4.5 and Sonnet 4.6)
      const isThinkingEffortEnabled = modelProfile.supportsThinkingEffort;

      // Build beta headers — use the effective context1M flag (may be overridden by
      // the model-picker contextSize selection via modelConfiguration)
      const betaHeaders = this.buildBetaHeaders(
        modelProfile,
        baseModelId,
        isExtendedThinkingEnabled,
        isContext1MEnabled,
        isThinkingEffortEnabled,
      );

      // Build request input — use effective effort values (model-picker overrides win)
      const requestInput = this.buildRequestInput(
        model,
        baseModelId,
        converted,
        options,
        toolConfig,
        isExtendedThinkingEnabled,
        budgetTokens,
        betaHeaders,
        isThinkingEffortEnabled ? effectiveThinkingEffort : undefined,
        isEffectiveTemperatureDeprecated,
        modelProfile.requiresAdaptiveThinking,
        isEffectiveSupportsReasoningEffort ? effectiveReasoningEffort : undefined,
      );

      // Log request details
      this.logRequestDetails(requestInput);

      // Process the stream, with a generic one-shot retry that strips any
      // request field the model rejects as "unknown"/unsupported. This
      // protects against Bedrock exposing new models that don't yet support
      // a parameter our profiles.ts / models.dev heuristics enabled (e.g. a
      // model rejecting `reasoning_effort`). On retry we surface a warning to
      // the user so they can report the gap to the extension maintainers.
      await this.processResponseStreamWithFallback(
        requestInput,
        trackingProgress,
        isExtendedThinkingEnabled,
        token,
        model.id,
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
        throw new Error(errorMessage, { cause: error });
      }

      // Extract detailed error information from AWS SDK error
      const errorDetails: Record<string, unknown> = {
        messageCount: messages.length,
        modelId: model.id,
      };

      if (error instanceof Error) {
        errorDetails.error = {
          message: error.message,
          name: error.name,
          stack: error.stack,
        };

        // AWS SDK errors have additional metadata in hidden fields
        const awsError = error as unknown as Record<string, unknown>;

        // Extract $metadata
        if (awsError.$metadata) {
          errorDetails.awsMetadata = awsError.$metadata;
        }

        // Use util.format with %O to capture hidden fields like $response
        // This properly shows non-enumerable properties that inspect might miss
        errorDetails.fullErrorWithFormat = inspect(error, {
          depth: 10,
          getters: true,
          maxArrayLength: 100,
          maxStringLength: 1000,
          showHidden: true,
        });
      } else {
        errorDetails.error = String(error);
      }

      logger.error("[Bedrock Model Provider] Chat request failed", errorDetails);
      throw error;
    }
  }

  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: LanguageModelChatMessage | string,
    token: CancellationToken,
  ): Promise<number> {
    // Model-specific token multipliers for accurate local estimation
    // These override the default length/4 heuristic for models with known token patterns
    const getTokenMultiplier = (modelId: string): number => {
      const normalizedId = modelId.toLowerCase();

      // Sonnet models use approximately 1.3x more tokens due to tokenizer characteristics
      if (normalizedId.includes("sonnet")) {
        return 1.3;
      }

      // Haiku models use approximately 1.0x (baseline)
      if (normalizedId.includes("haiku")) {
        return 1;
      }

      // Opus models use approximately 1.1x
      if (normalizedId.includes("opus")) {
        return 1.1;
      }

      // OpenAI gpt-5.x models typically use slightly fewer tokens
      if (normalizedId.includes("gpt-5")) {
        return 0.95;
      }

      // Default fallback for unknown models
      return 1;
    };

    // Estimate the character length of a single message content part.
    // Text parts count directly; tool calls/results serialize their payload
    // so large tool inputs/outputs aren't undercounted as zero tokens.
    const estimatePartCharLength = (part: unknown): number => {
      if (part instanceof vscode.LanguageModelTextPart) {
        return part.value.length;
      }
      if (part instanceof vscode.LanguageModelToolCallPart) {
        try {
          return JSON.stringify(part.input).length;
        } catch {
          return 0;
        }
      }
      if (part instanceof vscode.LanguageModelToolResultPart) {
        return part.content.reduce(
          (sum: number, inner: unknown) => sum + estimatePartCharLength(inner),
          0,
        );
      }
      return 0;
    };

    // Image MIME types that convertMessages actually forwards to Bedrock as
    // image content blocks (see isImageDataPart in converters/messages.ts).
    const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

    // Estimate the token cost of a single image data part. convertMessages
    // sends PNG/JPEG/GIF/WebP LanguageModelDataPart values to Bedrock as
    // image blocks, but images don't tokenize like text -- counting their
    // raw byte length via char_count/4 would wildly overcount, while
    // returning 0 (the previous behavior) undercounts and can cause context
    // overflows to go undetected. Without decoding pixel dimensions, use a
    // conservative estimate based on the base64-encoded payload size, which
    // approximates Claude's vision token cost of roughly
    // (width * height) / 750 for typical photo/screenshot compression ratios.
    const estimateImageTokens = (dataLength: number): number => {
      const base64Length = Math.ceil(dataLength / 3) * 4;
      return Math.ceil(base64Length / 100);
    };

    // Sum image token costs (bypasses the char_count/4 + multiplier path
    // used for text, since image tokenization doesn't scale the same way).
    const estimateImagePartTokens = (part: unknown): number => {
      if (
        part instanceof vscode.LanguageModelDataPart &&
        SUPPORTED_IMAGE_MIME_TYPES.has(part.mimeType)
      ) {
        return estimateImageTokens(part.data.length);
      }
      if (part instanceof vscode.LanguageModelToolResultPart) {
        return part.content.reduce(
          (sum: number, inner: unknown) => sum + estimateImagePartTokens(inner),
          0,
        );
      }
      return 0;
    };

    // Fallback estimation function with model-aware token multipliers
    const estimateTokens = (input: LanguageModelChatMessage | string, modelId: string): number => {
      const multiplier = getTokenMultiplier(modelId);
      if (typeof input === "string") {
        return Math.ceil((input.length / 4) * multiplier);
      }

      const charLength = input.content.reduce(
        (sum: number, part: unknown) => sum + estimatePartCharLength(part),
        0,
      );
      const imageTokens = input.content.reduce(
        (sum: number, part: unknown) => sum + estimateImagePartTokens(part),
        0,
      );

      return Math.ceil((charLength / 4) * multiplier) + imageTokens;
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
        // trace level: provideTokenCount runs many times per turn, this would flood the log
        logger.trace("[Bedrock Model Provider] Resolved model ID", {
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
          return estimateTokens(text, baseModelId);
        }

        // Use the local estimate by default. The CountTokens API adds a network
        // round trip and may be denied even when Converse is permitted.
        return estimateTokens(text, baseModelId);
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
      return estimateTokens(text, model.id);
    }
  }

  /**
   * Apply extended-thinking-related fields (thinking, beta headers, optional
   * output_config.effort, and the temperature override) to the request input.
   * Extracted from configureAdditionalModelFields to keep cognitive complexity
   * below the SonarJS threshold.
   */
  private applyExtendedThinkingFields(
    requestInput: ConverseStreamCommandInput,
    modelId: string,
    budgetTokens: number,
    betaHeaders: string[],
    thinkingEffort: ThinkingEffort | undefined,
    temperatureDeprecated: boolean | undefined,
    requiresAdaptiveThinking: boolean | undefined,
  ): void {
    // Extended thinking normally requires temperature 1.0, but Claude Opus 4.7
    // rejects any `temperature` parameter. For all other models, force 1.0.
    if (!temperatureDeprecated) {
      requestInput.inferenceConfig!.temperature = 1;
    }

    // CLI-verified: Claude Opus 4.7 rejects thinking.type="enabled" and
    // requires thinking.type="adaptive" (with no budget_tokens). All other
    // Claude models still use enabled+budget.
    const thinkingField: { budget_tokens?: number; type: "adaptive" | "enabled" } =
      requiresAdaptiveThinking
        ? { type: "adaptive" }
        : { budget_tokens: budgetTokens, type: "enabled" };

    requestInput.additionalModelRequestFields = {
      thinking: thinkingField,
      ...(betaHeaders.length > 0 && { anthropic_beta: betaHeaders }),
      // Add thinking effort for Claude Opus 4.5 and Sonnet 4.6 (controls token expenditure)
      ...(thinkingEffort && { output_config: { effort: thinkingEffort } }),
    };

    logger.debug("[Bedrock Model Provider] Extended thinking enabled", {
      anthropicBeta: betaHeaders.length > 0 ? betaHeaders : undefined,
      budgetTokens: requiresAdaptiveThinking ? "(adaptive)" : budgetTokens,
      interleavedThinking: betaHeaders.includes("interleaved-thinking-2025-05-14"),
      modelId,
      supports1MContext: betaHeaders.includes("context-1m-2025-08-07"),
      temperature: temperatureDeprecated ? "(omitted)" : 1,
      thinkingEffort: thinkingEffort ?? "(not applicable)",
      thinkingType: requiresAdaptiveThinking ? "adaptive" : "enabled",
    });
  }

  /**
   * Merge the OpenAI-style `reasoning_effort` field into
   * additionalModelRequestFields, alongside anything already set by
   * thinking/beta-header handling. Called last so the field coexists with
   * Anthropic's `thinking` / `output_config` blocks.
   *
   * Only OpenAI gpt-oss accepts `minimal`; for other providers that opted in
   * (DeepSeek V3.2, Kimi K2.x, Qwen3, GLM, MiniMax) `minimal` is clamped to
   * `low` to avoid a Converse ValidationException.
   */
  private applyReasoningEffort(
    requestInput: ConverseStreamCommandInput,
    modelId: string,
    baseModelId: string,
    reasoningEffort: ReasoningEffort,
  ): void {
    const openAiIndex = baseModelId.indexOf("openai.");
    const normalizedBaseModelId = openAiIndex === -1 ? baseModelId : baseModelId.slice(openAiIndex);
    const isSupportsMinimalReasoningEffort =
      getModelProfile(normalizedBaseModelId).supportsReasoningEffort &&
      normalizedBaseModelId.startsWith("openai.");
    const resolved =
      reasoningEffort === "minimal" && !isSupportsMinimalReasoningEffort ? "low" : reasoningEffort;
    requestInput.additionalModelRequestFields = {
      ...((requestInput.additionalModelRequestFields ?? {}) as Record<string, unknown>),
      reasoning_effort: resolved,
    };
    logger.debug("[Bedrock Model Provider] reasoning_effort set", {
      baseModelId,
      modelId,
      reasoningEffort: resolved,
    });
  }

  /**
   * Build beta headers array for the request
   */
  private buildBetaHeaders(
    modelProfile: ReturnType<typeof getModelProfile>,
    modelId: string,
    extendedThinkingEnabled: boolean,
    context1MEnabled: boolean,
    thinkingEffortEnabled: boolean,
  ): string[] {
    const anthropicBeta: string[] = [];
    const shouldAdd1MContextBetaHeader =
      modelProfile.supports1MContext && context1MEnabled && requires1MContextBetaHeader(modelId);

    if (extendedThinkingEnabled) {
      // Add interleaved-thinking beta header for Claude 4 models
      if (modelProfile.requiresInterleavedThinkingHeader) {
        anthropicBeta.push("interleaved-thinking-2025-05-14");
      }

      // Add 1M context beta header only for models that require the beta opt-in.
      if (shouldAdd1MContextBetaHeader) {
        anthropicBeta.push("context-1m-2025-08-07");
      }
    } else if (shouldAdd1MContextBetaHeader) {
      // Even if thinking is not enabled, add the 1M context beta header when required.
      anthropicBeta.push("context-1m-2025-08-07");
    }

    // Add effort beta header for Claude Opus 4.5 and Sonnet 4.6 when thinking effort is configured
    if (thinkingEffortEnabled) {
      anthropicBeta.push("effort-2025-11-24");
    }

    return anthropicBeta;
  }

  /**
   * Build a {@link LanguageModelConfigurationSchema} for a model so that VS Code
   * renders context-size and thinking/reasoning controls in the model-picker UI —
   * the same controls shown for built-in Copilot models.
   *
   * Capability flags come from two sources (both already computed before this call):
   * 1. {@link getModelProfile} — Bedrock-specific flags like `supportsThinkingEffort`,
   *    `requiresInterleavedThinkingHeader`, `supportsReasoningEffort`, etc.
   * 2. `modelsDevMap` — live data from models.dev, used to auto-detect reasoning
   *    support for new non-Anthropic models not yet in `profiles.ts`.
   *
   * - **contextSize** — shown only when the model has an *optional* 1M context
   *   window that requires an opt-in beta header (Opus 4.6, Sonnet 4.x).
   *   Models where 1M is always-on (Opus 4.7/4.8) don't get the picker.
   *   The standard limit is `standardMaxInputTokens + maxOutputTokens` as
   *   computed by {@link resolveModelLimits} with `context1MEnabled=false`.
   * - **thinkingEffort** — shown for models where `supportsThinkingEffort` is
   *   true (Claude Opus 4.5/4.6/4.8, Sonnet 4.6). Effort levels come from the
   *   profile; no hardcoding.
   * - **reasoningEffort** — shown for models where `supportsReasoningEffort` is
   *   true (DeepSeek V3.2, Kimi K2, Qwen3, GLM, MiniMax, OpenAI gpt-oss), OR
   *   where models.dev reports `reasoning: true` for a non-Anthropic model not
   *   yet in `profiles.ts`. The `minimal` level is only added for OpenAI models.
   *
   * The selected values are returned as `modelConfiguration` in
   * {@link LanguageModelChatRequestHandleOptions} and override the corresponding
   * workspace/user settings for that individual request.
   */
  private buildConfigurationSchema(
    modelId: string,
    modelProfile: ReturnType<typeof getModelProfile>,
    modelsDevelopmentMap: ModelsDevelopmentMap = new Map(),
  ): LanguageModelConfigurationSchema | undefined {
    // Mutable during construction; returned as LanguageModelConfigurationSchema.
    const properties: Record<string, Record<string, unknown>> = {};

    // Resolve the models.dev entry for live capability data.
    // normalizeModelId strips regional prefixes (us., eu., global., etc.) so we
    // can match against the bare model IDs stored in models.dev. Falls back to
    // a full-map scan by normalized ID (same as resolveModelLimits and the
    // chatDevelopmentEntry lookup in provideLanguageModelChatResponse) because
    // models.dev entries can be stored under a different regional prefix than
    // the one currently selected (e.g. picker uses `us.` but models.dev only
    // has a `global.` entry for the same base model).
    const normalizedId = normalizeModelId(modelId);
    const developmentEntry = resolveModelsDevelopmentEntry(modelId, normalizedId, modelsDevelopmentMap);

    // ── Context size picker ────────────────────────────────────────────────
    // Only shown for models where 1M context is an *optional* beta-header opt-in
    // (Opus 4.6, Sonnet 4.5). Always-1M models (Opus 4.7/4.8, Sonnet 4.6) and
    // models with no 1M support get no picker.
    // Enum values are the full context window sizes (200_000 / 1_000_000) so that
    // the contextSize override check in provideLanguageModelChatResponse can simply
    // test `contextSize >= 1_000_000`. The picker is skipped if both options are equal.
    if (requires1MContextBetaHeader(modelId)) {
      const standardContextTotal = 200_000;
      const extended1MTotal = 1_000_000;
      const fmt = (n: number) => {
        const k = Math.round(n / 1000);
        return k >= 1000 ? `${Math.round(k / 1000)}M` : `${k}K`;
      };
      properties.contextSize = {
        default: standardContextTotal,
        description: "Context window size for this request",
        enum: [standardContextTotal, extended1MTotal],
        enumDescriptions: [
          "Default context window (standard pricing)",
          "Extended 1M context window (may increase cost)",
        ],
        enumItemLabels: [fmt(standardContextTotal), fmt(extended1MTotal)],
        group: "tokens",
        title: "Context Size",
        type: "number",
      };
    }

    // ── Thinking effort ────────────────────────────────────────────────────
    // `supportsThinkingEffort` is set in `profiles.ts` for models that accept
    // Claude's `output_config.effort` field (Opus 4.5/4.6/4.8, Sonnet 4.6).
    // Three tiers based on model capability flags from profiles.ts:
    //   - Extended  (Opus 4.7/4.8, requiresAdaptiveThinking): low/medium/high/xhigh/max
    //   - Max-capable (Opus 4.6, supportsMaxEffort):           low/medium/high/max
    //   - Basic     (Opus 4.5, Sonnet 4.6):                    low/medium/high
    // AWS Bedrock docs confirm "max" is Opus 4.6 only; "xhigh" is Opus 4.7/4.8 only.
    // Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html
    if (modelProfile.supportsThinkingEffort) {
      if (modelProfile.requiresAdaptiveThinking) {
        // Opus 4.7 / 4.8: full 5-level picker
        properties.thinkingEffort = {
          default: "high",
          description:
            "Controls how many tokens Claude spends thinking before responding. Higher effort produces better results but uses more tokens.",
          enum: ["low", "medium", "high", "xhigh", "max"],
          enumDescriptions: [
            "Most efficient — significant token savings. Best for simpler tasks.",
            "Balanced approach with moderate token savings. Good for most tasks.",
            "High capability — Claude uses as many tokens as needed. Best for complex reasoning.",
            "Extended capability for long-horizon agentic and coding tasks.",
            "Absolute maximum — no constraints on thinking depth.",
          ],
          enumItemLabels: ["Low", "Medium", "High", "Extra High", "Maximum"],
          group: "navigation",
          title: "Thinking Amount",
          type: "string",
        };
      } else if (modelProfile.supportsMaxEffort) {
        // Opus 4.6: 4-level picker (max but no xhigh)
        properties.thinkingEffort = {
          default: "high",
          description:
            "Controls how many tokens Claude spends thinking before responding. Higher effort produces better results but uses more tokens.",
          enum: ["low", "medium", "high", "max"],
          enumDescriptions: [
            "Most efficient — significant token savings. Best for simpler tasks.",
            "Balanced approach with moderate token savings. Good for most tasks.",
            "High capability — Claude uses as many tokens as needed. Best for complex reasoning.",
            "Absolute maximum — no constraints on thinking depth.",
          ],
          enumItemLabels: ["Low", "Medium", "High", "Maximum"],
          group: "navigation",
          title: "Thinking Amount",
          type: "string",
        };
      } else {
        // Opus 4.5 / Sonnet 4.6: basic 3-level picker
        properties.thinkingEffort = {
          default: "high",
          description:
            "Controls how many tokens Claude spends thinking before responding. Higher effort produces better results but uses more tokens.",
          enum: ["low", "medium", "high"],
          enumDescriptions: [
            "Most efficient — significant token savings. Best for simpler tasks.",
            "Balanced approach with moderate token savings. Good for most tasks.",
            "Maximum capability — Claude uses as many tokens as needed. Best for complex reasoning.",
          ],
          enumItemLabels: ["Low", "Medium", "High"],
          group: "navigation",
          title: "Thinking Amount",
          type: "string",
        };
      }
    }

    // ── Reasoning effort ──────────────────────────────────────────────────
    // Use profiles.ts flag as primary signal. Supplement with models.dev:
    // if models.dev says `reasoning: true` for a non-Anthropic model that
    // profiles.ts doesn't know about yet, show the picker for it too.
    // gpt-5.x named variants (Luna/Sol/Terra) are excluded even if models.dev
    // reports `reasoning: true` -- they're CLI-verified to reject the field,
    // so the picker would offer a control with no effect (see isNamedGpt5Variant).
    const isAnthropicModel = modelId.toLowerCase().includes("anthropic.");
    const isDevelopmentSupportsReasoning =
      developmentEntry?.reasoning === true && !isAnthropicModel;
    if (
      !isNamedGpt5Variant(modelId) &&
      (modelProfile.supportsReasoningEffort || isDevelopmentSupportsReasoning)
    ) {
      const isOpenAI = modelId.toLowerCase().includes("openai.");
      const effortLevels = isOpenAI
        ? (["minimal", "low", "medium", "high"] as const)
        : (["low", "medium", "high"] as const);
      properties.reasoningEffort = {
        default: "medium",
        description: "Controls how much reasoning the model performs before responding.",
        enum: effortLevels,
        enumDescriptions: isOpenAI
          ? [
              "Fastest, lowest cost (OpenAI gpt-oss only).",
              "Lowest reasoning budget.",
              "Balanced reasoning budget.",
              "Maximum reasoning budget.",
            ]
          : ["Lowest reasoning budget.", "Balanced reasoning budget.", "Maximum reasoning budget."],
        enumItemLabels: isOpenAI ? ["Minimal", "Low", "Medium", "High"] : ["Low", "Medium", "High"],
        group: "navigation",
        title: "Reasoning Effort",
        type: "string",
      };
    }

    // Return without an explicit cast: TypeScript infers { properties } satisfies
    // LanguageModelConfigurationSchema because Record<string, Record<string, unknown>>
    // is assignable to the schema's properties index signature.
    return Object.keys(properties).length > 0 ? { properties } : undefined;
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

      const manualModelProfile = getModelProfile(baseModelId);
      // Load bundled models.dev data for the manual model.
      const manualModelsDevelopmentMap = loadModelsDevelopmentData();
      const limits = this.resolveModelLimits(
        baseModelId,
        settings.context1M.enabled,
        manualModelsDevelopmentMap,
      );
      const developmentEntry = manualModelsDevelopmentMap.get(baseModelId);
      const isLikelyVisionCapable = developmentEntry
        ? (developmentEntry.modalities?.input?.includes("image") ?? false)
        : /anthropic\.|nova\.|llama\.|pixtral|gpt-oss/i.test(baseModelId);

      return {
        capabilities: {
          imageInput: isLikelyVisionCapable,
          toolCalling: true,
        },
        configurationSchema: this.buildConfigurationSchema(
          baseModelId,
          manualModelProfile,
          manualModelsDevelopmentMap,
        ),
        detail: this.formatDetail(
          baseModelId,
          limits.maxInputTokens,
          limits.maxOutputTokens,
          isLikelyVisionCapable,
        ),
        family: "bedrock",
        id: modelId,
        maxInputTokens: limits.maxInputTokens,
        maxOutputTokens: limits.maxOutputTokens,
        name: modelId,
        tooltip: this.formatTooltip({
          maxInput: limits.maxInputTokens,
          maxOutput: limits.maxOutputTokens,
          modelId: baseModelId,
          providerName: "Bedrock",
          route: "Manual entry",
          vision: isLikelyVisionCapable,
        }),
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

  private buildModelCandidates(
    models: BedrockModelSummary[],
    availableProfileIds: Set<string>,
    regionPrefix: string,
    preferRegional = false,
    sourceRegion?: string,
  ): {
    hasInferenceProfile: boolean;
    model: BedrockModelSummary;
    modelIdToUse: string;
  }[] {
    const candidates: {
      hasInferenceProfile: boolean;
      model: BedrockModelSummary;
      modelIdToUse: string;
    }[] = [];

    for (const m of models) {
      if (!m.responseStreamingSupported || !m.outputModalities.includes(ModelModality.TEXT)) {
        continue;
      }

      // Determine which model ID to use (with or without inference profile)
      // By default, prefer global inference profiles for best availability, then regional, then base model
      // When preferRegional is enabled, check regional profiles first (for Control Tower compliance)
      const globalProfileId = `global.${m.modelId}`;
      const regionalProfileId = this.findRegionalProfileId(
        m.modelId,
        availableProfileIds,
        regionPrefix,
        this.getRegionalProfilePriorityPrefixes(regionPrefix, sourceRegion),
      );

      let modelIdToUse = m.modelId;
      let hasInferenceProfile = false;

      if (preferRegional) {
        // Prefer regional profiles first
        if (regionalProfileId) {
          modelIdToUse = regionalProfileId;
          hasInferenceProfile = true;
          logger.trace(
            `[Bedrock Model Provider] Using regional inference profile for ${m.modelId}`,
          );
        } else if (availableProfileIds.has(globalProfileId)) {
          modelIdToUse = globalProfileId;
          hasInferenceProfile = true;
          logger.trace(
            `[Bedrock Model Provider] Using global inference profile for ${m.modelId} (regional not available)`,
          );
        }
      } else {
        // Default behavior: prefer global profiles first
        if (availableProfileIds.has(globalProfileId)) {
          modelIdToUse = globalProfileId;
          hasInferenceProfile = true;
          logger.trace(`[Bedrock Model Provider] Using global inference profile for ${m.modelId}`);
        } else if (regionalProfileId) {
          modelIdToUse = regionalProfileId;
          hasInferenceProfile = true;
          logger.trace(
            `[Bedrock Model Provider] Using regional inference profile for ${m.modelId}`,
          );
        }
      }

      candidates.push({ hasInferenceProfile, model: m, modelIdToUse });
    }

    return candidates;
  }

  /**
   * Build and configure the request input for Bedrock API
   */
  private buildRequestInput(
    model: LanguageModelChatInformation,
    baseModelId: string,
    converted: { messages: Message[]; system: SystemContentBlock[] },
    options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
    toolConfig: ToolConfiguration | undefined,
    extendedThinkingEnabled: boolean,
    budgetTokens: number,
    betaHeaders: string[],
    thinkingEffort?: ThinkingEffort,
    temperatureDeprecated?: boolean,
    requiresAdaptiveThinking?: boolean,
    reasoningEffort?: ReasoningEffort,
  ): ConverseStreamCommandInput {
    const requestInput: ConverseStreamCommandInput = {
      inferenceConfig: {
        maxTokens: Math.min(
          typeof options.modelOptions?.max_tokens === "number"
            ? options.modelOptions.max_tokens
            : model.maxOutputTokens,
          model.maxOutputTokens,
        ),
        // CLI-verified: Claude Opus 4.7 rejects requests that include
        // `temperature`. Sonnet 5 also rejects non-default temperature values.
        // Only include temperature if the user explicitly set one.
        ...(!temperatureDeprecated &&
          typeof options.modelOptions?.temperature === "number" && {
            temperature: options.modelOptions.temperature,
          }),
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

    // Add additional model request fields (thinking, effort, beta headers)
    this.configureAdditionalModelFields(
      requestInput,
      model.id,
      baseModelId,
      extendedThinkingEnabled,
      budgetTokens,
      betaHeaders,
      thinkingEffort,
      temperatureDeprecated,
      requiresAdaptiveThinking,
      reasoningEffort,
    );

    return requestInput;
  }

  /**
   * Calculate thinking configuration parameters.
   * @param modelProfile - The model's capability profile
   * @param maxOutputTokens - The model's maximum output tokens (from resolveModelLimits / model.maxOutputTokens)
   * @param maxTokensForRequest - The effective max_tokens for this specific request
   * @param thinkingEnabled - Whether thinking is enabled in settings
   */
  private calculateThinkingConfig(
    modelProfile: ReturnType<typeof getModelProfile>,
    maxOutputTokens: number,
    maxTokensForRequest: number,
    thinkingEnabled: boolean,
  ): { budgetTokens: number; extendedThinkingEnabled: boolean } {
    // Use a base budget of 16,000 tokens (aligned with GitHub Copilot's default),
    // capped at 25% of maxOutputTokens and constrained by maxTokensForRequest.
    // Reserve at least 25% of maxTokensForRequest (minimum 100 tokens) for visible
    // response content so that small explicit max_tokens values still produce output.
    const baseBudget = 16_000;
    const maxBudgetFromOutput = Math.floor(maxOutputTokens * 0.25);
    const visibleReserve = Math.max(100, Math.floor(maxTokensForRequest * 0.25));
    const budgetTokens = Math.max(
      0,
      Math.min(baseBudget, maxBudgetFromOutput, maxTokensForRequest - visibleReserve),
    );
    const isExtendedThinkingEnabled =
      thinkingEnabled && modelProfile.supportsThinking && budgetTokens >= 1024;

    return { budgetTokens, extendedThinkingEnabled: isExtendedThinkingEnabled };
  }

  /**
   * Configure additional model request fields for thinking, effort, and beta headers
   */
  private configureAdditionalModelFields(
    requestInput: ConverseStreamCommandInput,
    modelId: string,
    baseModelId: string,
    extendedThinkingEnabled: boolean,
    budgetTokens: number,
    betaHeaders: string[],
    thinkingEffort?: ThinkingEffort,
    temperatureDeprecated?: boolean,
    requiresAdaptiveThinking?: boolean,
    reasoningEffort?: ReasoningEffort,
  ): void {
    if (extendedThinkingEnabled) {
      this.applyExtendedThinkingFields(
        requestInput,
        modelId,
        budgetTokens,
        betaHeaders,
        thinkingEffort,
        temperatureDeprecated,
        requiresAdaptiveThinking,
      );
    } else if (thinkingEffort) {
      // Claude Opus 4.5 and Sonnet 4.6 effort parameter can be used even without extended thinking
      // This affects all token spend including tool calls
      requestInput.additionalModelRequestFields = {
        ...(betaHeaders.length > 0 && { anthropic_beta: betaHeaders }),
        output_config: { effort: thinkingEffort },
      };

      logger.debug("[Bedrock Model Provider] Thinking effort enabled (without extended thinking)", {
        anthropicBeta: betaHeaders.length > 0 ? betaHeaders : undefined,
        modelId,
        thinkingEffort,
      });
    } else if (requiresAdaptiveThinking) {
      // For models with adaptive thinking enabled by default (e.g., Sonnet 5),
      // explicitly send thinking: {type: "disabled"} if the user hasn't enabled extended thinking
      requestInput.additionalModelRequestFields = {
        thinking: { type: "disabled" },
        ...(betaHeaders.length > 0 && { anthropic_beta: betaHeaders }),
      };

      logger.debug("[Bedrock Model Provider] Adaptive thinking disabled", {
        anthropicBeta: betaHeaders.length > 0 ? betaHeaders : undefined,
        modelId,
      });
    } else if (betaHeaders.length > 0) {
      // Add beta headers even without thinking or effort
      requestInput.additionalModelRequestFields = {
        anthropic_beta: betaHeaders,
      };

      logger.debug("[Bedrock Model Provider] 1M context enabled", { modelId });
    }

    if (reasoningEffort) {
      this.applyReasoningEffort(requestInput, modelId, baseModelId, reasoningEffort);
    }
  }

  private async evaluateCandidateAccessibility(
    candidate: {
      hasInferenceProfile: boolean;
      model: BedrockModelSummary;
      modelIdToUse: string;
    },
    regionPrefix: string,
    availableProfileIds: Set<string>,
    preferRegional: boolean,
    abortSignal: AbortSignal,
    sourceRegion?: string,
  ): Promise<{
    hasInferenceProfile: boolean;
    isAccessible: boolean;
    model: BedrockModelSummary;
    modelIdToUse: string;
  }> {
    if (candidate.hasInferenceProfile) {
      // If the profile was returned by ListInferenceProfiles, trust it
      // This avoids expensive Converse API validation calls
      if (availableProfileIds.has(candidate.modelIdToUse)) {
        logger.trace(
          `[Bedrock Model Provider] Trusting inference profile from ListInferenceProfiles: ${candidate.modelIdToUse}`,
        );
        return { ...candidate, isAccessible: true };
      }

      // Profile not in list, validate with Converse as last resort
      const isProfileAccessible = await this.client.testInferenceProfileAccess(
        candidate.modelIdToUse,
        abortSignal,
      );

      if (isProfileAccessible) {
        return { ...candidate, isAccessible: true };
      }

      // Profile is denied, try to find an alternative
      return this.findAlternativeProfile(
        candidate,
        regionPrefix,
        availableProfileIds,
        preferRegional,
        abortSignal,
        sourceRegion,
      );
    }

    // No inference profile; check base model directly
    const isBaseModelAccessible = await this.client.isModelAccessible(
      candidate.model.modelId,
      abortSignal,
    );

    return { ...candidate, isAccessible: isBaseModelAccessible };
  }

  /**
   * Try to find an accessible alternative inference profile when the initially selected one is denied.
   * When preferRegional=false (default), attempts opposite profile type (regional when global denied, or vice versa).
   * When preferRegional=true, skips global fallback when regional profile is denied (honors regional-only preference).
   * Falls back to base model if no profiles are accessible.
   */
  private async findAlternativeProfile(
    candidate: {
      hasInferenceProfile: boolean;
      model: BedrockModelSummary;
      modelIdToUse: string;
    },
    regionPrefix: string,
    availableProfileIds: Set<string>,
    preferRegional: boolean,
    abortSignal: AbortSignal,
    sourceRegion?: string,
  ): Promise<{
    hasInferenceProfile: boolean;
    isAccessible: boolean;
    model: BedrockModelSummary;
    modelIdToUse: string;
  }> {
    logger.info(
      `[Bedrock Model Provider] Inference profile ${candidate.modelIdToUse} denied, trying alternatives for ${candidate.model.modelId}`,
    );

    // If this was a global profile, try regional
    if (candidate.modelIdToUse.startsWith("global.")) {
      const regionalProfileId = this.findRegionalProfileId(
        candidate.model.modelId,
        availableProfileIds,
        regionPrefix,
        this.getRegionalProfilePriorityPrefixes(regionPrefix, sourceRegion),
        new Set([candidate.modelIdToUse]),
      );
      if (regionalProfileId) {
        // Profile is in ListInferenceProfiles, trust it
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
    } else if (this.isRegionalProfileForModel(candidate.modelIdToUse, candidate.model.modelId)) {
      // If this was a regional profile and preferRegional=true, skip global fallback
      // (honors user preference for regional-only in Control Tower/SCP environments)
      if (preferRegional) {
        logger.info(
          `[Bedrock Model Provider] Regional profile denied and preferRegional=true, skipping global fallback`,
        );
      } else {
        const globalProfileId = `global.${candidate.model.modelId}`;
        if (availableProfileIds.has(globalProfileId)) {
          // Profile is in ListInferenceProfiles, trust it
          logger.info(
            `[Bedrock Model Provider] Using global profile ${globalProfileId} instead of regional profile`,
          );
          return {
            ...candidate,
            hasInferenceProfile: true,
            isAccessible: true,
            modelIdToUse: globalProfileId,
          };
        }
      }
    }

    // No accessible profile found, fall back to base model
    const isBaseModelAccessible = await this.client.isModelAccessible(
      candidate.model.modelId,
      abortSignal,
    );
    if (isBaseModelAccessible) {
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

    logger.info(
      `[Bedrock Model Provider] No accessible inference profile or base model for ${candidate.model.modelId}`,
    );
    return { ...candidate, isAccessible: false };
  }

  private findRegionalProfileId(
    modelId: string,
    availableProfileIds: Set<string>,
    regionPrefix: string,
    profilePrefixPriority: string[],
    excludedProfileIds = new Set<string>(),
  ): string | undefined {
    const preferredProfileId = `${regionPrefix}.${modelId}`;
    if (
      availableProfileIds.has(preferredProfileId) &&
      !excludedProfileIds.has(preferredProfileId)
    ) {
      return preferredProfileId;
    }

    const priorityByPrefix = new Map(
      profilePrefixPriority.map((prefix, index) => [prefix, index] as const),
    );

    return [...availableProfileIds]
      .filter(
        (profileId) =>
          !excludedProfileIds.has(profileId) && this.isRegionalProfileForModel(profileId, modelId),
      )
      .toSorted((a, b) => {
        const aPriority = priorityByPrefix.get(a.split(".", 1)[0]) ?? Number.MAX_SAFE_INTEGER;
        const bPriority = priorityByPrefix.get(b.split(".", 1)[0]) ?? Number.MAX_SAFE_INTEGER;
        return aPriority - bPriority || a.localeCompare(b);
      })[0];
  }

  /**
   * Build the inline detail string shown next to the model name in the picker.
   * Format: "<context> ctx · <output>K out · <thinking-mode> · <vision>".
   * The model ID is used only to consult getModelProfile for capability flags;
   * display-side values (context and output) are the effective numeric limits.
   * Note: maxInput is the input budget (context - output); total context = maxInput + maxOutput.
   */
  private formatDetail(
    modelId: string,
    maxInput: number,
    maxOutput: number,
    vision: boolean,
  ): string {
    const profile = getModelProfile(modelId);
    // Total context window = input budget + output limit (mirrors VS Code picker rendering)
    const totalContext = maxInput + maxOutput;
    const contextK = Math.round(totalContext / 1000);
    const outK = Math.round(maxOutput / 1000);
    const contextLabel = contextK >= 1000 ? `${(contextK / 1000).toFixed(0)}M` : `${contextK}K`;

    let thinkingDescription: string | undefined;
    if (profile.requiresAdaptiveThinking) {
      thinkingDescription = "adaptive thinking";
    } else if (profile.supportsThinkingEffort || profile.supportsThinking) {
      thinkingDescription = "budget thinking";
    }

    const parts = [
      `${contextLabel} ctx`,
      `${outK}K out`,
      ...(thinkingDescription ? [thinkingDescription] : []),
      ...(vision ? ["vision"] : []),
    ];

    return parts.join(" \u{B7} ");
  }

  /**
   * Build a multi-line tooltip describing the model's capabilities and the
   * Bedrock invocation route (direct model, regional/global inference profile,
   * application inference profile, or manual entry). The route is surfaced so
   * users can distinguish between, e.g., `us.anthropic.claude-opus-4-7` vs
   * `global.anthropic.claude-opus-4-7` vs the base foundation model.
   */
  private formatTooltip(arguments_: {
    maxInput: number;
    maxOutput: number;
    modelId: string;
    providerName: string;
    route: string;
    vision: boolean;
  }): string {
    const profile = getModelProfile(arguments_.modelId);
    // Total context window = input budget + output limit (mirrors VS Code picker rendering)
    const totalContext = arguments_.maxInput + arguments_.maxOutput;
    const contextK = Math.round(totalContext / 1000);
    const contextLabel =
      contextK >= 1000 ? `${(contextK / 1000).toFixed(0)}M tokens` : `${contextK}K tokens`;

    let thinkingLine: string | undefined;
    if (profile.requiresAdaptiveThinking && profile.supportsThinkingEffort) {
      thinkingLine = "Thinking: adaptive only (uses output_config.effort)";
    } else if (profile.requiresAdaptiveThinking) {
      // Sonnet 5: adaptive thinking without output_config.effort support.
      thinkingLine = "Thinking: adaptive only";
    } else if (profile.supportsThinkingEffort) {
      thinkingLine = "Thinking: enabled+budget_tokens with effort setting";
    } else if (profile.supportsThinking) {
      thinkingLine = "Thinking: enabled+budget_tokens";
    }

    const lines = [
      `Amazon Bedrock - ${arguments_.providerName}`,
      `Route: ${arguments_.route}`,
      `Model ID: ${arguments_.modelId}`,
      `Context: ${contextLabel} | Max output: ${Math.round(arguments_.maxOutput / 1000)}K tokens`,
      ...(thinkingLine ? [thinkingLine] : []),
      ...(profile.temperatureDeprecated ? ["Note: temperature parameter is not supported"] : []),
      ...(arguments_.vision ? ["Vision: image input supported"] : []),
    ];

    return lines.join("\n");
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

  private getRegionalProfilePriorityPrefixes(
    regionPrefix: string,
    sourceRegion?: string,
  ): string[] {
    const prefixes = new Set<string>();
    const geoPrefix = this.getSourceRegionGeoProfilePrefix(sourceRegion);

    if (geoPrefix) {
      prefixes.add(geoPrefix);
    }
    prefixes.add(regionPrefix);

    return [...prefixes];
  }

  private getSourceRegionGeoProfilePrefix(sourceRegion?: string): string | undefined {
    if (!sourceRegion) {
      return undefined;
    }

    if (
      (sourceRegion.startsWith("us-") && !sourceRegion.startsWith("us-gov-")) ||
      sourceRegion.startsWith("ca-")
    ) {
      return "us";
    }

    if (sourceRegion.startsWith("eu-")) {
      return "eu";
    }

    if (sourceRegion === "ap-northeast-1" || sourceRegion === "ap-northeast-3") {
      return "jp";
    }

    if (
      sourceRegion === "ap-southeast-2" ||
      sourceRegion === "ap-southeast-4" ||
      sourceRegion === "ap-southeast-6"
    ) {
      return "au";
    }

    return undefined;
  }

  private isRegionalProfileForModel(profileId: string, modelId: string): boolean {
    return !profileId.startsWith("global.") && profileId.endsWith(`.${modelId}`);
  }

  /**
   * Log converted Bedrock messages for debugging
   */
  private logConvertedMessages(messages: Message[]): void {
    logger.debug("[Bedrock Model Provider] Converted to Bedrock messages:", messages.length);
    for (const [index, message] of messages.entries()) {
      const contentTypes = message.content?.map((c) => {
        if ("text" in c) return "text";
        if ("image" in c) return "image";
        if ("toolUse" in c) return "toolUse";
        if ("toolResult" in c) return "toolResult";
        if ("reasoningContent" in c) return "reasoningContent";
        if ("thinking" in c || "redacted_thinking" in c) return "thinking";
        if ("cachePoint" in c) return "cachePoint";
        return "unknown";
      });
      logger.debug(
        `[Bedrock Model Provider] Bedrock message ${index} (${message.role}):`,
        contentTypes,
      );
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
      messages: messages.map((message) => ({
        content: message.content.map((part) => {
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
        role: message.role,
      })),
    });

    for (const [index, message] of messages.entries()) {
      const partTypes = message.content.map((p) => {
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
      logger.debug(`[Bedrock Model Provider] Message ${index} (${message.role}):`, partTypes);
      // Log tool result details
      for (const part of message.content) {
        if (!(part instanceof vscode.LanguageModelToolResultPart)) {
          continue;
        }

        let contentPreview = "[Unable to preview]";
        try {
          const contentString =
            typeof part.content === "string" ? part.content : JSON.stringify(part.content);
          contentPreview = contentString.slice(0, 100);
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
    trackingProgress: Progress<LanguageModelResponsePart2>,
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
   * Wraps {@link processResponseStream} with a single generic retry: if Bedrock
   * rejects the request because of an unsupported/unknown parameter (typically
   * a field we opted the model into via profiles.ts or a models.dev heuristic,
   * but which this particular model build doesn't actually support), we strip
   * that field from the request and retry exactly once. A warning is surfaced
   * to the user (via a text part) so they know the extension auto-recovered
   * and can report the gap upstream.
   *
   * This guards against Bedrock adding new models that don't match our
   * hardcoded capability assumptions, without requiring a code change for
   * every such mismatch.
   */
  private async processResponseStreamWithFallback(
    requestInput: ConverseStreamCommandInput,
    trackingProgress: Progress<LanguageModelResponsePart2>,
    extendedThinkingEnabled: boolean,
    token: CancellationToken,
    modelId: string,
  ): Promise<void> {
    try {
      await this.processResponseStream(
        requestInput,
        trackingProgress,
        extendedThinkingEnabled,
        token,
      );
    } catch (error) {
      const unsupportedParameterName = getUnsupportedParameterName(error);
      if (!unsupportedParameterName) {
        throw error;
      }

      const wasRemoved = didRemoveUnsupportedParameter(requestInput, unsupportedParameterName);
      if (!wasRemoved) {
        // We recognized the error shape but couldn't locate/remove the field
        // (e.g. it lives somewhere we don't know how to strip) -- don't retry
        // blindly, just surface the original error.
        throw error;
      }

      logger.warn("[Bedrock Model Provider] Retrying after stripping unsupported parameter", {
        modelId,
        parameter: unsupportedParameterName,
      });

      const warningMessage =
        ` **Bedrock Copilot Chat**: model \`${modelId}\` rejected the \`${unsupportedParameterName}\` ` +
        "parameter. Retried without it. Please report this to the extension developers " +
        "(github.com/vtkn/amazon-bedrock-copilot-chat/issues) so support can be fixed.\n\n";
      trackingProgress.report(new vscode.LanguageModelTextPart(warningMessage));

      await this.processResponseStream(
        requestInput,
        trackingProgress,
        extendedThinkingEnabled,
        token,
      );
    }
  }

  /**
   * Resolve token limits for a model, preferring live data from models.dev over
   * the hardcoded `getModelTokenLimits` fallback.
   *
   * models.dev provides authoritative context/output limits for 91+ Bedrock models
   * and is updated as new models launch — meaning new models get correct limits
   * automatically without code changes. The `getModelTokenLimits` fallback handles
   * models not yet in models.dev and preserves the 1M context opt-in logic for
   * Claude models that require a beta header.
   *
   * For models with `limit.context >= 1M` in models.dev AND where `requires1MContextBetaHeader`
   * is true (i.e. 1M is optional, not the default — Opus 4.6, Sonnet 4.5), we respect the
   * user's `context1M.enabled` setting and cap at 200K when disabled.
   * For always-1M models (Opus 4.7/4.8, Sonnet 4.6), we use the live limit directly.
   */
  private resolveModelLimits(
    modelId: string,
    context1MEnabled: boolean,
    modelsDevelopmentMap: ModelsDevelopmentMap,
  ): { maxInputTokens: number; maxOutputTokens: number } {
    // normalizeModelId strips regional prefixes (us., eu., global., etc.) so we
    // can match against the bare model IDs stored in models.dev.
    // models.dev keys use various regional prefixes (us., eu., au., jp., global.)
    // so a direct + normalized lookup may still miss entries stored under a
    // different prefix variant. Fall back to a full-map scan by normalized ID.
    const normalizedId = normalizeModelId(modelId);
    const developmentEntry = resolveModelsDevelopmentEntry(modelId, normalizedId, modelsDevelopmentMap);

    if (developmentEntry) {
      const developmentOutput = developmentEntry.limit.output;
      const developmentContext = developmentEntry.limit.context;

      // VS Code renders the context window size in the model picker as
      // `maxInputTokens + maxOutputTokens`, so maxInputTokens must be the input
      // budget (context - output), not the raw context window.
      //
      // For models with optional 1M context (requires beta header opt-in), respect the setting.
      if (developmentContext >= 1_000_000 && requires1MContextBetaHeader(modelId)) {
        const effectiveContext = context1MEnabled ? developmentContext : 200_000;
        return {
          maxInputTokens: effectiveContext - developmentOutput,
          maxOutputTokens: developmentOutput,
        };
      }

      // For all other models (including always-1M like Opus 4.7/4.8), use live limits directly.
      return {
        maxInputTokens: developmentContext - developmentOutput,
        maxOutputTokens: developmentOutput,
      };
    }

    // Fall back to hardcoded profiles for models not yet in models.dev
    return getModelTokenLimits(modelId, context1MEnabled);
  }
}

/**
 * GPT-5.x named variants (Luna, Sol, Terra) are CLI-verified via
 * `aws bedrock-runtime converse` (2026-08-22) to reject the `reasoning_effort`
 * field with an "unknown_parameter" error, even though models.dev reports
 * `reasoning: true` for all three -- that flag is misleading for Bedrock's
 * actual behavior on these specific model IDs. Shared by both the
 * configuration schema (picker visibility) and request building (actual
 * field inclusion) so the two can never drift out of sync.
 */
function isNamedGpt5Variant(baseModelId: string): boolean {
  return (
    baseModelId.includes("-luna") || baseModelId.includes("-sol") || baseModelId.includes("-terra")
  );
}

/**
 * Look up a models.dev entry for a model ID, trying (in order):
 * 1. Exact match on the raw model ID.
 * 2. Exact match on the normalized ID (regional prefix stripped).
 * 3. A full-map scan comparing normalized keys against the normalized ID.
 *
 * Step 3 is necessary because models.dev entries can be stored under a
 * different regional prefix (e.g. `global.`) than the one currently in use
 * (e.g. `us.`) for the same base model -- a direct or single normalized
 * lookup can miss the entry entirely. Shared by every call site that reads
 * models.dev capability/limit data (buildConfigurationSchema,
 * resolveModelLimits, provideLanguageModelChatResponse) so they can never
 * drift out of sync on how models.dev entries are resolved.
 */
function resolveModelsDevelopmentEntry(
  modelId: string,
  normalizedId: string,
  modelsDevelopmentMap: ModelsDevelopmentMap,
): ModelsDevelopmentEntry | undefined {
  const direct = modelsDevelopmentMap.get(modelId) ?? modelsDevelopmentMap.get(normalizedId);
  if (direct) {
    return direct;
  }

  for (const [key, entry] of modelsDevelopmentMap) {
    if (normalizeModelId(key) === normalizedId) {
      return entry;
    }
  }
  return undefined;
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
  return CONTEXT_WINDOW_OVERFLOW_MESSAGES.some((message) => errorMessage.includes(message));
}

/**
 * Regexes matching known "unsupported/unknown parameter" error shapes from
 * Bedrock-fronted providers (OpenAI-compatible passthrough errors, and
 * Bedrock's own ValidationException wording). Each must capture the offending
 * parameter name in group 1.
 */
const UNSUPPORTED_PARAMETER_PATTERNS = [
  // OpenAI-compatible passthrough error, e.g.:
  // {"error":{"code":"unknown_parameter","message":"Unknown parameter: 'reasoning_effort'.","param":"reasoning_effort", ...}}
  /"param"\s*:\s*"([\w.]+)"[^}]*"unknown_parameter"/,
  /"unknown_parameter"[^}]*"param"\s*:\s*"([\w.]+)"/,
  /Unknown parameter:\s*'([\w.]+)'/i,
  // Bedrock ValidationException wording for unrecognized additionalModelRequestFields keys
  /Unrecognized (?:request )?(?:field|parameter|argument)[:\s]+['"]?([\w.]+)['"]?/i,
  /extraneous key \[([\w.]+)\] is not permitted/i,
];

/**
 * Delete a dotted path (e.g. "output_config.effort") from a nested record,
 * mutating it in place. Returns true if the leaf key was found and removed.
 */
function didDeleteDottedPath(root: Record<string, unknown>, dottedPath: string): boolean {
  const pathParts = dottedPath.split(".");
  const [rootKey, ...pathRest] = pathParts;
  const rootValue = root[rootKey];
  if (pathRest.length === 0 || !rootValue || typeof rootValue !== "object") {
    return false;
  }

  // Walk down to the leaf's parent, keeping track of each ancestor object and
  // the key used to reach it so we can prune now-empty ancestors afterward.
  const ancestors: { key: string; object: Record<string, unknown> }[] = [
    { key: rootKey, object: root },
  ];
  let cursor: Record<string, unknown> = rootValue as Record<string, unknown>;
  for (let index = 0; index < pathRest.length - 1; index++) {
    const next = cursor[pathRest[index]];
    if (!next || typeof next !== "object") {
      return false;
    }
    ancestors.push({ key: pathRest[index], object: cursor });
    cursor = next as Record<string, unknown>;
  }

  const leafKey = pathRest.at(-1)!;
  if (!Object.hasOwn(cursor, leafKey)) {
    return false;
  }
  delete cursor[leafKey];

  // Prune now-empty parent objects (e.g. an emptied `output_config` or
  // `thinking` object) so the retry request doesn't resend an empty object
  // that Bedrock may reject with the same or a different validation error.
  let emptyChild: Record<string, unknown> = cursor;
  for (let index = ancestors.length - 1; index >= 0; index--) {
    if (Object.keys(emptyChild).length > 0) {
      break;
    }
    const { key, object: parent } = ancestors[index];
    delete parent[key];
    emptyChild = parent;
  }

  return true;
}

/**
 * Remove a top-level or `additionalModelRequestFields`-nested parameter from
 * the request input, mutating it in place. Returns true if the field was
 * found and removed, false otherwise (caller should not retry in that case).
 */
function didRemoveUnsupportedParameter(
  requestInput: ConverseStreamCommandInput,
  parameterName: string,
): boolean {
  // temperature/topP/stopSequences live under inferenceConfig, not at the
  // request root or in additionalModelRequestFields. Support both the bare
  // key (e.g. "temperature") and the dotted form some providers report
  // (e.g. "inferenceConfig.temperature").
  const inferenceConfig = requestInput.inferenceConfig as Record<string, unknown> | undefined;
  const inferenceConfigKey = parameterName.startsWith("inferenceConfig.")
    ? parameterName.slice("inferenceConfig.".length)
    : parameterName;
  if (inferenceConfig && Object.hasOwn(inferenceConfig, inferenceConfigKey)) {
    delete inferenceConfig[inferenceConfigKey];
    return true;
  }

  const additionalFields = requestInput.additionalModelRequestFields as
    | Record<string, unknown>
    | undefined;

  if (additionalFields && Object.hasOwn(additionalFields, parameterName)) {
    delete additionalFields[parameterName];
    return true;
  }

  // Also handle dotted paths like "output_config.effort"
  if (
    parameterName.includes(".") &&
    additionalFields &&
    didDeleteDottedPath(additionalFields, parameterName)
  ) {
    return true;
  }

  const requestRecord = requestInput as unknown as Record<string, unknown>;
  if (Object.hasOwn(requestRecord, parameterName)) {
    delete requestRecord[parameterName];
    return true;
  }

  return false;
}

/**
 * Attempt to extract the name of an unsupported/unknown parameter from a
 * Bedrock/Converse API error. Returns undefined if the error doesn't match
 * any known "unknown parameter" shape.
 */
function getUnsupportedParameterName(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  const errorMessage = error instanceof Error ? error.message : inspect(error);
  for (const pattern of UNSUPPORTED_PARAMETER_PATTERNS) {
    const match = pattern.exec(errorMessage);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/* eslint-enable unicorn/consistent-boolean-name -- end intentional file-level exception */
/* eslint-enable unicorn/consistent-class-member-order -- end intentional file-level exception */
/* eslint-enable unicorn/consistent-function-scoping -- end intentional file-level exception */
/* eslint-enable unicorn/no-break-in-nested-loop -- end intentional file-level exception */
/* eslint-enable unicorn/prefer-includes-over-repeated-comparisons -- end intentional file-level exception */
/* eslint-enable unicorn/prefer-simple-condition-first -- end intentional file-level exception */
/* eslint-enable unicorn/prefer-ternary -- end intentional file-level exception */
