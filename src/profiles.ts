/**
 * Model profile system for handling provider-specific capabilities
 */

export interface ModelProfile {
  /**
   * Whether the model requires adaptive thinking (thinking.type="adaptive") instead of
   * the usual thinking.type="enabled" with budget_tokens.
   * CLI-verified: only Claude Opus 4.7 requires this.
   */
  requiresAdaptiveThinking: boolean;
  /**
   * Whether the model requires the interleaved-thinking beta header (Claude 4 models only)
   */
  requiresInterleavedThinkingHeader: boolean;
  /**
   * Whether the model supports 1M context window
   */
  supports1MContext: boolean;
  /**
   * Whether the model supports caching with tool results (cachePoint after toolResult blocks)
   * When false, cachePoint should only be added to messages WITHOUT toolResult
   * Reference: Amazon Nova models don't support cachePoint after toolResult
   */
  supportsCachingWithToolResults: boolean;
  /**
   * Whether the model supports prompt caching via cache points
   */
  supportsPromptCaching: boolean;
  /**
   * Whether the model accepts the OpenAI-style `reasoning_effort` field via
   * additionalModelRequestFields. Valid values: low | medium | high (and
   * `minimal` for OpenAI gpt-oss only -- handled at the call site).
   *
   * Only opt in when CLI-verified that the model actually produces reasoning
   * content for the parameter; models that silently ignore the field (e.g.
   * Mistral, Google Gemma, NVIDIA Nemotron) should leave this false.
   */
  supportsReasoningEffort: boolean;
  /**
   * Whether the model supports extended thinking (Claude Opus 4.6, Opus 4.5, Opus 4.1, Opus 4, Sonnet 4.6, Sonnet 4.5, Sonnet 4, Sonnet 3.7)
   */
  supportsThinking: boolean;
  /**
   * Whether the model supports the adaptive thinking / thinking effort parameter (Claude Opus 4.6, Opus 4.5, Sonnet 4.6)
   * Allows controlling token expenditure with "high", "medium", or "low" effort levels
   */
  supportsThinkingEffort: boolean;
  /**
   * Whether the model supports the toolChoice parameter
   */
  supportsToolChoice: boolean;
  /**
   * Whether the model supports the status field in tool results (error/success)
   * Reference: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html
   * Currently only Claude models support this field
   */
  supportsToolResultStatus: boolean;
  /**
   * Whether the temperature parameter is deprecated and must be omitted from requests.
   * CLI-verified: only Claude Opus 4.7 rejects requests that include `temperature`.
   */
  temperatureDeprecated: boolean;
  /**
   * Format to use for tool result content ('text' or 'json')
   */
  toolResultFormat: "json" | "text";
}

export interface ModelTokenLimits {
  /**
   * Maximum number of input tokens (context window)
   */
  maxInputTokens: number;
  /**
   * Maximum number of output tokens
   */
  maxOutputTokens: number;
}

