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
  | { apiKey: string; method: "api-key"; }
  | { method: "profile"; profile?: string };

/**
 * Authentication method for AWS Bedrock.
 */
export type AuthMethod = "access-keys" | "api-key" | "profile";

export interface BedrockModelSummary {
  /** For application inference profiles, the underlying base model ID used for token limits */
  baseModelId?: string;
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
}
