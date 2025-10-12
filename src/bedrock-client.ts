import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import {
	BedrockRuntimeClient,
	ConverseStreamCommand,
	ConverseStreamCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import type { BedrockModelSummary } from "./types";
import { logger } from "./logger";

export class BedrockAPIClient {
	private region: string;
	private profileName: string | undefined;

	constructor(region: string, profileName?: string) {
		this.region = region;
		this.profileName = profileName;
	}

	setRegion(region: string): void {
		this.region = region;
	}

	setProfile(profileName: string | undefined): void {
		this.profileName = profileName;
	}

	private getCredentials() {
		if (this.profileName) {
			return fromIni({ profile: this.profileName });
		}
		// Use default credentials chain if no profile specified
		return undefined;
	}

	async fetchModels(): Promise<BedrockModelSummary[]> {
		try {
			const client = new BedrockClient({
				region: this.region,
				credentials: this.getCredentials(),
			});

			const command = new ListFoundationModelsCommand({});
			const response = await client.send(command);

			return (response.modelSummaries ?? []).map((summary) => ({
				modelArn: summary.modelArn || "",
				modelId: summary.modelId || "",
				modelName: summary.modelName || "",
				providerName: summary.providerName || "",
				inputModalities: summary.inputModalities || [],
				outputModalities: summary.outputModalities || [],
				responseStreamingSupported: summary.responseStreamingSupported || false,
				customizationsSupported: summary.customizationsSupported,
				inferenceTypesSupported: summary.inferenceTypesSupported,
				modelLifecycle: summary.modelLifecycle,
			}));
		} catch (err) {
			logger.error("[Bedrock API Client] Failed to fetch Bedrock models", err);
			throw err;
		}
	}

	async fetchInferenceProfiles(): Promise<Set<string>> {
		try {
			const client = new BedrockClient({
				region: this.region,
				credentials: this.getCredentials(),
			});

			const command = new ListInferenceProfilesCommand({});
			const response = await client.send(command);

			const profileIds = new Set<string>();
			for (const profile of response.inferenceProfileSummaries ?? []) {
				if (profile.inferenceProfileId) {
					profileIds.add(profile.inferenceProfileId);
				}
			}

			return profileIds;
		} catch (err) {
			logger.error("[Bedrock API Client] Failed to fetch inference profiles", err);
			return new Set();
		}
	}

	async startConversationStream(input: ConverseStreamCommandInput): Promise<AsyncIterable<any>> {
		const client = new BedrockRuntimeClient({
			region: this.region,
			credentials: this.getCredentials(),
		});

		const command = new ConverseStreamCommand(input);
		const response = await client.send(command);

		if (!response.stream) {
			throw new Error("No stream in response");
		}

		return response.stream;
	}
}
