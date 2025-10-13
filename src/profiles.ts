/**
 * Model profile system for handling provider-specific capabilities
 */

export interface ModelProfile {
  /**
   * Whether the model supports prompt caching via cache points
   */
  supportsPromptCaching: boolean;
  /**
   * Whether the model supports the toolChoice parameter
   */
  supportsToolChoice: boolean;
  /**
   * Format to use for tool result content ('text' or 'json')
   */
  toolResultFormat: "json" | "text";
}

/**
 * Get the model profile for a given Bedrock model ID
 * @param modelId The full Bedrock model ID (e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0")
 * @returns Model profile with capabilities
 */
export function getModelProfile(modelId: string): ModelProfile {
  const defaultProfile: ModelProfile = {
    supportsPromptCaching: false,
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
          supportsPromptCaching: true,
          supportsToolChoice: true,
          toolResultFormat: "text",
        };
      }
      return defaultProfile;
    case "anthropic":
      // Claude models support tool choice and prompt caching
      return {
        supportsPromptCaching: true,
        supportsToolChoice: true,
        toolResultFormat: "text",
      };
    case "mistral":
      // Mistral models require JSON format for tool results
      return {
        supportsPromptCaching: false,
        supportsToolChoice: false,
        toolResultFormat: "json",
      };

    default:
      return defaultProfile;
  }
}
