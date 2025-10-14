import type { JsonValue } from "type-fest" with { "resolution-mode": "import" };
interface ToolCall {
  id: string;
  input: unknown;
  name: string;
}

export class ToolBuffer {
  private emittedIndices = new Set<number>();
  private inputBuffers: Map<number, string> = new Map();
  private tools: Map<number, ToolCall> = new Map();

  appendInput(index: number, inputChunk: string): void {
    const current = this.inputBuffers.get(index) || "";
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
      tool.input = { raw: inputStr };
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

  /**
   * Try to parse and return the tool if JSON is valid, without removing from buffer.
   * Useful for early emission while continuing to accumulate more input.
   * Returns undefined if JSON is not yet valid or tool doesn't exist.
   */
  tryGetValidTool(index: number): ToolCall | undefined {
    const tool = this.tools.get(index);
    const inputStr = this.inputBuffers.get(index);

    if (!tool || !inputStr) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(inputStr) as JsonValue;
      return {
        id: tool.id,
        input: parsed,
        name: tool.name,
      };
    } catch {
      // JSON not yet valid - this is expected during streaming
      return undefined;
    }
  }
}
