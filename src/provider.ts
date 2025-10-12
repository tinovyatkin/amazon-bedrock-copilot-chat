import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatMessage,
	LanguageModelChatProvider,
	ProvideLanguageModelChatResponseOptions,
	LanguageModelResponsePart,
	Progress,
} from "vscode";
import { ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAPIClient } from "./bedrock-client";
import { StreamProcessor } from "./stream-processor";
import { convertMessages } from "./converters/messages";
import { convertTools } from "./converters/tools";
import { validateRequest } from "./validation";
import { logger } from "./logger";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_CONTEXT_LENGTH = 200000;

export class BedrockChatModelProvider implements LanguageModelChatProvider {
	private client: BedrockAPIClient;
	private streamProcessor: StreamProcessor;
	private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];

	constructor(
		private readonly globalState: vscode.Memento,
		private readonly userAgent: string
	) {
		const region = this.globalState.get<string>("bedrock.region") ?? "us-east-1";
		const profile = this.globalState.get<string>("bedrock.profile");
		this.client = new BedrockAPIClient(region, profile);
		this.streamProcessor = new StreamProcessor();
	}

	private estimateMessagesTokens(msgs: readonly vscode.LanguageModelChatMessage[]): number {
		let total = 0;
		for (const m of msgs) {
			for (const part of m.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					total += Math.ceil(part.value.length / 4);
				}
			}
		}
		return total;
	}

	private estimateToolTokens(
		toolConfig: { tools: Array<{ toolSpec: { name: string; description?: string; inputSchema: { json: object } } }> } | undefined
	): number {
		if (!toolConfig || toolConfig.tools.length === 0) {
			return 0;
		}
		try {
			const json = JSON.stringify(toolConfig);
			return Math.ceil(json.length / 4);
		} catch {
			return 0;
		}
	}

	async prepareLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const region = this.globalState.get<string>("bedrock.region") ?? "us-east-1";
		const profile = this.globalState.get<string>("bedrock.profile");
		
		this.client.setRegion(region);
		this.client.setProfile(profile);

		try {
			const [models, availableProfileIds] = await Promise.all([
				this.client.fetchModels(),
				this.client.fetchInferenceProfiles(),
			]);

			const infos: LanguageModelChatInformation[] = [];
			const regionPrefix = region.split("-")[0];

			for (const m of models) {
				if (!m.responseStreamingSupported || !m.outputModalities.includes("TEXT")) {
					continue;
				}

				const contextLen = DEFAULT_CONTEXT_LENGTH;
				const maxOutput = DEFAULT_MAX_OUTPUT_TOKENS;
				const maxInput = Math.max(1, contextLen - maxOutput);
				const vision = m.inputModalities.includes("IMAGE");

				const inferenceProfileId = `${regionPrefix}.${m.modelId}`;
				const hasInferenceProfile = availableProfileIds.has(inferenceProfileId);

				const modelInfo: LanguageModelChatInformation = {
					id: hasInferenceProfile ? inferenceProfileId : m.modelId,
					name: m.modelName,
					tooltip: `AWS Bedrock - ${m.providerName}${hasInferenceProfile ? " (Cross-Region)" : ""}`,
					family: "bedrock",
					version: "1.0.0",
					maxInputTokens: maxInput,
					maxOutputTokens: maxOutput,
					capabilities: {
						toolCalling: true,
						imageInput: vision,
					},
				};
				infos.push(modelInfo);
			}

			this.chatEndpoints = infos.map((info) => ({
				model: info.id,
				modelMaxPromptTokens: info.maxInputTokens + info.maxOutputTokens,
			}));

			return infos;
		} catch (error) {
			if (!options.silent) {
				logger.error("[Bedrock Model Provider] Failed to fetch models", error);
				vscode.window.showErrorMessage(
					`Failed to fetch Bedrock models. Please check your AWS profile and region settings. Error: ${error instanceof Error ? error.message : String(error)}`
				);
			}
			return [];
		}
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		return this.prepareLanguageModelChatInformation({ silent: options.silent ?? false }, _token);
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		const trackingProgress: Progress<LanguageModelResponsePart> = {
			report: (part) => {
				try {
					progress.report(part);
				} catch (e) {
					logger.error("[Bedrock Model Provider] Progress.report failed", {
						modelId: model.id,
						error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
					});
				}
			},
		};

		try {
			logger.log("[Bedrock Model Provider] Converting messages, count:", messages.length);
			messages.forEach((msg, idx) => {
				const partTypes = msg.content.map((p) => {
					if (p instanceof vscode.LanguageModelTextPart) return "text";
					if (p instanceof vscode.LanguageModelToolCallPart) return "toolCall";
					return "toolResult";
				});
				logger.log(`[Bedrock Model Provider] Message ${idx} (${msg.role}):`, partTypes);
			});

			const converted = convertMessages(messages, model.id);
			validateRequest(messages);

			logger.log("[Bedrock Model Provider] Converted to Bedrock messages:", converted.messages.length);
			converted.messages.forEach((msg, idx) => {
				const contentTypes = msg.content.map((c) => {
					if ("text" in c) return "text";
					if ("toolUse" in c) return "toolUse";
					return "toolResult";
				});
				logger.log(`[Bedrock Model Provider] Bedrock message ${idx} (${msg.role}):`, contentTypes);
			});

			const toolConfig = convertTools(options, model.id);

			if (options.tools && options.tools.length > 128) {
				throw new Error("Cannot have more than 128 tools per request.");
			}

			const inputTokenCount = this.estimateMessagesTokens(messages);
			const toolTokenCount = this.estimateToolTokens(toolConfig);
			const tokenLimit = Math.max(1, model.maxInputTokens);
			if (inputTokenCount + toolTokenCount > tokenLimit) {
				logger.error("[Bedrock Model Provider] Message exceeds token limit", {
					total: inputTokenCount + toolTokenCount,
					tokenLimit,
				});
				throw new Error("Message exceeds token limit.");
			}

			const requestInput: ConverseStreamCommandInput = {
				modelId: model.id,
				messages: converted.messages as any,
				inferenceConfig: {
					maxTokens: Math.min(options.modelOptions?.max_tokens || 4096, model.maxOutputTokens),
					temperature: options.modelOptions?.temperature ?? 0.7,
				},
			};

			if (converted.system.length > 0) {
				requestInput.system = converted.system as any;
			}

			if (options.modelOptions) {
				const mo = options.modelOptions as Record<string, unknown>;
				if (typeof mo.top_p === "number") {
					requestInput.inferenceConfig!.topP = mo.top_p;
				}
				if (typeof mo.stop === "string") {
					requestInput.inferenceConfig!.stopSequences = [mo.stop];
				} else if (Array.isArray(mo.stop)) {
					requestInput.inferenceConfig!.stopSequences = mo.stop;
				}
			}

			if (toolConfig) {
				requestInput.toolConfig = toolConfig as any;
			}

			logger.log("[Bedrock Model Provider] Starting streaming request");
			const stream = await this.client.startConversationStream(requestInput);

			logger.log("[Bedrock Model Provider] Processing stream events");
			await this.streamProcessor.processStream(stream, trackingProgress, token);
			logger.log("[Bedrock Model Provider] Finished processing stream");
		} catch (err) {
			logger.error("[Bedrock Model Provider] Chat request failed", {
				modelId: model.id,
				messageCount: messages.length,
				error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
			});
			throw err;
		}
	}

	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage,
		_token: CancellationToken
	): Promise<number> {
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		} else {
			let totalTokens = 0;
			for (const part of text.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					totalTokens += Math.ceil(part.value.length / 4);
				}
			}
			return totalTokens;
		}
	}
}
