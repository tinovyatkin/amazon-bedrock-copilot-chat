import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { StopReason } from "@aws-sdk/client-bedrock-runtime";
import * as vscode from "vscode";
import { type CancellationToken, type LanguageModelResponsePart, type Progress } from "vscode";

import { logger } from "./logger";
import { ToolBuffer } from "./tool-buffer";

export interface StreamProcessingResult {
  thinkingBlock?: ThinkingBlock;
}

export interface ThinkingBlock {
  signature?: string;
  text: string;
}

interface ProcessingState {
  capturedThinkingBlock: ThinkingBlock | undefined;
  hasEmittedContent: boolean;
  hasToolUse: boolean;
  stopReason: string | undefined;
  textChunkCount: number;
  toolBuffer: ToolBuffer;
  toolCallCount: number;
}

export class StreamProcessor {
  async processStream(
    stream: AsyncIterable<ConverseStreamOutput>,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<StreamProcessingResult> {
    const state: ProcessingState = {
      capturedThinkingBlock: undefined,
      hasEmittedContent: false,
      hasToolUse: false,
      stopReason: undefined,
      textChunkCount: 0,
      toolBuffer: new ToolBuffer(),
      toolCallCount: 0,
    };

    state.toolBuffer.clear();
    logger.info("[Stream Processor] Starting stream processing");

    try {
      for await (const event of stream) {
        if (token.isCancellationRequested) {
          logger.info("[Stream Processor] Cancellation requested");
          break;
        }

        this.handleEvent(event, progress, state);
      }

      this.logCompletion(state);
      this.validateStreamResult(state, token);

      return { thinkingBlock: state.capturedThinkingBlock };
    } catch (error) {
      logger.error("[Stream Processor] Error during stream processing:", error);
      throw error;
    }
  }

  private handleContentBlockDelta(
    delta: NonNullable<ConverseStreamOutput["contentBlockDelta"]>,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    if ("text" in (delta.delta ?? {})) {
      this.handleTextDelta(delta.delta?.text, progress, state);
    } else if ("reasoningContent" in (delta.delta ?? {})) {
      this.handleReasoningDelta(delta.delta?.reasoningContent, state);
    } else if ("toolUse" in (delta.delta ?? {})) {
      this.handleToolUseDelta(delta, progress, state);
    } else {
      logger.trace("[Stream Processor] Unknown delta type:", Object.keys(delta.delta ?? {}));
    }
  }

  private handleContentBlockStart(
    start: NonNullable<ConverseStreamOutput["contentBlockStart"]>,
    state: ProcessingState,
  ): void {
    const startData = start.start;
    const hasThinking = !!(startData && "thinking" in startData);

    logger.debug("[Stream Processor] Content block start:", {
      hasThinking,
      hasToolUse: !!start.start?.toolUse,
      index: start.contentBlockIndex,
    });

    this.handleToolStart(start, state);
    if (startData && hasThinking) {
      this.handleThinkingStart(startData, state);
    }
  }

  private handleContentBlockStop(
    stop: NonNullable<ConverseStreamOutput["contentBlockStop"]>,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    logger.info("[Stream Processor] Content block stop, index:", stop.contentBlockIndex);

    if (state.toolBuffer.isEmitted(stop.contentBlockIndex!)) {
      logger.debug("[Stream Processor] Tool call already emitted, skipping duplicate");
      return;
    }

    const tool = state.toolBuffer.finalizeTool(stop.contentBlockIndex!);
    if (!tool?.input) {
      return;
    }

    state.toolCallCount++;
    logger.debug("[Stream Processor] Tool call finalized at stop:", {
      id: tool.id,
      input: tool.input,
      name: tool.name,
    });
    progress.report(new vscode.LanguageModelToolCallPart(tool.id, tool.name, tool.input as object));
    state.toolBuffer.markEmitted(stop.contentBlockIndex!);
    state.hasEmittedContent = true;
  }

  private handleEvent(
    event: ConverseStreamOutput,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    if (event.messageStart) {
      this.handleMessageStart(event.messageStart);
    } else if (event.contentBlockStart) {
      this.handleContentBlockStart(event.contentBlockStart, state);
    } else if (event.contentBlockDelta) {
      this.handleContentBlockDelta(event.contentBlockDelta, progress, state);
    } else if (event.contentBlockStop) {
      this.handleContentBlockStop(event.contentBlockStop, progress, state);
    } else if (event.messageStop) {
      this.handleMessageStop(event.messageStop, state);
    } else if (event.metadata) {
      this.handleMetadata(event.metadata);
    } else {
      logger.info("[Stream Processor] Unknown event type:", Object.keys(event));
    }
  }

  private handleMessageStart(
    messageStart: NonNullable<ConverseStreamOutput["messageStart"]>,
  ): void {
    logger.info("[Stream Processor] Message start:", messageStart.role);
  }

  private handleMessageStop(
    messageStop: NonNullable<ConverseStreamOutput["messageStop"]>,
    state: ProcessingState,
  ): void {
    state.stopReason = messageStop.stopReason;

    // Fix incorrect stop reason: Some Bedrock models report "end_turn" when they actually made tool calls
    // Reference: https://github.com/strands-agents/sdk-python/blob/dbf6200d104539217dddfc7bd729c53f46e2ec56/src/strands/models/bedrock.py#L815-L825
    if (state.hasToolUse && state.stopReason === StopReason.END_TURN) {
      logger.warn(
        "[Stream Processor] Correcting stop reason from END_TURN to TOOL_USE (model incorrectly reported end_turn)",
      );
      state.stopReason = StopReason.TOOL_USE;
    }

    logger.info("[Stream Processor] Message stop event received", {
      stopReason: state.stopReason,
    });
  }

  private handleMetadata(metadata: NonNullable<ConverseStreamOutput["metadata"]>): void {
    logger.info("[Stream Processor] Metadata received:", metadata);

    const guardrailData = metadata?.trace?.guardrail;
    if (!guardrailData) {
      return;
    }

    logger.debug("[Stream Processor] Guardrail trace detected in metadata:", {
      guardrailData,
    });

    if (
      typeof guardrailData === "object" &&
      guardrailData != null &&
      hasBlockedGuardrail(guardrailData as Record<string, unknown>)
    ) {
      logger.error(
        "[Stream Processor] ⚠️ GUARDRAIL BLOCKED - Content was blocked by AWS Bedrock Guardrails",
        {
          guardrailData,
          message:
            "This could be due to account-level or organization-level guardrail policies. " +
            "Check your AWS Bedrock Guardrails configuration or contact your AWS administrator.",
        },
      );
    }
  }

  private handleReasoningDelta(
    reasoningContent: undefined | { signature?: string; text?: string },
    state: ProcessingState,
  ): void {
    const reasoningText = reasoningContent?.text;
    const reasoningSignature = reasoningContent?.signature;

    if (reasoningText) {
      logger.trace(
        "[Stream Processor] Reasoning content delta received (capturing), length:",
        reasoningText.length,
      );
      state.capturedThinkingBlock ??= { text: "" };
      state.capturedThinkingBlock.text += reasoningText;
    }

    if (reasoningSignature && typeof reasoningSignature === "string") {
      state.capturedThinkingBlock ??= { text: "" };
      state.capturedThinkingBlock.signature =
        (state.capturedThinkingBlock.signature ?? "") + reasoningSignature;
      logger.trace(
        "[Stream Processor] Reasoning signature delta received, total length:",
        state.capturedThinkingBlock.signature.length,
      );
    }

    if (!reasoningText && !reasoningSignature) {
      logger.trace(
        "[Stream Processor] Reasoning content delta with empty content (initialization)",
      );
    }
  }

  private handleTextDelta(
    text: string | undefined,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    if (text) {
      state.textChunkCount++;
      logger.trace("[Stream Processor] Text delta received, length:", text.length);
      progress.report(new vscode.LanguageModelTextPart(text));
      state.hasEmittedContent = true;
    } else {
      logger.trace("[Stream Processor] Text delta with empty content (initialization)");
    }
  }

  private handleThinkingStart(
    startData: NonNullable<ConverseStreamOutput["contentBlockStart"]>["start"],
    state: ProcessingState,
  ): void {
    // startData is guaranteed to exist and have "thinking" property by the caller
    const thinkingData = (startData as { thinking?: unknown }).thinking;
    const signature =
      typeof thinkingData === "object" && thinkingData && "signature" in thinkingData
        ? String((thinkingData as { signature: unknown }).signature)
        : undefined;

    state.capturedThinkingBlock = { signature, text: "" };
    logger.debug("[Stream Processor] Thinking block started, capturing with signature:", {
      hasSignature: !!signature,
    });
  }

  private handleToolStart(
    start: NonNullable<ConverseStreamOutput["contentBlockStart"]>,
    state: ProcessingState,
  ): void {
    const toolUse = start.start?.toolUse;
    if (toolUse?.toolUseId && toolUse.name && start.contentBlockIndex !== undefined) {
      state.hasToolUse = true;
      state.toolBuffer.startTool(start.contentBlockIndex, toolUse.toolUseId, toolUse.name);
      logger.debug("[Stream Processor] Tool call started:", {
        id: toolUse.toolUseId,
        name: toolUse.name,
      });
    }
  }

  private handleToolUseDelta(
    delta: NonNullable<ConverseStreamOutput["contentBlockDelta"]>,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    const toolUse = delta.delta?.toolUse;
    if (delta.contentBlockIndex === undefined || !toolUse?.input) {
      logger.trace("[Stream Processor] Tool use delta without input or index (initialization)");
      return;
    }

    logger.trace("[Stream Processor] Tool use delta received for block:", delta.contentBlockIndex);
    state.toolBuffer.appendInput(delta.contentBlockIndex, toolUse.input);

    this.tryEarlyToolEmission(delta.contentBlockIndex, progress, state);
  }

  private logCompletion(state: ProcessingState): void {
    logger.info("[Stream Processor] Stream processing completed", {
      capturedThinkingBlock: !!state.capturedThinkingBlock,
      hasEmittedContent: state.hasEmittedContent,
      hasSignature: !!state.capturedThinkingBlock?.signature,
      signatureLength: state.capturedThinkingBlock?.signature?.length,
      stopReason: state.stopReason,
      textChunkCount: state.textChunkCount,
      thinkingLength: state.capturedThinkingBlock?.text.length,
      toolCallCount: state.toolCallCount,
    });
  }

  private tryEarlyToolEmission(
    contentBlockIndex: number,
    progress: Progress<LanguageModelResponsePart>,
    state: ProcessingState,
  ): void {
    if (state.toolBuffer.isEmitted(contentBlockIndex)) {
      return;
    }

    const validTool = state.toolBuffer.tryGetValidTool(contentBlockIndex);
    if (!validTool) {
      return;
    }

    state.toolCallCount++;
    logger.debug("[Stream Processor] Tool call emitted early (valid JSON):", {
      id: validTool.id,
      input: validTool.input,
      name: validTool.name,
    });
    progress.report(
      new vscode.LanguageModelToolCallPart(validTool.id, validTool.name, validTool.input as object),
    );
    state.toolBuffer.markEmitted(contentBlockIndex);
    state.hasEmittedContent = true;
  }

  private validateContentEmission(state: ProcessingState, token: CancellationToken): void {
    if (state.hasEmittedContent) {
      return;
    }

    if (state.stopReason === StopReason.MAX_TOKENS) {
      throw new Error(
        "The model reached its maximum token limit while generating internal reasoning. Try reducing the conversation history or adjusting model parameters.",
      );
    }

    if (!token.isCancellationRequested) {
      const reason = state.stopReason
        ? `Stop reason: ${state.stopReason}`
        : "Please try rephrasing your request.";
      throw new Error(`No response content was generated. ${reason}`);
    }
  }

  private validateContentFiltering(state: ProcessingState): void {
    if (state.stopReason !== StopReason.CONTENT_FILTERED) {
      return;
    }

    const message = state.hasEmittedContent
      ? "The response was filtered mid-generation by content safety policies. Some content may have been displayed before filtering. This may be due to Anthropic Claude's built-in safety filtering (common with Claude 4.5) or AWS Bedrock Guardrails. Please rephrase your request."
      : "The response was filtered by content safety policies before any content was generated. This may be due to Anthropic Claude's built-in safety filtering or AWS Bedrock Guardrails. Please rephrase your request.";
    throw new Error(message);
  }

  private validateContextWindow(state: ProcessingState): void {
    if (state.stopReason !== StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED) {
      return;
    }

    throw new Error(
      "The model's context window was exceeded. Try reducing the conversation history, removing tool results, or adjusting model parameters.",
    );
  }

  private validateGuardrailIntervention(state: ProcessingState): void {
    if (state.stopReason !== StopReason.GUARDRAIL_INTERVENED) {
      return;
    }

    const message = state.hasEmittedContent
      ? "AWS Bedrock Guardrails blocked the response mid-generation. Some content may have been displayed before intervention. Please check your guardrail configuration or rephrase your request."
      : "AWS Bedrock Guardrails blocked the response before any content was generated. Please check your guardrail configuration or rephrase your request.";
    throw new Error(message);
  }

  private validateStreamResult(state: ProcessingState, token: CancellationToken): void {
    this.validateContentFiltering(state);
    this.validateGuardrailIntervention(state);
    this.validateContextWindow(state);
    this.validateContentEmission(state, token);
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
      if (typeof value === "object" && value !== null && findDetectedAndBlockedPolicy(value)) {
        return true;
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
