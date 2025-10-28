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
