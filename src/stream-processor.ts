import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import * as vscode from "vscode";
import { CancellationToken, LanguageModelResponsePart, Progress } from "vscode";

import { logger } from "./logger";
import { ToolBuffer } from "./tool-buffer";

export interface StreamProcessingResult {
  thinkingBlock?: ThinkingBlock;
}

export interface ThinkingBlock {
  signature?: string;
  text: string;
}

export class StreamProcessor {
  async processStream(
    stream: AsyncIterable<ConverseStreamOutput>,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<StreamProcessingResult> {
    const toolBuffer = new ToolBuffer();
    let hasEmittedContent = false;
    let toolCallCount = 0;
    let textChunkCount = 0;
    let stopReason: string | undefined;
    let capturedThinkingBlock: ThinkingBlock | undefined;

    // Clear any previous state from the buffer
    toolBuffer.clear();
    logger.info("[Stream Processor] Starting stream processing");

    try {
      for await (const event of stream) {
        if (token.isCancellationRequested) {
          logger.info("[Stream Processor] Cancellation requested");
          break;
        }

        if (event.messageStart) {
          logger.info("[Stream Processor] Message start:", event.messageStart.role);
        } else if (event.contentBlockStart) {
          const start = event.contentBlockStart;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          const startData = start.start as any;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const hasThinking = startData && "thinking" in startData;

          logger.debug("[Stream Processor] Content block start:", {
            hasThinking,
            hasToolUse: !!start.start?.toolUse,
            index: start.contentBlockIndex,
          });
          const toolUse = start.start?.toolUse;
          if (toolUse?.toolUseId && toolUse.name && start.contentBlockIndex) {
            toolBuffer.startTool(start.contentBlockIndex, toolUse.toolUseId, toolUse.name);
            logger.debug("[Stream Processor] Tool call started:", {
              id: toolUse.toolUseId,
              name: toolUse.name,
            });
          }
          // Capture thinking block with signature if present
          if (hasThinking) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const thinkingData = startData.thinking;

            const signature =
              typeof thinkingData === "object" && thinkingData && "signature" in thinkingData
                ? String(thinkingData.signature)
                : undefined;

            capturedThinkingBlock = { signature, text: "" };
            logger.debug("[Stream Processor] Thinking block started, capturing with signature:", {
              hasSignature: !!signature,
            });
          }
        } else if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta;

          // Handle text deltas (check for key existence, not just truthy value)
          if ("text" in (delta.delta || {})) {
            const text = delta.delta?.text;
            if (text) {
              textChunkCount++;
              logger.trace("[Stream Processor] Text delta received, length:", text.length);
              progress.report(new vscode.LanguageModelTextPart(text));
              hasEmittedContent = true;
            } else {
              logger.trace("[Stream Processor] Text delta with empty content (initialization)");
            }
          }
          // Handle reasoning content deltas
          // Note: We don't emit reasoning/thinking content as it interferes with tool call display
          // and differs from native Copilot behavior with OpenAI models
          else if ("reasoningContent" in (delta.delta || {})) {
            const reasoningText = delta.delta?.reasoningContent?.text;
            const reasoningSignature = delta.delta?.reasoningContent?.signature;

            if (reasoningText) {
              logger.trace(
                "[Stream Processor] Reasoning content delta received (capturing), length:",
                reasoningText.length,
              );
              // Accumulate reasoning text into thinking block
              if (!capturedThinkingBlock) {
                capturedThinkingBlock = { text: "" };
              }
              capturedThinkingBlock.text += reasoningText;
            }

            // Capture signature from reasoning content delta
            if (reasoningSignature && typeof reasoningSignature === "string") {
              if (!capturedThinkingBlock) {
                capturedThinkingBlock = { text: "" };
              }
              capturedThinkingBlock.signature =
                (capturedThinkingBlock.signature || "") + reasoningSignature;
              logger.trace(
                "[Stream Processor] Reasoning signature delta received, total length:",
                capturedThinkingBlock.signature.length,
              );
            }

            if (!reasoningText && !reasoningSignature) {
              logger.trace(
                "[Stream Processor] Reasoning content delta with empty content (initialization)",
              );
            }
          }
          // Handle thinking content deltas (extended thinking from Claude models)
          else if ("thinking" in (delta.delta || {})) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            const deltaData = delta.delta as any;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const thinkingObj = deltaData?.thinking;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const thinkingText =
              thinkingObj && typeof thinkingObj === "object" && "text" in thinkingObj
                ? thinkingObj.text
                : undefined;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const signatureDelta =
              thinkingObj && typeof thinkingObj === "object" && "signature_delta" in thinkingObj
                ? thinkingObj.signature_delta
                : undefined;

            if (thinkingText && typeof thinkingText === "string") {
              logger.trace(
                "[Stream Processor] Thinking content delta received (capturing), length:",
                thinkingText.length,
              );
              // Accumulate thinking text
              if (capturedThinkingBlock) {
                capturedThinkingBlock.text += thinkingText;
              }
            } else {
              logger.trace(
                "[Stream Processor] Thinking content delta with empty text (initialization)",
              );
            }

            // Capture signature deltas (streamed incrementally)
            if (signatureDelta && typeof signatureDelta === "string") {
              if (capturedThinkingBlock) {
                capturedThinkingBlock.signature =
                  (capturedThinkingBlock.signature || "") + signatureDelta;
                logger.trace(
                  "[Stream Processor] Signature delta received, total length:",
                  capturedThinkingBlock.signature.length,
                );
              }
            }
          }
          // Handle tool use deltas
          else if ("toolUse" in (delta.delta || {})) {
            const toolUse = delta.delta?.toolUse;
            if (delta.contentBlockIndex && toolUse?.input) {
              logger.trace(
                "[Stream Processor] Tool use delta received for block:",
                delta.contentBlockIndex,
              );
              toolBuffer.appendInput(delta.contentBlockIndex, toolUse.input);

              // Try early emission - emit as soon as JSON is valid for better perceived performance
              // This is inspired by HuggingFace's approach
              if (!toolBuffer.isEmitted(delta.contentBlockIndex)) {
                const validTool = toolBuffer.tryGetValidTool(delta.contentBlockIndex);
                if (validTool) {
                  toolCallCount++;
                  logger.debug("[Stream Processor] Tool call emitted early (valid JSON):", {
                    id: validTool.id,
                    input: validTool.input,
                    name: validTool.name,
                  });
                  progress.report(
                    new vscode.LanguageModelToolCallPart(
                      validTool.id,
                      validTool.name,
                      validTool.input as object,
                    ),
                  );
                  toolBuffer.markEmitted(delta.contentBlockIndex);
                  hasEmittedContent = true;
                }
              }
            } else {
              logger.trace(
                "[Stream Processor] Tool use delta without input or index (initialization)",
              );
            }
          }
          // Truly unknown delta types
          else {
            logger.trace("[Stream Processor] Unknown delta type:", Object.keys(delta.delta || {}));
          }
        } else if (event.contentBlockStop) {
          const stop = event.contentBlockStop;
          logger.info("[Stream Processor] Content block stop, index:", stop.contentBlockIndex);

          // Only finalize if we haven't already emitted this tool call
          if (!toolBuffer.isEmitted(stop.contentBlockIndex!)) {
            const tool = toolBuffer.finalizeTool(stop.contentBlockIndex!);
            if (tool?.input) {
              toolCallCount++;
              logger.debug("[Stream Processor] Tool call finalized at stop:", {
                id: tool.id,
                input: tool.input,
                name: tool.name,
              });
              progress.report(
                new vscode.LanguageModelToolCallPart(tool.id, tool.name, tool.input as object),
              );
              toolBuffer.markEmitted(stop.contentBlockIndex!);
              hasEmittedContent = true;
            }
          } else {
            logger.debug("[Stream Processor] Tool call already emitted, skipping duplicate");
          }
        } else if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
          logger.info("[Stream Processor] Message stop event received", {
            stopReason,
          });
        } else if (event.metadata) {
          logger.info("[Stream Processor] Metadata received:", event.metadata);

          // Extract thinking blocks from metadata for extended thinking
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const metadata = event.metadata as any;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (metadata?.additionalModelResponseFields?.thinkingResponse) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const thinkingResponse = metadata.additionalModelResponseFields.thinkingResponse;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (thinkingResponse.reasoning && Array.isArray(thinkingResponse.reasoning)) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              for (const reasoningBlock of thinkingResponse.reasoning) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                if (reasoningBlock.text) {
                  if (!capturedThinkingBlock) {
                    capturedThinkingBlock = { text: "" };
                  }
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  capturedThinkingBlock.text += reasoningBlock.text;
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  if (reasoningBlock.signature && !capturedThinkingBlock.signature) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    capturedThinkingBlock.signature = reasoningBlock.signature;
                  }
                }
              }
              logger.debug("[Stream Processor] Captured thinking blocks from metadata:", {
                blockCount: thinkingResponse.reasoning.length,
                hasSignature: !!capturedThinkingBlock?.signature,
                textLength: capturedThinkingBlock?.text.length,
              });
            }
          }
        } else {
          logger.info("[Stream Processor] Unknown event type:", Object.keys(event));
        }
      }

      logger.info("[Stream Processor] Stream processing completed", {
        capturedThinkingBlock: !!capturedThinkingBlock,
        hasEmittedContent,
        stopReason,
        textChunkCount,
        thinkingLength: capturedThinkingBlock?.text.length,
        toolCallCount,
      });

      // Handle cases where no content was emitted
      if (!hasEmittedContent) {
        if (stopReason === "max_tokens") {
          throw new Error(
            "The model reached its maximum token limit while generating internal reasoning. Try reducing the conversation history or adjusting model parameters.",
          );
        } else if (stopReason === "content_filtered") {
          throw new Error(
            "The response was filtered due to content policy. Please rephrase your request.",
          );
        } else if (!token.isCancellationRequested) {
          // Only throw if not cancelled by user
          throw new Error(
            `No response content was generated. ${stopReason ? `Stop reason: ${stopReason}` : "Please try rephrasing your request."}`,
          );
        }
      }

      return { thinkingBlock: capturedThinkingBlock };
    } catch (error) {
      logger.error("[Stream Processor] Error during stream processing:", error);
      throw error;
    }
  }
}
