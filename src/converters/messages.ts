import * as vscode from "vscode";
import { getModelProfile } from "../profiles";

interface BedrockMessage {
	role: string;
	content: any[];
}

interface BedrockSystemMessage {
	text: string;
}

interface ConvertedMessages {
	messages: BedrockMessage[];
	system: BedrockSystemMessage[];
}

/**
 * Convert VSCode language model messages to Bedrock API format
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatMessage[],
	modelId: string
): ConvertedMessages {
	const profile = getModelProfile(modelId);
	const bedrockMessages: BedrockMessage[] = [];
	const systemMessages: BedrockSystemMessage[] = [];

	for (const msg of messages) {
		if (msg.role === vscode.LanguageModelChatMessageRole.User) {
			const content: any[] = [];
			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content.push({ text: part.value });
				} else if (part instanceof vscode.LanguageModelToolResultPart) {
					const resultContent =
						profile.toolResultFormat === "json" && typeof part.content === "object"
							? JSON.stringify(part.content)
							: String(part.content);

					content.push({
						toolResult: {
							toolUseId: part.callId,
							content: [{ text: resultContent }],
						},
					});
				}
			}
			if (content.length > 0) {
				bedrockMessages.push({ role: "user", content });
			}
		} else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
			const content: any[] = [];
			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content.push({ text: part.value });
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					content.push({
						toolUse: {
							toolUseId: part.callId,
							name: part.name,
							input: part.input,
						},
					});
				}
			}
			if (content.length > 0) {
				bedrockMessages.push({ role: "assistant", content });
			}
		} else {
			// System messages
			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					systemMessages.push({ text: part.value });
				}
			}
		}
	}

	return { messages: bedrockMessages, system: systemMessages };
}
