import {
  Message as BedrockMessage,
  CachePointType,
  ContentBlock,
  ConversationRole,
  SystemContentBlock,
  ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import * as vscode from "vscode";

import { logger } from "../logger";
import { getModelProfile } from "../profiles";
import type { ThinkingBlock } from "../stream-processor";

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
  options?: { extendedThinkingEnabled?: boolean; lastThinkingBlock?: ThinkingBlock },
): ConvertedMessages {
  const profile = getModelProfile(modelId);
  const bedrockMessages: BedrockMessage[] = [];
  const systemMessages: SystemContentBlock[] = [];
  const userMessageIndicesWithToolResults: number[] = [];

  logger.trace("[Message Converter] Starting conversion with options:", {
    extendedThinkingEnabled: options?.extendedThinkingEnabled,
    hasLastThinkingBlock: !!options?.lastThinkingBlock,
    lastThinkingBlockSignature: options?.lastThinkingBlock?.signature,
    lastThinkingBlockTextLength: options?.lastThinkingBlock?.text.length,
  });

  for (const msg of messages) {
    if (msg.role === vscode.LanguageModelChatMessageRole.User) {
      const content: ContentBlock[] = [];
      let hasToolResults = false;

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          content.push({ text: part.value });
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          hasToolResults = true;

          // Extract text content from the tool result
          // Tool result content is an array of LanguageModelTextPart or other types
          let textContent = "";
          if (Array.isArray(part.content)) {
            for (const item of part.content) {
              if (item instanceof vscode.LanguageModelTextPart) {
                textContent += item.value;
              } else if (typeof item === "string") {
                textContent += item;
              } else {
                // For unknown types, try to stringify
                textContent += JSON.stringify(item);
              }
            }
          } else if (typeof part.content === "string") {
            textContent = part.content;
          } else {
            textContent = JSON.stringify(part.content);
          }

          // Log complete VSCode tool result part
          logger.debug("[Message Converter] Processing VSCode tool result:", {
            // Log all properties of the part for debugging
            allProperties: Object.keys(part),
            callId: part.callId,
            contentType: typeof part.content,
            hasIsError: "isError" in part,
            isArray: Array.isArray(part.content),
            // Check for isError property (not in VSCode API, but logging for debugging)
            isError: "isError" in part ? (part as Record<string, unknown>).isError : undefined,
            textLength: textContent.length,
            textPreview: textContent.substring(0, 200),
          });

          const partContent = part.content;
          const isJson =
            profile.toolResultFormat === "json" &&
            typeof partContent === "object" &&
            partContent !== null &&
            !Array.isArray(partContent);
          const contentBlock: ToolResultContentBlock = isJson
            ? ({ json: partContent } satisfies ToolResultContentBlock.JsonMember)
            : ({ text: textContent } satisfies ToolResultContentBlock.TextMember);

          // Since VSCode API doesn't provide isError property, detect errors from content
          // Look for common error patterns in the text content
          const lowerContent = textContent.toLowerCase();
          const isLikelyError =
            lowerContent.startsWith("error") ||
            lowerContent.startsWith("error while calling tool:") ||
            lowerContent.includes("error while calling tool:") ||
            lowerContent.includes("invalid terminal id") ||
            lowerContent.includes("please check your input");

          const status = isLikelyError ? "error" : undefined;

          logger.debug("[Message Converter] Error status decision:", {
            contentPreview: textContent.substring(0, 100),
            detectedFromContent: isLikelyError,
            hasIsErrorProperty: "isError" in part,
            // Check for isError property (not in VSCode API, but logging for debugging)
            isErrorValue: "isError" in part ? (part as Record<string, unknown>).isError : undefined,
            resultingStatus: status,
          });

          logger.debug("[Message Converter] Created Bedrock tool result:", {
            format: isJson ? "json" : "text",
            hasContent: contentBlock ? true : false,
            status,
            toolUseId: part.callId,
          });

          content.push({
            toolResult: {
              content: [contentBlock],
              toolUseId: part.callId,
              ...(status ? { status } : {}),
            },
          } satisfies ContentBlock.ToolResultMember);
        }
      }

      if (content.length > 0) {
        // Check if last message was also a user message - if so, merge content
        const lastMessage = bedrockMessages[bedrockMessages.length - 1];
        if (lastMessage && lastMessage.role === ConversationRole.USER && lastMessage.content) {
          // Merge content into the last user message
          logger.debug("[Message Converter] Merging consecutive USER messages");
          lastMessage.content.push(...content);
          // Update hasToolResults tracking for merged message
          if (hasToolResults) {
            const lastIndex = bedrockMessages.length - 1;
            if (!userMessageIndicesWithToolResults.includes(lastIndex)) {
              userMessageIndicesWithToolResults.push(lastIndex);
            }
          }
        } else {
          bedrockMessages.push({ content, role: ConversationRole.USER });
          if (hasToolResults) {
            userMessageIndicesWithToolResults.push(bedrockMessages.length - 1);
          }
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
              input: part.input as DocumentType,
              name: part.name,
              toolUseId: part.callId,
            },
          });
        }
      }
      if (content.length > 0) {
        // Check if last message was also an assistant message - if so, merge content
        const lastMessage = bedrockMessages[bedrockMessages.length - 1];
        if (lastMessage && lastMessage.role === ConversationRole.ASSISTANT && lastMessage.content) {
          // Merge content into the last assistant message
          logger.debug("[Message Converter] Merging consecutive ASSISTANT messages");
          lastMessage.content.push(...content);
        } else {
          bedrockMessages.push({ content, role: ConversationRole.ASSISTANT });
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

  // Add cache points to the last 2 user messages with tool results
  // This ensures we stay within the 4 cache point limit:
  // 1. After system messages
  // 2. After tool definitions (in tools.ts)
  // 3-4. After last 2 tool result messages
  if (profile.supportsPromptCaching && userMessageIndicesWithToolResults.length > 0) {
    // Get the last 2 indices
    const indicesToCache = userMessageIndicesWithToolResults.slice(-2);
    logger.debug(
      `[Message Converter] Adding cache points to last ${indicesToCache.length} tool result messages (indices: ${indicesToCache.join(", ")})`,
    );

    for (const idx of indicesToCache) {
      const message = bedrockMessages[idx];
      if (message && message.content) {
        message.content.push({ cachePoint: { type: CachePointType.DEFAULT } });
      }
    }
  }

  // Inject captured thinking as reasoningContent (official SDK format)
  // AWS docs show proprietary "thinking" format, but SDK uses reasoningContent
  if (options?.extendedThinkingEnabled && options.lastThinkingBlock) {
    for (let i = bedrockMessages.length - 1; i >= 0; i--) {
      const message = bedrockMessages[i];
      if (
        message.role === ConversationRole.ASSISTANT &&
        message.content &&
        message.content.length > 0
      ) {
        const hasReasoning = message.content.some(
          (block) => "reasoningContent" in block || "thinking" in block,
        );

        if (!hasReasoning) {
          logger.debug("[Message Converter] Injecting thinking as reasoningContent", {
            hasSignature: !!options.lastThinkingBlock.signature,
            textLength: options.lastThinkingBlock.text.length,
          });

          // Use official SDK reasoningContent format
          const reasoningBlock: ContentBlock.ReasoningContentMember = {
            reasoningContent: {
              reasoningText: {
                signature: options.lastThinkingBlock.signature,
                text: options.lastThinkingBlock.text,
              },
            },
          };

          message.content.unshift(reasoningBlock);
        }
        break;
      }
    }
  }

  return { messages: bedrockMessages, system: systemMessages };
}
