import {
  BedrockClient,
  GetFoundationModelAvailabilityCommand,
  ListFoundationModelsCommand,
  paginateListInferenceProfiles,
} from "@aws-sdk/client-bedrock";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";

import { logger } from "./logger";
import type { BedrockModelSummary } from "./types";

export class BedrockAPIClient {
  private profileName?: string;
  private region: string;

  constructor(region: string, profileName?: string) {
    this.region = region;
    this.profileName = profileName;
  }

  async fetchInferenceProfiles(): Promise<Set<string>> {
    try {
      const client = new BedrockClient({
        credentials: this.getCredentials(),
        region: this.region,
      });

      const profileIds = new Set<string>();
      const paginator = paginateListInferenceProfiles({ client }, {});

      for await (const page of paginator) {
        for (const profile of page.inferenceProfileSummaries ?? []) {
          if (profile.inferenceProfileId) {
            profileIds.add(profile.inferenceProfileId);
          }
        }
      }

      return profileIds;
    } catch (err) {
      logger.error("[Bedrock API Client] Failed to fetch inference profiles", err);
      return new Set();
    }
  }

  async fetchModels(): Promise<BedrockModelSummary[]> {
    try {
      const client = new BedrockClient({
        credentials: this.getCredentials(),
        region: this.region,
      });

      const command = new ListFoundationModelsCommand({});
      const response = await client.send(command);

      return (response.modelSummaries ?? []).map((summary) => ({
        customizationsSupported: summary.customizationsSupported,
        inferenceTypesSupported: summary.inferenceTypesSupported,
        inputModalities: summary.inputModalities || [],
        modelArn: summary.modelArn || "",
        modelId: summary.modelId || "",
        modelLifecycle: summary.modelLifecycle,
        modelName: summary.modelName || "",
        outputModalities: summary.outputModalities || [],
        providerName: summary.providerName || "",
        responseStreamingSupported: summary.responseStreamingSupported || false,
      }));
    } catch (err) {
      logger.error("[Bedrock API Client] Failed to fetch Bedrock models", err);
      throw err;
    }
  }

  /**
   * Check if a model is accessible (authorized and available in the region).
   * @param modelId The model ID to check
   * @returns true if the model is accessible, false otherwise
   */
  async isModelAccessible(modelId: string): Promise<boolean> {
    try {
      const client = new BedrockClient({
        credentials: this.getCredentials(),
        region: this.region,
      });

      const command = new GetFoundationModelAvailabilityCommand({ modelId });
      const response = await client.send(command);

      // Model is accessible if it's authorized and available in the region
      return (
        response.authorizationStatus === "AUTHORIZED" && response.regionAvailability === "AVAILABLE"
      );
    } catch (err) {
      logger.error(`[Bedrock API Client] Failed to check availability for model ${modelId}`, err);
      return false;
    }
  }

  setProfile(profileName: string | undefined): void {
    this.profileName = profileName;
  }

  setRegion(region: string): void {
    this.region = region;
  }

  async startConversationStream(
    input: ConverseStreamCommandInput,
  ): Promise<AsyncIterable<ConverseStreamOutput>> {
    const client = new BedrockRuntimeClient({
      credentials: this.getCredentials(),
      region: this.region,
    });

    const command = new ConverseStreamCommand(input);
    const response = await client.send(command);

    if (!response.stream) {
      throw new Error("No stream in response");
    }

    return response.stream;
  }

  private getCredentials() {
    if (this.profileName) {
      return fromIni({ profile: this.profileName });
    }
    // Use default credentials chain if no profile specified
    return undefined;
  }
}
