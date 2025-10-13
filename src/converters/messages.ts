import { Message as BedrockMessage, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import * as vscode from "vscode";

import { getModelProfile } from "../profiles";

interface ConvertedMessages {
  messages: BedrockMessage[];
  system: SystemContentBlock[];
}

/**
 * Convert VSCode language model messages to Bedrock API format
 */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string,
): ConvertedMessages {
  const profile = getModelProfile(modelId);
  const bedrockMessages: BedrockMessage[] = [];
  const systemMessages: SystemContentBlock[] = [];

  for (const msg of messages) {
    if (msg.role === vscode.LanguageModelChatMessageRole.User) {
      const content: any[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ text: part.value });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          const isJson =
            profile.toolResultFormat === "json" &&
            typeof part.content === "object" &&
            part.content !== null;
          const contentBlock = isJson ? { json: part.content } : { text: String(part.content) };
          const status = (part as any).isError ? "error" : undefined;

          content.push({
            toolResult: {
              content: [contentBlock],
              toolUseId: part.callId,
              ...(status ? { status } : {}),
            },
          });
        }
      }
      if (content.length > 0) {
        bedrockMessages.push({ content, role: "user" });
      }
    } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
      const content: any[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ text: part.value });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          content.push({
            toolUse: {
              input: part.input,
              name: part.name,
              toolUseId: part.callId,
            },
          });
        }
      }
      if (content.length > 0) {
        bedrockMessages.push({ content, role: "assistant" });
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