export function getModelProfile(modelId: string): ModelProfile {
  const defaultProfile: ModelProfile = {
    requiresAdaptiveThinking: false,
    requiresInterleavedThinkingHeader: false,
    supports1MContext: false,
    supportsCachingWithToolResults: false,
    supportsPromptCaching: false,
    supportsReasoningEffort: false,
    supportsThinking: false,
    supportsThinkingEffort: false,
    supportsToolChoice: false,
    supportsToolResultStatus: false,
    temperatureDeprecated: false,
    toolResultFormat: "text",
  };

  const normalizedId = normalizeModelId(modelId);
  const parts = normalizedId.split(".");

  if (parts.length < 2) {
    return defaultProfile;
  }

  const provider = parts[0];

  // Provider-specific profiles. Cases are alphabetical to satisfy the
  // perfectionist/sort-switch-case lint rule.
  switch (provider) {
    case "ai21":
    case "cohere":
    case "google":
    case "meta":
    case "nvidia": {
      // CLI-verified tool-calling opt-ins with no reasoning/thinking support:
      // - AI21 Jamba 1.5 supports tool calling
      // - Cohere Command R/R+ support tool calling
      // - Google Gemma 3 supports tool calling (reasoning_effort silently
      //   ignored, so not advertised)
      // - Meta Llama 3/3.1/3.2/3.3/4 all support tool calling via Converse
      // - NVIDIA Nemotron supports tool calling (reasoning_effort silently
      //   ignored, no reasoningContent emitted -- not advertised)
      //
      // Older J2/Command/Llama2 variants that predate tool calling are no
      // longer surfaced on current Bedrock, so the blanket opt-in is safe.
      return { ...defaultProfile, supportsToolChoice: true };
    }

    case "amazon": {
      // Amazon Nova models support tool choice and prompt caching
      // Nova does NOT support cachePoint after toolResult blocks
      if (modelId.includes("nova")) {
        return {
          requiresAdaptiveThinking: false,
          requiresInterleavedThinkingHeader: false,
          supports1MContext: false,
          supportsCachingWithToolResults: false,
          supportsPromptCaching: true,
          supportsReasoningEffort: false,
          supportsThinking: false,
          supportsThinkingEffort: false,
          supportsToolChoice: true,
          supportsToolResultStatus: false,
          temperatureDeprecated: false,
          toolResultFormat: "text",
        };
      }
      return defaultProfile;
    }

    case "anthropic": {
      // Claude models support tool choice and prompt caching
      // Extended thinking is supported by Claude Opus 4+, Sonnet 4+, Sonnet 3.7,
      // and Haiku 4.5
      const supportsThinking =
        modelId.includes("opus-4") ||
        modelId.includes("sonnet-4") ||
        modelId.includes("sonnet-3-7") ||
        modelId.includes("sonnet-3.7") ||
        modelId.includes("haiku-4-5") ||
        modelId.includes("haiku-4.5");

      // Interleaved thinking (beta header) is only for Claude 4 models
      const requiresInterleavedThinkingHeader =
        (modelId.includes("opus-4") && !modelId.includes("opus-4-7")) ||
        modelId.includes("sonnet-4");

      // Claude models with extended thinking have issues with cachePoint after toolResult
      // When extended thinking is enabled, cachePoint should only be added to messages without toolResult
      const supportsCachingWithToolResults = !supportsThinking;

      // Adaptive thinking / thinking effort parameter is supported by
      // Claude Opus 4.7, Opus 4.6, Opus 4.5, and Sonnet 4.6
      // Allows controlling token expenditure with "high", "medium", or "low" effort levels
      const supportsThinkingEffort =
        modelId.includes("opus-4-7") ||
        modelId.includes("opus-4-6") ||
        modelId.includes("opus-4-5") ||
        modelId.includes("sonnet-4-6");

      // CLI-verified: Opus 4.7 rejects `thinking.type="enabled"` and requires
      // `thinking.type="adaptive"` (with no budget_tokens). All other Claude
      // models still use enabled+budget.
      const requiresAdaptiveThinking = modelId.includes("opus-4-7");

      // CLI-verified: Opus 4.7 rejects requests that include the `temperature`
      // inference parameter (Bedrock returns a ValidationException). All other
      // Claude models still accept temperature.
      const temperatureDeprecated = modelId.includes("opus-4-7");

      return {
        requiresAdaptiveThinking,
        requiresInterleavedThinkingHeader,
        supports1MContext: supports1MContext(modelId),
        supportsCachingWithToolResults,
        supportsPromptCaching: true,
        supportsReasoningEffort: false, // Anthropic uses thinking.* / output_config.effort, not reasoning_effort
        supportsThinking,
        supportsThinkingEffort,
        supportsToolChoice: true,
        supportsToolResultStatus: true, // Claude models support status field in tool results
        temperatureDeprecated,
        toolResultFormat: "text",
      };
    }

    case "deepseek": {
      // CLI-verified: DeepSeek V3.2 supports tool calling and the
      // reasoning_effort parameter. DeepSeek R1 is a reasoning-only model
      // with always-on thinking -- it rejects tool configs and the
      // reasoning_effort parameter, so we opt it out of both.
      const isR1 = modelId.includes("r1");
      return {
        ...defaultProfile,
        supportsReasoningEffort: !isR1,
        supportsToolChoice: !isR1,
      };
    }

    case "minimax":
    case "moonshot":
    case "moonshotai":
    case "qwen":
    case "zai": {
      // CLI-verified: all of MiniMax M2.x, Moonshot Kimi K2.x, Qwen3
      // (dense/VL/Coder/Next), and Z.AI GLM 4.7/5 support both tool calling
      // and the OpenAI-style reasoning_effort parameter via Converse.
      return {
        ...defaultProfile,
        supportsReasoningEffort: true,
        supportsToolChoice: true,
      };
    }

    case "mistral": {
      // CLI-verified: modern Mistral models on Bedrock (Large 3, Pixtral Large,
      // Magistral, Ministral 3, Devstral 2, Voxtral) all support tool calling
      // via the Converse API. The two legacy models -- mistral-7b-instruct and
      // mixtral-8x7b-instruct -- predate tool calling and are still listed by
      // Bedrock; they must be opted out individually.
      //
      // Mistral expects tool results in JSON form rather than plain text.
      // reasoning_effort is silently ignored on this family.
      const isLegacyNonTool =
        modelId.includes("mistral-7b-instruct") || modelId.includes("mixtral-8x7b-instruct");
      return {
        requiresAdaptiveThinking: false,
        requiresInterleavedThinkingHeader: false,
        supports1MContext: false,
        supportsCachingWithToolResults: false,
        supportsPromptCaching: false,
        supportsReasoningEffort: false,
        supportsThinking: false,
        supportsThinkingEffort: false,
        supportsToolChoice: !isLegacyNonTool,
        supportsToolResultStatus: false,
        temperatureDeprecated: false,
        toolResultFormat: "json",
      };
    }

    case "openai": {
      // OpenAI gpt-oss models support tool choice AND the OpenAI-style
      // `reasoning_effort` parameter (CLI-verified: low | medium | high work;
      // `minimal` is OpenAI-only; `max` is rejected).
      return {
        requiresAdaptiveThinking: false,
        requiresInterleavedThinkingHeader: false,
        supports1MContext: false,
        supportsCachingWithToolResults: false,
        supportsPromptCaching: false,
        supportsReasoningEffort: true,
        supportsThinking: false,
        supportsThinkingEffort: false,
        supportsToolChoice: true,
        supportsToolResultStatus: false,
        temperatureDeprecated: false,
        toolResultFormat: "text",
      };
    }

    case "writer": {
      // CLI-verified: Palmyra X4/X5 support tool calling (via inference
      // profile). Palmyra Vision 7B is vision-only and rejects tool configs.
      if (modelId.includes("vision")) {
        return defaultProfile;
      }
      return { ...defaultProfile, supportsToolChoice: true };
    }

    default: {
      return defaultProfile;
    }
  }
}

