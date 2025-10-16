import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { StopReason } from "@aws-sdk/client-bedrock-runtime";
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
    let hasToolUse = false; // Track tool use to fix incorrect stop reasons

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
            hasToolUse = true; // Track that we have tool use in this response
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

          // Fix incorrect stop reason: Some Bedrock models report "end_turn" when they actually made tool calls
          // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L815-L825
          if (hasToolUse && stopReason === StopReason.END_TURN) {
            logger.warn(
              "[Stream Processor] Correcting stop reason from END_TURN to TOOL_USE (model incorrectly reported end_turn)",
            );
            stopReason = StopReason.TOOL_USE;
          }

          logger.info("[Stream Processor] Message stop event received", {
            stopReason,
          });
        } else if (event.metadata) {
          logger.info("[Stream Processor] Metadata received:", event.metadata);

          // Check for guardrail traces in metadata
          // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L806-L812
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const metadata = event.metadata as any;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (metadata?.trace?.guardrail) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const guardrailData = metadata.trace.guardrail;
            logger.debug("[Stream Processor] Guardrail trace detected in metadata:", {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              guardrailData,
            });

            // Check if guardrail is blocking
            if (
              typeof guardrailData === "object" &&
              guardrailData !== null &&
              hasBlockedGuardrail(guardrailData as Record<string, unknown>)
            ) {
              logger.error(
                "[Stream Processor] ⚠️ GUARDRAIL BLOCKED - Content was blocked by AWS Bedrock Guardrails",
                {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  guardrailData,
                  message:
                    "This could be due to account-level or organization-level guardrail policies. " +
                    "Check your AWS Bedrock Guardrails configuration or contact your AWS administrator.",
                },
              );

              // Note: We don't throw here because the API will still return the response
              // The guardrail might have allowed partial content through
            }
          }

          // Extract thinking blocks from metadata for extended thinking
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
        hasSignature: !!capturedThinkingBlock?.signature,
        signatureLength: capturedThinkingBlock?.signature?.length,
        stopReason,
        textChunkCount,
        thinkingLength: capturedThinkingBlock?.text.length,
        toolCallCount,
      });

      // Handle content filtering - ALWAYS throw error when content is filtered
      // This can happen even if some content was already emitted (partial response before filtering)
      // Note: CONTENT_FILTERED includes both Anthropic's built-in safety filtering (Claude 4.5's AI Safety Level 3)
      // and any explicit AWS Bedrock Guardrails if configured
      if (stopReason === StopReason.CONTENT_FILTERED) {
        const message = hasEmittedContent
          ? "The response was filtered mid-generation by content safety policies. Some content may have been displayed before filtering. This may be due to Anthropic Claude's built-in safety filtering (common with Claude 4.5) or AWS Bedrock Guardrails. Please rephrase your request."
          : "The response was filtered by content safety policies before any content was generated. This may be due to Anthropic Claude's built-in safety filtering or AWS Bedrock Guardrails. Please rephrase your request.";
        throw new Error(message);
      }

      // Handle explicit AWS Bedrock Guardrail intervention
      // This is different from CONTENT_FILTERED which can be model's built-in filtering
      if (stopReason === StopReason.GUARDRAIL_INTERVENED) {
        const message = hasEmittedContent
          ? "AWS Bedrock Guardrails blocked the response mid-generation. Some content may have been displayed before intervention. Please check your guardrail configuration or rephrase your request."
          : "AWS Bedrock Guardrails blocked the response before any content was generated. Please check your guardrail configuration or rephrase your request.";
        throw new Error(message);
      }

      // Handle context window overflow
      if (stopReason === StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED) {
        throw new Error(
          "The model's context window was exceeded. Try reducing the conversation history, removing tool results, or adjusting model parameters.",
        );
      }

      // Handle cases where no content was emitted (excluding filtering/guardrails which are handled above)
      if (!hasEmittedContent) {
        if (stopReason === StopReason.MAX_TOKENS) {
          throw new Error(
            "The model reached its maximum token limit while generating internal reasoning. Try reducing the conversation history or adjusting model parameters.",
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

/**
 * Recursively checks if an assessment contains a detected and blocked guardrail policy
 * Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L950-L977
 */
function findDetectedAndBlockedPolicy(input: unknown): boolean {
  // Check if input is a dictionary/object
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    // Check if current object has action: BLOCKED and detected: true
    if (obj.action === "BLOCKED" && obj.detected === true) {
      return true;
    }

    // Recursively check all values in the object
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        if (findDetectedAndBlockedPolicy(value)) {
          return true;
        }
      }
    }
  } else if (Array.isArray(input)) {
    // Handle case where input is an array
    for (const item of input) {
      if (findDetectedAndBlockedPolicy(item)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if guardrail data contains any blocked policies
 * Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L637-L650
 */
function hasBlockedGuardrail(guardrailData: Record<string, unknown>): boolean {
  const inputAssessment = guardrailData.inputAssessment as Record<string, unknown> | undefined;
  const outputAssessments = guardrailData.outputAssessments as Record<string, unknown> | undefined;

  // Check input assessments
  if (inputAssessment) {
    for (const assessment of Object.values(inputAssessment)) {
      if (findDetectedAndBlockedPolicy(assessment)) {
        return true;
      }
    }
  }

  // Check output assessments
  if (outputAssessments) {
    for (const assessment of Object.values(outputAssessments)) {
      if (findDetectedAndBlockedPolicy(assessment)) {
        return true;
      }
    }
  }

  return false;
}
