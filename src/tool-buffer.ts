import type { JsonValue } from "type-fest" with { "resolution-mode": "import" };

import { logger } from "./logger";

interface ToolCall {
  id: string;
  input: unknown;
  name: string;
}

export class ToolBuffer {
  private readonly emittedIndices = new Set<number>();
  private readonly inputBuffers = new Map<number, string>();
  private readonly tools = new Map<number, ToolCall>();

  appendInput(index: number, inputChunk: string): void {
    const current = this.inputBuffers.get(index) ?? "";
    this.inputBuffers.set(index, current + inputChunk);
  }

  /**
   * Clear all tracking state. Should be called at the start of each new request.
   */
  clear(): void {
    this.tools.clear();
    this.inputBuffers.clear();
    this.emittedIndices.clear();
  }

  finalizeTool(index: number): ToolCall | undefined {
    const tool = this.tools.get(index);
    const inputStr = this.inputBuffers.get(index);

    if (!tool || !inputStr) {
      return undefined;
    }

    try {
      tool.input = JSON.parse(inputStr) as JsonValue;
    } catch {
      logger.warn("[ToolBuffer] Failed to parse tool input JSON, skipping tool call", {
        inputLength: inputStr.length,
        toolId: tool.id,
        toolName: tool.name,
      });
      logger.trace("[ToolBuffer] Raw input preview for failed tool parse", {
        rawInputPreview: inputStr.slice(0, 200).replaceAll("\n", String.raw`\n`),
        toolId: tool.id,
        toolName: tool.name,
      });
      this.tools.delete(index);
      this.inputBuffers.delete(index);
      return undefined;
    }

    this.tools.delete(index);
    this.inputBuffers.delete(index);

    return tool;
  }

  /**
   * Check if a tool at this index has already been emitted to prevent duplicates.
   */
  isEmitted(index: number): boolean {
    return this.emittedIndices.has(index);
  }

  /**
   * Mark a tool as emitted to prevent duplicate emissions.
   */
  markEmitted(index: number): void {
    this.emittedIndices.add(index);
  }

  startTool(index: number, id: string, name: string): void {
    this.tools.set(index, { id, input: {}, name });
    this.inputBuffers.set(index, "");
  }
}