/**
 * Get token limits for a given Bedrock model ID
 * Returns model-specific token limits for known models, or conservative defaults for others
 * @param modelId The full Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @param enable1MContext Whether to enable 1M context for supported models (default: false)
 * @returns Token limits with maxInputTokens and maxOutputTokens
 */
export function getModelTokenLimits(modelId: string, enable1MContext = false): ModelTokenLimits {
  const normalizedModelId = normalizeModelId(modelId);

  // Claude models have specific token limits based on model family
  if (normalizedModelId.startsWith("anthropic.claude")) {
    return getClaudeTokenLimits(normalizedModelId, enable1MContext);
  }

  // Default for unknown models
  return {
    maxInputTokens: 196_000, // 200K context - 4K output
    maxOutputTokens: 4096,
  };
}

/**
 * Check if a model needs the 1M context beta header when 1M context is enabled.
 * Claude Opus 4.7 is 1M-by-default and must not receive the beta header.
 */
export function requires1MContextBetaHeader(modelId: string): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  return normalizedModelId.includes("opus-4-6") || normalizedModelId.includes("sonnet-4");
}

/**
 * Get token limits for a Claude model based on its normalized model ID
 */
function getClaudeTokenLimits(
  normalizedModelId: string,
  enable1MContext: boolean,
): ModelTokenLimits {
  // Claude Opus 4.7: always 1M context, 128K max output (per Anthropic docs).
  // Opus 4.7 does not require the context-1m-* beta header -- 1M is the default.
  if (normalizedModelId.includes("opus-4-7")) {
    return {
      maxInputTokens: 1_000_000 - 128_000,
      maxOutputTokens: 128_000,
    };
  }

  // Claude Opus 4.6: 200K context (or 1M with setting enabled), 128K max output
  // https://platform.claude.com - Opus 4.6 supports 128K output and optional 1M context
  if (normalizedModelId.includes("opus-4-6")) {
    return {
      maxInputTokens: (enable1MContext ? 1_000_000 : 200_000) - 128_000,
      maxOutputTokens: 128_000,
    };
  }

  // Claude Sonnet 4.6: 200K context (or 1M with setting enabled), 64K output
  if (normalizedModelId.includes("sonnet-4-6")) {
    return {
      maxInputTokens: (enable1MContext ? 1_000_000 : 200_000) - 64_000,
      maxOutputTokens: 64_000,
    };
  }

  // Claude Sonnet 4.5 and 4: 200K context (or 1M with setting enabled), 64K output
  if (normalizedModelId.includes("sonnet-4")) {
    return {
      maxInputTokens: (enable1MContext ? 1_000_000 : 200_000) - 64_000,
      maxOutputTokens: 64_000,
    };
  }

  // Claude Sonnet 3.7: 200K context, 64K output
  if (normalizedModelId.includes("sonnet-3-7") || normalizedModelId.includes("sonnet-3.7")) {
    return { maxInputTokens: 200_000 - 64_000, maxOutputTokens: 64_000 };
  }

  // Claude Opus 4.5: 200K context, 64K output (per Anthropic docs)
  if (normalizedModelId.includes("opus-4-5")) {
    return { maxInputTokens: 200_000 - 64_000, maxOutputTokens: 64_000 };
  }

  // Claude Opus 4.1: 200K context, 32K output (AWS-verified limit: 32768)
  // Upstream previously used 64K output; Anthropic's published limit is 32K.
  if (normalizedModelId.includes("opus-4-1")) {
    return { maxInputTokens: 200_000 - 32_768, maxOutputTokens: 32_768 };
  }

  // Claude Opus 4: 200K context, 32K output (AWS-verified limit: 32768)
  // Upstream previously used 64K output; Anthropic's published limit is 32K.
  if (normalizedModelId.includes("opus-4")) {
    return { maxInputTokens: 200_000 - 32_768, maxOutputTokens: 32_768 };
  }

  // Claude Haiku 4.5: 200K context, 64K output
  if (normalizedModelId.includes("haiku-4-5") || normalizedModelId.includes("haiku-4.5")) {
    return { maxInputTokens: 200_000 - 64_000, maxOutputTokens: 64_000 };
  }

  // Claude Haiku 3.5: 200K context, 8,192 output
  if (normalizedModelId.includes("haiku-3-5") || normalizedModelId.includes("haiku-3.5")) {
    return { maxInputTokens: 200_000 - 8192, maxOutputTokens: 8192 };
  }

  // Claude Haiku 3: 200K context, 4,096 output
  if (normalizedModelId.includes("haiku-3")) {
    return { maxInputTokens: 200_000 - 4096, maxOutputTokens: 4096 };
  }

  // Claude 3.5 Sonnet (older): 200K context, 8,192 output
  if (normalizedModelId.includes("sonnet-3-5") || normalizedModelId.includes("sonnet-3.5")) {
    return { maxInputTokens: 200_000 - 8192, maxOutputTokens: 8192 };
  }

  // Claude Opus 3: 200K context, 4,096 output
  if (normalizedModelId.includes("opus-3")) {
    return { maxInputTokens: 200_000 - 4096, maxOutputTokens: 4096 };
  }

  // Default for unknown Claude models
  return { maxInputTokens: 196_000, maxOutputTokens: 4096 };
}

