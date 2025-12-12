import {
  type Message as BedrockMessage,
  CachePointType,
  type ContentBlock,
  ConversationRole,
  type SystemContentBlock,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { inspect, MIMEType, types } from "node:util";
import * as vscode from "vscode";

import { logger } from "../logger";
import { getModelProfile, type ModelProfile } from "../profiles";
import type { ThinkingBlock } from "../stream-processor";

interface ConvertedMessages {
  messages: BedrockMessage[];
  system: SystemContentBlock[];
}

interface ImageDataPart {
  data: Uint8Array;
  mimeType: string;
}

/**
 * Convert VSCode language model messages to Bedrock API format
 */
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

  // Process each message by role
  for (const msg of messages) {
    if (msg.role === vscode.LanguageModelChatMessageRole.User) {
      const { content, hasToolResults } = processUserMessageParts(msg, profile);
      mergeOrAppendMessage(
        bedrockMessages,
        content,
        ConversationRole.USER,
        hasToolResults,
        userMessageIndicesWithToolResults,
      );
    } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
      const content = processAssistantMessageParts(msg);
      mergeOrAppendMessage(
        bedrockMessages,
        content,
        ConversationRole.ASSISTANT,
        false,
        userMessageIndicesWithToolResults,
      );
    } else {
      // System messages
      systemMessages.push(...processSystemMessageParts(msg));
    }
  }

  // Add prompt caching points if enabled (defaults to true)
  if (options?.promptCachingEnabled ?? true) {
    addPromptCachingPoints(
      profile,
      systemMessages,
      bedrockMessages,
      userMessageIndicesWithToolResults,
    );
  }

  // Inject extended thinking if enabled
  if (options?.extendedThinkingEnabled && options.lastThinkingBlock) {
    injectExtendedThinking(bedrockMessages, options.lastThinkingBlock);
  }

  // Filter reasoning content for Deepseek models
  filterDeepseekReasoningContent(bedrockMessages, modelId);

  return { messages: bedrockMessages, system: systemMessages };
}

/**
 * Strip thinking/reasoning content blocks from messages.
 * This is used when sending messages to APIs that don't support thinking blocks
 * (e.g., CountTokens API when thinking is not enabled).
 *
 * @param messages The messages to filter (will be modified in place)
 * @returns The same messages array with thinking content removed
 */
export function stripThinkingContent(messages: BedrockMessage[]): BedrockMessage[] {
  return filterContentBlocks(
    messages,
    (block) =>
      !("reasoningContent" in block) && !("thinking" in block) && !("redacted_thinking" in block),
    "Stripped thinking/reasoning content from messages",
  );
}

/**
 * Add prompt caching points to system and user messages
 */
function addPromptCachingPoints(
  profile: ModelProfile,
  systemMessages: SystemContentBlock[],
  bedrockMessages: BedrockMessage[],
  userMessageIndicesWithToolResults: number[],
): void {
  if (!profile.supportsPromptCaching) return;

  // Add cache point after system messages
  if (systemMessages.length > 0) {
    systemMessages.push({ cachePoint: { type: CachePointType.DEFAULT } });
  }

  // Add cache points to the last 2 user messages
  let indicesToCache: number[] = [];

  if (profile.supportsCachingWithToolResults && userMessageIndicesWithToolResults.length > 0) {
    // Model supports caching with tool results: cache messages WITH tool results
    indicesToCache = userMessageIndicesWithToolResults.slice(-2);
    logger.debug(
      `[Message Converter] Adding cache points to last ${indicesToCache.length} messages with tool results (indices: ${indicesToCache.join(", ")})`,
    );
  } else if (!profile.supportsCachingWithToolResults) {
    // Model does NOT support caching with tool results: cache messages WITHOUT tool results
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

/**
 * Detect if tool result content indicates an error
 */
function detectToolResultError(textContent: string): boolean {
  const lowerContent = textContent.toLowerCase();
  return (
    lowerContent.startsWith("error") ||
    lowerContent.startsWith("error while calling tool:") ||
    lowerContent.includes("error while calling tool:") ||
    lowerContent.includes("invalid terminal id") ||
    lowerContent.includes("please check your input")
  );
}

/**
 * Extract text content from tool result
 */
function extractToolResultText(content: unknown): string {
  let textContent = "";
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item instanceof vscode.LanguageModelTextPart) {
        textContent += item.value;
      } else if (typeof item === "string") {
        textContent += item;
      } else {
        // For unknown types, try to stringify
        textContent += inspect(item, { depth: 4 });
      }
    }
  } else if (typeof content === "string") {
    textContent = content;
  } else {
    textContent = inspect(content);
  }
  return textContent;
}

