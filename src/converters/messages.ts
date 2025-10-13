import {
  Message as BedrockMessage,
  CachePointType,
  ContentBlock,
  SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import * as vscode from "vscode";

import { logger } from "../logger";
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
      const content: ContentBlock[] = [];
      let hasToolResults = false;

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ text: part.value });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          hasToolResults = true;
          const isJson =
            profile.toolResultFormat === "json" &&
            typeof part.content === "object" &&
            part.content !== null;
          const contentBlock = isJson ? { json: part.content } : { text: String(part.content) };
          const status = (part as any).isError ? "error" : undefined;

          content.push({
            toolResult: {
              content: [contentBlock] as any, // AWS SDK uses __DocumentType which is too strict
              toolUseId: part.callId,
              ...(status ? { status } : {}),
            },
          });
        }
      }

      // Add cache point after tool results if prompt caching is supported
      if (profile.supportsPromptCaching && hasToolResults) {
        content.push({ cachePoint: { type: CachePointType.DEFAULT } });
      }

      if (content.length > 0) {
        // Check if last message was also a user message - if so, merge content
        const lastMessage = bedrockMessages[bedrockMessages.length - 1];
        if (lastMessage && lastMessage.role === "user" && lastMessage.content) {
          // Merge content into the last user message
          logger.log("[Message Converter] Merging consecutive USER messages");
          lastMessage.content.push(...content);
        } else {
          bedrockMessages.push({ content, role: "user" });
        }
      }
    } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
      const content: ContentBlock[] = [];
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ text: part.value });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          content.push({
            toolUse: {
              input: part.input as any, // AWS SDK uses __DocumentType which is too strict
              name: part.name,
              toolUseId: part.callId,
            },
          });
        }
      }
      if (content.length > 0) {
        // Check if last message was also an assistant message - if so, merge content
        const lastMessage = bedrockMessages[bedrockMessages.length - 1];
        if (lastMessage && lastMessage.role === "assistant" && lastMessage.content) {
          // Merge content into the last assistant message
          logger.log("[Message Converter] Merging consecutive ASSISTANT messages");
          lastMessage.content.push(...content);
        } else {
          bedrockMessages.push({ content, role: "assistant" });
        }
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

  // Add cache point after system messages if prompt caching is supported
  if (profile.supportsPromptCaching && systemMessages.length > 0) {
    systemMessages.push({ cachePoint: { type: CachePointType.DEFAULT } });
  }

  return { messages: bedrockMessages, system: systemMessages };
}
