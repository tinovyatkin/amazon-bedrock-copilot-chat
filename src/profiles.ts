/**
 * Model profile system for handling provider-specific capabilities
 */

export interface ModelProfile {
  /**
   * Whether the model requires the interleaved-thinking beta header (Claude 4 models only)
   */
  requiresInterleavedThinkingHeader: boolean;
  /**
   * Whether the model supports 1M context window
   */
  supports1MContext: boolean;
  /**
   * Whether the model supports prompt caching via cache points
   */
  supportsPromptCaching: boolean;
  /**
   * Whether the model supports extended thinking (Claude Opus 4.1, Opus 4, Sonnet 4.5, Sonnet 4, Sonnet 3.7)
   */
  supportsThinking: boolean;
  /**
   * Whether the model supports the toolChoice parameter
   */
  supportsToolChoice: boolean;
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
    requiresInterleavedThinkingHeader: false,
    supports1MContext: false,
    supportsPromptCaching: false,
    supportsThinking: false,
    supportsToolChoice: false,
    toolResultFormat: "text",
  };

  // Split the model name into parts
  let parts = modelId.split(".");

  // Handle regional prefixes (e.g. "us.anthropic.claude-...")
  if (parts.length > 2 && parts[0].length === 2) {
    parts = parts.slice(1);
  }

  if (parts.length < 2) {
    return defaultProfile;
  }

  const provider = parts[0];

  // Provider-specific profiles
  switch (provider) {
    case "ai21":

    case "cohere":
    case "meta":
      // Older models don't support tool choice
      return defaultProfile;

    case "amazon":
      // Amazon Nova models support tool choice and prompt caching
      if (modelId.includes("nova")) {
        return {
          requiresInterleavedThinkingHeader: false,
          supports1MContext: false,
          supportsPromptCaching: true,
          supportsThinking: false,
          supportsToolChoice: true,
          toolResultFormat: "text",
        };
      }
      return defaultProfile;
    case "anthropic": {
      // Claude models support tool choice and prompt caching
      // Extended thinking is supported by Claude Opus 4+, Sonnet 4+, and Sonnet 3.7
      const supportsThinking =
        modelId.includes("opus-4") ||
        modelId.includes("sonnet-4") ||
        modelId.includes("sonnet-3-7") ||
        modelId.includes("sonnet-3.7");

      // Interleaved thinking (beta header) is only for Claude 4 models
      const requiresInterleavedThinkingHeader =
        modelId.includes("opus-4") || modelId.includes("sonnet-4");

      return {
        requiresInterleavedThinkingHeader,
        supports1MContext: supports1MContext(modelId),
        supportsPromptCaching: true,
        supportsThinking,
        supportsToolChoice: true,
        toolResultFormat: "text",
      };
    }
    case "mistral":
      // Mistral models require JSON format for tool results
      return {
        requiresInterleavedThinkingHeader: false,
        supports1MContext: false,
        supportsPromptCaching: false,
        supportsThinking: false,
        supportsToolChoice: false,
        toolResultFormat: "json",
      };

    case "openai":
      // OpenAI models support tool choice but not prompt caching
      return {
        requiresInterleavedThinkingHeader: false,
        supports1MContext: false,
        supportsPromptCaching: false,
        supportsThinking: false,
        supportsToolChoice: true,
        toolResultFormat: "text",
      };

    default:
      return defaultProfile;
  }
}

/**
 * Get token limits for a given Bedrock model ID
 * Returns model-specific token limits for known models, or conservative defaults for others
 * @param modelId The full Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @param enable1MContext Whether to enable 1M context for supported models (default: false)
 * @returns Token limits with maxInputTokens and maxOutputTokens
 */
export function getModelTokenLimits(
  modelId: string,
  enable1MContext: boolean = false,
): ModelTokenLimits {
  const defaultLimits: ModelTokenLimits = {
    maxInputTokens: 196000, // 200K context - 4K output
    maxOutputTokens: 4096,
  };

  // Handle regional prefixes (e.g. "us.anthropic.claude-...")
  let normalizedModelId = modelId;
  const parts = modelId.split(".");
  if (parts.length > 2 && parts[0].length === 2) {
    normalizedModelId = parts.slice(1).join(".");
  }

  // Claude models have specific token limits based on model family
  if (normalizedModelId.startsWith("anthropic.claude")) {
    // Claude Sonnet 4.5 and 4: 200K input (or 1M with setting enabled), 64K output
    if (normalizedModelId.includes("sonnet-4")) {
      // Return 1M context if enabled, otherwise 200K
      if (enable1MContext) {
        return {
          maxInputTokens: 1000000 - 64000,
          maxOutputTokens: 64000,
        };
      }
      return {
        maxInputTokens: 200000 - 64000,
        maxOutputTokens: 64000,
      };
    }

    // Claude Sonnet 3.7: 200K input, 64K output
    if (normalizedModelId.includes("sonnet-3-7") || normalizedModelId.includes("sonnet-3.7")) {
      return {
        maxInputTokens: 200000 - 64000,
        maxOutputTokens: 64000,
      };
    }

    // Claude Opus 4.1 and 4: 200K input, 32K output
    if (normalizedModelId.includes("opus-4")) {
      return {
        maxInputTokens: 200000 - 32000,
        maxOutputTokens: 32000,
      };
    }

    // Claude Haiku 3.5: 200K input, 8,192 output
    if (normalizedModelId.includes("haiku-3-5") || normalizedModelId.includes("haiku-3.5")) {
      return {
        maxInputTokens: 200000 - 8192,
        maxOutputTokens: 8192,
      };
    }

    // Claude Haiku 3: 200K input, 4,096 output
    if (normalizedModelId.includes("haiku-3")) {
      return {
        maxInputTokens: 200000 - 4096,
        maxOutputTokens: 4096,
      };
    }

    // Claude 3.5 Sonnet (older): 200K input, 8,192 output
    if (normalizedModelId.includes("sonnet-3-5") || normalizedModelId.includes("sonnet-3.5")) {
      return {
        maxInputTokens: 200000 - 8192,
        maxOutputTokens: 8192,
      };
    }

    // Claude Opus 3: 200K input, 4,096 output
    if (normalizedModelId.includes("opus-3")) {
      return {
        maxInputTokens: 200000 - 4096,
        maxOutputTokens: 4096,
      };
    }
  }

  // Default for unknown models
  return defaultLimits;
}

/**
 * Check if a model supports 1M context window
 * Claude Sonnet 4.x models support extended 1M context via anthropic_beta parameter
 */
function supports1MContext(modelId: string): boolean {
  return modelId.includes("sonnet-4");
}

/**
 * Get the model profile for a given Bedrock model ID
 * @param modelId The full Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @returns Model profile with capabilities
 */