/**
 * Common helper to filter content blocks from messages.
 * Reduces code duplication between stripThinkingContent and filterDeepseekReasoningContent.
 *
 * @param messages The messages to filter (will be modified in place)
 * @param predicate Function that returns true to KEEP a block, false to remove it
 * @param logContext Description for logging purposes
 * @returns The same messages array with filtered content
 */
function filterContentBlocks(
  messages: BedrockMessage[],
  predicate: (block: ContentBlock) => boolean,
  logContext: string,
): BedrockMessage[] {
  let filteredCount = 0;

  for (const message of messages) {
    if (message.content) {
      const originalLength = message.content.length;
      message.content = message.content.filter((block) => {
        if (!predicate(block)) {
          filteredCount++;
          return false;
        }
        return true;
      });

      if (message.content.length === 0 && originalLength > 0) {
        logger.trace(
          `[Message Converter] Message became empty after ${logContext}, will be removed`,
        );
      }
    }
  }

  // Remove empty messages
  const messagesBeforeFilter = messages.length;
  messages.splice(
    0,
    messages.length,
    ...messages.filter((msg) => msg.content && msg.content.length > 0),
  );

  if (filteredCount > 0) {
    logger.trace(`[Message Converter] ${logContext}`, {
      blocksFiltered: filteredCount,
      emptyMessagesRemoved: messagesBeforeFilter - messages.length,
    });
  }

  return messages;
}

/**
 * Filter out reasoning content for Deepseek models
 */
function filterDeepseekReasoningContent(bedrockMessages: BedrockMessage[], modelId: string): void {
  const isDeepseekModel = modelId.toLowerCase().includes("deepseek");
  if (!isDeepseekModel) return;

  filterContentBlocks(
    bedrockMessages,
    (block) => !("reasoningContent" in block),
    "Filtered reasoningContent for Deepseek model",
  );
}

/**
 * Inject extended thinking blocks into assistant messages
 */
function injectExtendedThinking(
  bedrockMessages: BedrockMessage[],
  thinkingBlock: ThinkingBlock,
): void {
  if (!thinkingBlock.signature) {
    logger.warn(
      "[Message Converter] Cannot inject thinking block - signature required for interleaved thinking",
      {
        capturedFromDeltas: true,
        textLength: thinkingBlock.text.length,
      },
    );
    return;
  }

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
        const reasoningBlock: ContentBlock.ReasoningContentMember = {
          reasoningContent: {
            reasoningText: {
              signature: thinkingBlock.signature,
              text: thinkingBlock.text,
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
      signatureLength: thinkingBlock.signature.length,
      textLength: thinkingBlock.text.length,
    });
  }
}

/**
 * Check if a part is an image data part
 */
