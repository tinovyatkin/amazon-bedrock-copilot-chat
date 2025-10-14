import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import * as vscode from "vscode";
import { CancellationToken, LanguageModelResponsePart, Progress } from "vscode";

import { logger } from "./logger";
import { ToolBuffer } from "./tool-buffer";

export class StreamProcessor {
  async processStream(
    stream: AsyncIterable<ConverseStreamOutput>,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const toolBuffer = new ToolBuffer();
    let hasEmittedContent = false;
    let toolCallCount = 0;
    let textChunkCount = 0;

    // Clear any previous state from the buffer
    toolBuffer.clear();
    logger.log("[Stream Processor] Starting stream processing");

    try {
      for await (const event of stream) {
        if (token.isCancellationRequested) {
          logger.log("[Stream Processor] Cancellation requested");
          break;
        }

        if (event.messageStart) {
          logger.log("[Stream Processor] Message start:", event.messageStart.role);
        } else if (event.contentBlockStart) {
          const start = event.contentBlockStart;
          logger.log("[Stream Processor] Content block start:", {
            hasToolUse: !!start.start?.toolUse,
            index: start.contentBlockIndex,
          });
          const toolUse = start.start?.toolUse;
          if (toolUse?.toolUseId && toolUse.name && start.contentBlockIndex) {
            toolBuffer.startTool(start.contentBlockIndex, toolUse.toolUseId, toolUse.name);
            logger.log("[Stream Processor] Tool call started:", {
              id: toolUse.toolUseId,
              name: toolUse.name,
            });
          }
        } else if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta;
          if (delta.delta?.text) {
            textChunkCount++;
            logger.log("[Stream Processor] Text delta received, length:", delta.delta.text.length);
            progress.report(new vscode.LanguageModelTextPart(delta.delta.text));
            hasEmittedContent = true;
          } else if (delta.delta?.reasoningContent?.text) {
            textChunkCount++;
            logger.log(
              "[Stream Processor] Reasoning content delta received, length:",
              delta.delta.reasoningContent.text.length,
            );
            progress.report(new vscode.LanguageModelTextPart(delta.delta.reasoningContent.text));
            hasEmittedContent = true;
          } else if (delta.delta?.toolUse && delta.contentBlockIndex && delta.delta.toolUse.input) {
            logger.log(
              "[Stream Processor] Tool use delta received for block:",
              delta.contentBlockIndex,
            );
            toolBuffer.appendInput(delta.contentBlockIndex, delta.delta.toolUse.input);

            // Try early emission - emit as soon as JSON is valid for better perceived performance
            // This is inspired by HuggingFace's approach
            if (!toolBuffer.isEmitted(delta.contentBlockIndex)) {
              const validTool = toolBuffer.tryGetValidTool(delta.contentBlockIndex);
              if (validTool) {
                toolCallCount++;
                logger.log("[Stream Processor] Tool call emitted early (valid JSON):", {
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
            logger.log("[Stream Processor] Unknown delta type:", Object.keys(delta.delta || {}));
          }
        } else if (event.contentBlockStop) {
          const stop = event.contentBlockStop;
          logger.log("[Stream Processor] Content block stop, index:", stop.contentBlockIndex);

          // Only finalize if we haven't already emitted this tool call
          if (!toolBuffer.isEmitted(stop.contentBlockIndex!)) {
            const tool = toolBuffer.finalizeTool(stop.contentBlockIndex!);
            if (tool?.input) {
              toolCallCount++;
              logger.log("[Stream Processor] Tool call finalized at stop:", {
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
            logger.log("[Stream Processor] Tool call already emitted, skipping duplicate");
          }
        } else if (event.messageStop) {
          logger.log("[Stream Processor] Message stop event received", {
            stopReason: event.messageStop.stopReason,
          });
        } else if (event.metadata) {
          logger.log("[Stream Processor] Metadata received:", event.metadata);
        } else {
          logger.log("[Stream Processor] Unknown event type:", Object.keys(event));
        }
      }

      logger.log("[Stream Processor] Stream processing completed", {
        hasEmittedContent,
        textChunkCount,
        toolCallCount,
      });
    } catch (error) {
      logger.error("[Stream Processor] Error during stream processing:", error);
      throw error;
    }
  }
}
