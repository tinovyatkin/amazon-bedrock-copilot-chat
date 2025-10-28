/**
 * Authentication configuration for AWS Bedrock.
 */
export interface AuthConfig {
  accessKeyId?: string;
  apiKey?: string;
  method: AuthMethod;
  profile?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

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