/**
 * Normalize a Bedrock model ID by stripping inference profile prefixes.
 * Handles both regional prefixes (us., eu., ap., etc.) and global prefix (global.)
 * @param modelId The full Bedrock model ID with optional prefix
 * @returns Normalized model ID without prefix
 * @example
 * normalizeModelId("global.anthropic.claude-opus-4-5") → "anthropic.claude-opus-4-5"
 * normalizeModelId("us.anthropic.claude-opus-4-5") → "anthropic.claude-opus-4-5"
 * normalizeModelId("anthropic.claude-opus-4-5") → "anthropic.claude-opus-4-5"
 */
function normalizeModelId(modelId: string): string {
  const parts = modelId.split(".");
  if (parts.length > 2 && (parts[0].length === 2 || parts[0] === "global")) {
    return parts.slice(1).join(".");
  }
  return modelId;
}

/**
 * Check if a model supports 1M context window
 * Claude Opus 4.7 (always), Opus 4.6, Sonnet 4.6, and Sonnet 4.x models support
 * extended 1M context.
 */
function supports1MContext(modelId: string): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  return normalizedModelId.includes("opus-4-7") || requires1MContextBetaHeader(normalizedModelId);
}

/**
 * Get the model profile for a given Bedrock model ID
 * @param modelId The full Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @returns Model profile with capabilities
 */
