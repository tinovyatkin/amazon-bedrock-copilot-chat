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
  private bedrockClient: BedrockClient;
  private bedrockRuntimeClient: BedrockRuntimeClient;
  private profileName?: string;
  private region: string;

  constructor(region: string, profileName?: string) {
    this.region = region;
    this.profileName = profileName;
    this.bedrockClient = new BedrockClient(this.getClientConfig());
    this.bedrockRuntimeClient = new BedrockRuntimeClient(this.getClientConfig());
  }

  async fetchInferenceProfiles(abortSignal?: AbortSignal): Promise<Set<string>> {
    try {
      const profileIds = new Set<string>();
      const paginator = paginateListInferenceProfiles({ client: this.bedrockClient }, {});

      for await (const page of paginator) {
        // Check if the operation was cancelled
        if (abortSignal?.aborted) {
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          throw error;
        }

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

  async fetchModels(abortSignal?: AbortSignal): Promise<BedrockModelSummary[]> {
    try {
      const command = new ListFoundationModelsCommand({});
      const response = await this.bedrockClient.send(command, { abortSignal });

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
   * @param abortSignal Optional AbortSignal to cancel the request
   * @returns true if the model is accessible, false otherwise
   */
  async isModelAccessible(modelId: string, abortSignal?: AbortSignal): Promise<boolean> {
    try {
      const command = new GetFoundationModelAvailabilityCommand({ modelId });
      const response = await this.bedrockClient.send(command, { abortSignal });

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
    this.recreateClients();
  }

  setRegion(region: string): void {
    this.region = region;
    this.recreateClients();
  }

  async startConversationStream(
    input: ConverseStreamCommandInput,
  ): Promise<AsyncIterable<ConverseStreamOutput>> {
    const command = new ConverseStreamCommand(input);
    const response = await this.bedrockRuntimeClient.send(command);

    if (!response.stream) {
      throw new Error("No stream in response");
    }

    return response.stream;
  }

  private getClientConfig() {
    return {
      credentials: this.getCredentials(),
      region: this.region,
    };
  }

  private getCredentials() {
    if (this.profileName) {
      return fromIni({ profile: this.profileName });
    }
    // Use default credentials chain if no profile specified
    return undefined;
  }

  private recreateClients(): void {
    this.bedrockClient = new BedrockClient(this.getClientConfig());
    this.bedrockRuntimeClient = new BedrockRuntimeClient(this.getClientConfig());
  }
}
