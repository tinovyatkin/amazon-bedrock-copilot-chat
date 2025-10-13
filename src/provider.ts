import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatMessage,
	LanguageModelChatProvider,
	LanguageModelResponsePart,
	Progress,
} from "vscode";
import { ConverseStreamCommandInput, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAPIClient } from "./bedrock-client";
import { StreamProcessor } from "./stream-processor";
import { convertMessages } from "./converters/messages";
import { convertTools } from "./converters/tools";
import { validateRequest } from "./validation";
import { logger } from "./logger";
import { getBedrockSettings } from "./settings";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_CONTEXT_LENGTH = 200000;

export class BedrockChatModelProvider implements LanguageModelChatProvider {
	private chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
	private client: BedrockAPIClient;
	private streamProcessor: StreamProcessor;

	constructor(
		private readonly globalState: vscode.Memento,
		private readonly userAgent: string
	) {
		const settings = getBedrockSettings(this.globalState);
		this.client = new BedrockAPIClient(settings.region, settings.profile);
		this.streamProcessor = new StreamProcessor();
	}

	async prepareLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const settings = getBedrockSettings(this.globalState);

		this.client.setRegion(settings.region);
		this.client.setProfile(settings.profile);

		try {
			const [models, availableProfileIds] = await Promise.all([
				this.client.fetchModels(),
				this.client.fetchInferenceProfiles(),
			]);

			const infos: LanguageModelChatInformation[] = [];
			const regionPrefix = settings.region.split("-")[0];

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
					capabilities: {
						imageInput: vision,
						toolCalling: true,
					},
					family: "bedrock",
					id: hasInferenceProfile ? inferenceProfileId : m.modelId,
					maxInputTokens: maxInput,
					maxOutputTokens: maxOutput,
					name: m.modelName,
					tooltip: `AWS Bedrock - ${m.providerName}${hasInferenceProfile ? " (Cross-Region)" : ""}`,
					version: "1.0.0",
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
		options: Parameters<LanguageModelChatProvider['provideLanguageModelChatResponse']>[2],
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		const trackingProgress: Progress<LanguageModelResponsePart> = {
			report: (part) => {
				try {
					progress.report(part);
				} catch (e) {
					logger.error("[Bedrock Model Provider] Progress.report failed", {
						error: e instanceof Error ? { message: e.message, name: e.name } : String(e),
						modelId: model.id,
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
				const contentTypes = msg.content?.map((c) => {
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
			const toolTokenCount =  this.estimateToolTokens(toolConfig);
			const tokenLimit = Math.max(1, model.maxInputTokens);
			if (inputTokenCount + toolTokenCount > tokenLimit) {
				logger.error("[Bedrock Model Provider] Message exceeds token limit", {
					tokenLimit,
					total: inputTokenCount + toolTokenCount,
				});
				throw new Error("Message exceeds token limit.");
			}

			const requestInput: ConverseStreamCommandInput = {
				inferenceConfig: {
					maxTokens: Math.min(options.modelOptions?.max_tokens || 4096, model.maxOutputTokens),
					temperature: options.modelOptions?.temperature ?? 0.7,
				},
				messages: converted.messages as any,
				modelId: model.id,
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
				error: err instanceof Error ? { message: err.message, name: err.name } : String(err),
				messageCount: messages.length,
				modelId: model.id,
			});
			throw err;
		}
	}

	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: LanguageModelChatMessage | string,
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
		toolConfig: ToolConfiguration | undefined
	): number {
		if (!toolConfig || toolConfig?.tools?.length === 0) {
			return 0;
		}
		try {
			const json = JSON.stringify(toolConfig);
			return Math.ceil(json.length / 4);
		} catch {
			return 0;
		}
	}
}
