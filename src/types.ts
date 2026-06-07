/**
 * Authentication configuration for AWS Bedrock.
 * Discriminated union ensures type-safe field combinations.
 */
export type AuthConfig =
  | {
      accessKeyId: string;
      method: "access-keys";
      secretAccessKey: string;
      sessionToken?: string;
    }
  | { apiKey: string; method: "api-key" }
  | { method: "profile"; profile?: string };

/**
 * Authentication method for AWS Bedrock.
 */
export type AuthMethod = "access-keys" | "api-key" | "profile";

export interface BedrockModelSummary {
  /** For application inference profiles, the underlying base model ID used for token limits */
  baseModelId?: string;
  /** For inference profiles, when the profile was created */
  createdAt?: Date;
  customizationsSupported?: string[];
  inferenceTypesSupported?: string[];
  inputModalities: string[];
  modelArn: string;
  modelId: string;
  modelLifecycle?: {
    status?: string;
  };
  modelName: string;
  outputModalities: string[];
  providerName: string;
  responseStreamingSupported: boolean;
  /** For inference profiles, when the profile was last updated */
  updatedAt?: Date;
}

/**
 * A single model entry from https://models.dev/api.json (amazon-bedrock provider).
 * Used to supplement and override hardcoded values in profiles.ts / getModelTokenLimits.
 */
export interface ModelsDevEntry {
  /** Whether the model supports file attachments / vision input */
  attachment?: boolean;
  /** USD/1M token pricing (from models.dev cost field) */
  cost?: {
    /** Cache read cost in USD per million tokens */
    cache_read?: number;
    /** Cache write cost in USD per million tokens */
    cache_write?: number;
    /** Input token cost in USD per million tokens */
    input?: number;
    /** Output token cost in USD per million tokens */
    output?: number;
  };
  /** Family name (e.g. "claude-sonnet", "nova-pro") */
  family?: string;
  /**
   * Whether the model interleaves reasoning content with text output.
   * `true` = reasoning_content field; `{ field: "reasoning_content" }` = same but explicit.
   * Relevant for non-Claude models (Kimi K2, GLM). Claude uses a different beta header mechanism.
   */
  interleaved?: boolean | { field: string };
  /** Token limits */
  limit: {
    /** Total context window in tokens */
    context: number;
    /** Maximum output tokens */
    output: number;
  };
  /** Input/output modalities */
  modalities?: {
    input?: string[];
    output?: string[];
  };
  /** Display name */
  name?: string;
  /** Whether the model supports extended thinking / reasoning */
  reasoning?: boolean;
  /** Whether the model supports structured output */
  structured_output?: boolean;
  /** Whether the model accepts the temperature parameter (false = temperatureDeprecated) */
  temperature?: boolean;
  /** Whether the model supports tool/function calling */
  tool_call?: boolean;
}

/**
 * Map of Bedrock model ID → models.dev entry.
 * Keys match the exact model IDs returned by Bedrock (including regional prefixes).
 * Fetched once at startup from https://models.dev/api.json, fails silently.
 */
export type ModelsDevMap = Map<string, ModelsDevEntry>;