function isImageDataPart(part: unknown): part is ImageDataPart {
  if (
    typeof part === "object" &&
    part != null &&
    "mimeType" in part &&
    typeof part.mimeType === "string" &&
    "data" in part &&
    types.isUint8Array(part.data)
  ) {
    // Verify it's an actual image MIME type, not metadata like "cache_control"
    try {
      const mime = new MIMEType(part.mimeType);
      return mime.type === "image";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Merge content into last message or append new message
 */
function mergeOrAppendMessage(
  messages: BedrockMessage[],
  content: ContentBlock[],
  role: ConversationRole,
  hasToolResults: boolean,
  userMessageIndicesWithToolResults: number[],
): void {
  if (content.length === 0) return;

  const lastMessage = messages.at(-1);
  if (lastMessage?.role === role && lastMessage.content !== undefined) {
    // Merge content into the last message
    logger.debug(`[Message Converter] Merging consecutive ${role} messages`);
    lastMessage.content.push(...content);

    // Update hasToolResults tracking for merged message (only for user messages)
    if (role === ConversationRole.USER && hasToolResults) {
      const lastIndex = messages.length - 1;
      if (!userMessageIndicesWithToolResults.includes(lastIndex)) {
        userMessageIndicesWithToolResults.push(lastIndex);
      }
    }
  } else {
    // Append new message
    messages.push({ content, role });

    // Track tool results (only for user messages)
    if (role === ConversationRole.USER && hasToolResults) {
      userMessageIndicesWithToolResults.push(messages.length - 1);
    }
  }
}

/**
 * Process all parts of an assistant message
 */
function processAssistantMessageParts(msg: vscode.LanguageModelChatMessage): ContentBlock[] {
  const content: ContentBlock[] = [];

  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      const block = processTextPart(part);
      if (block) content.push(block);
    } else if (isImageDataPart(part)) {
      const block = processImagePart(part, ConversationRole.ASSISTANT);
      if (block) content.push(block);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      content.push(processToolCallPart(part));
    }
  }

  return content;
}

/**
 * Process image data part from message content
 */
function processImagePart(part: ImageDataPart, role: ConversationRole): ContentBlock | null {
  try {
    const mime = new MIMEType(part.mimeType);
    if (mime.type === "image") {
      const format = mime.subtype.toLowerCase();
      if (format === "png" || format === "jpeg" || format === "gif" || format === "webp") {
        logger.debug(`[Message Converter] Added image block to ${role} message`, { format });
        return {
          image: {
            format,
            source: {
              bytes: part.data,
            },
          },
        } satisfies ContentBlock.ImageMember;
      } else {
        logger.warn(`[Message Converter] Unsupported image format in ${role} message`, { format });
      }
    }
  } catch (error) {
    logger.warn(`[Message Converter] Invalid MIME type in ${role} message`, {
      error: error instanceof Error ? error.message : inspect(error),
      mimeType: part.mimeType,
    });
  }
  return null;
}

/**
 * Process all parts of a system message
 */
function processSystemMessageParts(msg: vscode.LanguageModelChatMessage): SystemContentBlock[] {
  const systemBlocks: SystemContentBlock[] = [];

  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart && part.value.trim()) {
      systemBlocks.push({ text: part.value });
    }
  }

  return systemBlocks;
}

/**
 * Process text part from message content
 */
function processTextPart(part: vscode.LanguageModelTextPart): ContentBlock | null {
  // Skip empty text parts - Bedrock API rejects blank text fields
  if (!part.value.trim()) {
    return null;
  }
  return { text: part.value };
}

/**
 * Process tool call part from assistant message content
 */
function processToolCallPart(part: vscode.LanguageModelToolCallPart): ContentBlock {
  return {
    toolUse: {
      input: part.input as DocumentType,
      name: part.name,
      toolUseId: part.callId,
    },
  };
}

/**
 * Process tool result part from user message content
 */
function processToolResultPart(
  part: vscode.LanguageModelToolResultPart,
  profile: ModelProfile,
): ContentBlock {
  const textContent = extractToolResultText(part.content);

  // Log diagnostics without leaking content
  logger.debug("[Message Converter] Processing VSCode tool result:", {
    callId: part.callId,
    contentType: typeof part.content,
    hasIsError: "isError" in part,
    isArray: Array.isArray(part.content),
    textLength: textContent.length,
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

  // Detect errors from explicit flag (when present) or content
  const explicitIsError =
    "isError" in part ? Boolean((part as Record<string, unknown>).isError) : false;
  const isLikelyError = explicitIsError || detectToolResultError(textContent);
  const status = profile.supportsToolResultStatus && isLikelyError ? "error" : undefined;

  logger.debug("[Message Converter] Error status decision:", {
    contentLength: textContent.length,
    detectedFromContent: !explicitIsError && isLikelyError,
    explicitIsError,
    hasIsErrorProperty: "isError" in part,
    modelSupportsStatus: profile.supportsToolResultStatus,
    resultingStatus: status,
  });

  logger.debug("[Message Converter] Created Bedrock tool result:", {
    format: isJson ? "json" : "text",
    hasContent: true,
    status,
    toolUseId: part.callId,
  });

  return {
    toolResult: {
      content: [contentBlock],
      toolUseId: part.callId,
      ...(status ? { status } : {}),
    },
  } satisfies ContentBlock.ToolResultMember;
}

/**
 * Process all parts of a user message
 */
function processUserMessageParts(
  msg: vscode.LanguageModelChatMessage,
  profile: ModelProfile,
): { content: ContentBlock[]; hasToolResults: boolean } {
  const content: ContentBlock[] = [];
  let hasToolResults = false;

  for (const part of msg.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      const block = processTextPart(part);
      if (block) content.push(block);
    } else if (isImageDataPart(part)) {
      const block = processImagePart(part, ConversationRole.USER);
      if (block) content.push(block);
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      hasToolResults = true;
      content.push(processToolResultPart(part, profile));
    }
  }

  return { content, hasToolResults };
}
