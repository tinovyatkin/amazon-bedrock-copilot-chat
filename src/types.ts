export interface BedrockModelSummary {
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
