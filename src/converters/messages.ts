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
// eslint-disable-next-line sonarjs/cognitive-complexity
export function convertMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string,
  options?: {
    extendedThinkingEnabled?: boolean;
    lastThinkingBlock?: ThinkingBlock;
    promptCachingEnabled?: boolean;
  },
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
          // Skip empty text parts - Bedrock API rejects blank text fields
          if (part.value.trim()) {
            content.push({ text: part.value });
          }
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
            textPreview: textContent.slice(0, 200),
          });

          const partContent = part.content;
          const isJson =
            profile.toolResultFormat === "json" &&
            typeof partContent === "object" &&
            partContent != null &&
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

          // Only include status field if model supports it
          // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L333-L347
          // AWS Docs: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html
          const status = profile.supportsToolResultStatus && isLikelyError ? "error" : undefined;

          logger.debug("[Message Converter] Error status decision:", {
            contentPreview: textContent.slice(0, 100),
            detectedFromContent: isLikelyError,
            hasIsErrorProperty: "isError" in part,
            // Check for isError property (not in VSCode API, but logging for debugging)
            isErrorValue: "isError" in part ? (part as Record<string, unknown>).isError : undefined,
            modelSupportsStatus: profile.supportsToolResultStatus,
            resultingStatus: status,
          });

          logger.debug("[Message Converter] Created Bedrock tool result:", {
            format: isJson ? "json" : "text",
            hasContent: true,
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
        const lastMessage = bedrockMessages.at(-1);
        if (lastMessage?.role === ConversationRole.USER && lastMessage.content !== undefined) {
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
          // Skip empty text parts - Bedrock API rejects blank text fields
          if (part.value.trim()) {
            content.push({ text: part.value });
          }
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
        const lastMessage = bedrockMessages.at(-1);
        if (lastMessage?.role === ConversationRole.ASSISTANT && lastMessage.content !== undefined) {
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
        if (
          part instanceof vscode.LanguageModelTextPart && // Skip empty text parts - Bedrock API rejects blank text fields
          part.value.trim()
        ) {
          systemMessages.push({ text: part.value });
        }
      }
    }
  }

  // Check if prompt caching should be enabled (defaults to true)
  const promptCachingEnabled = options?.promptCachingEnabled ?? true;

  // Add cache point after system messages if prompt caching is supported and enabled
  if (profile.supportsPromptCaching && promptCachingEnabled && systemMessages.length > 0) {
    systemMessages.push({ cachePoint: { type: CachePointType.DEFAULT } });
  }

  // Add cache points to the last 2 user messages
  // Strategy depends on whether model supports caching with tool results:
  // - If supported: Add cache points to messages WITH tool results
  // - If not supported: Add cache points to messages WITHOUT tool results
  // This ensures we stay within the 4 cache point limit:
  // 1. After system messages
  // 2. After tool definitions (in tools.ts)
  // 3-4. After last 2 user messages (with or without tool results)
  if (profile.supportsPromptCaching && promptCachingEnabled) {
    let indicesToCache: number[] = [];

    if (profile.supportsCachingWithToolResults && userMessageIndicesWithToolResults.length > 0) {
      // Model supports caching with tool results: cache messages WITH tool results
      indicesToCache = userMessageIndicesWithToolResults.slice(-2);
      logger.debug(
        `[Message Converter] Adding cache points to last ${indicesToCache.length} messages with tool results (indices: ${indicesToCache.join(", ")})`,
      );
    } else if (!profile.supportsCachingWithToolResults) {
      // Model does NOT support caching with tool results: cache messages WITHOUT tool results
      // Find all user message indices that DON'T have tool results
      const userMessagesWithoutToolResults: number[] = [];
      for (const [i, message] of bedrockMessages.entries()) {
        if (
          message?.role === ConversationRole.USER &&
          !userMessageIndicesWithToolResults.includes(i)
        ) {
          userMessagesWithoutToolResults.push(i);
        }
      }

      // Get the last 2 indices
      indicesToCache = userMessagesWithoutToolResults.slice(-2);
      if (indicesToCache.length > 0) {
        logger.debug(
          `[Message Converter] Adding cache points to last ${indicesToCache.length} messages without tool results (indices: ${indicesToCache.join(", ")})`,
        );
      }
    }

    // Add cache points to the selected messages
    for (const idx of indicesToCache) {
      const message = bedrockMessages[idx];
      if (message?.content !== undefined) {
        message.content.push({ cachePoint: { type: CachePointType.DEFAULT } });
      }
    }
  }

  // Inject captured thinking as reasoningContent into ALL assistant messages
  // CRITICAL: When anthropic_beta: ["interleaved-thinking-2025-05-14"] is present,
  // the API requires ALL assistant messages to have thinking blocks, not just the last one
  if (options?.extendedThinkingEnabled && options.lastThinkingBlock?.signature) {
    let injectedCount = 0;
    for (const message of bedrockMessages) {
      if (
        message.role === ConversationRole.ASSISTANT &&
        message.content &&
        message.content.length > 0
      ) {
        const hasReasoning = message.content.some(
          (block) => "reasoningContent" in block || "thinking" in block,
        );

        if (!hasReasoning) {
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
          injectedCount++;
        }
      }
    }

    if (injectedCount > 0) {
      logger.debug("[Message Converter] Injected thinking into assistant messages", {
        count: injectedCount,
        signatureLength: options.lastThinkingBlock.signature.length,
        textLength: options.lastThinkingBlock.text.length,
      });
    }
  } else if (options?.extendedThinkingEnabled && options.lastThinkingBlock) {
    logger.warn(
      "[Message Converter] Cannot inject thinking block - signature required for interleaved thinking",
      {
        capturedFromDeltas: !options.lastThinkingBlock.signature,
        textLength: options.lastThinkingBlock.text.length,
      },
    );
  }

  // Deepseek models have issues with reasoningContent in multi-turn conversations
  // Filter out reasoningContent blocks for Deepseek models
  // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L306-L309
  // Deepseek API docs: https://api-docs.deepseek.com/guides/reasoning_model#multi-round-conversation
  const isDeepseekModel = modelId.toLowerCase().includes("deepseek");
  if (isDeepseekModel) {
    let filteredCount = 0;
    for (const message of bedrockMessages) {
      if (message.content) {
        const originalLength = message.content.length;
        message.content = message.content.filter((block) => {
          if ("reasoningContent" in block) {
            filteredCount++;
            return false;
          }
          return true;
        });
        // Remove message entirely if all content was filtered out
        if (message.content.length === 0 && originalLength > 0) {
          logger.debug(
            "[Message Converter] Message became empty after filtering reasoningContent, will be removed",
          );
        }
      }
    }
    // Remove empty messages
    const messagesBeforeFilter = bedrockMessages.length;
    bedrockMessages.splice(
      0,
      bedrockMessages.length,
      ...bedrockMessages.filter((msg) => msg.content && msg.content.length > 0),
    );
    if (filteredCount > 0) {
      logger.debug("[Message Converter] Filtered reasoningContent for Deepseek model", {
        blocksFiltered: filteredCount,
        emptyMessagesRemoved: messagesBeforeFilter - bedrockMessages.length,
      });
    }
  }

  return { messages: bedrockMessages, system: systemMessages };
}
