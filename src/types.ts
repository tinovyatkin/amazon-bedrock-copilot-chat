export interface BedrockModelSummary {
	modelArn: string;
	modelId: string;
	modelName: string;
	providerName: string;
	inputModalities: string[];
	outputModalities: string[];
	responseStreamingSupported: boolean;
	customizationsSupported?: string[];
	inferenceTypesSupported?: string[];
	modelLifecycle?: {
		status?: string;
	};
}
