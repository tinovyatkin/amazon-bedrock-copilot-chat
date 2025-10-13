interface ToolCall {
  id: string;
  input: any;
  name: string;
}

export class ToolBuffer {
  private inputBuffers: Map<number, string> = new Map();
  private tools: Map<number, ToolCall> = new Map();

  appendInput(index: number, inputChunk: string): void {
    const current = this.inputBuffers.get(index) || "";
    this.inputBuffers.set(index, current + inputChunk);
  }

  finalizeTool(index: number): ToolCall | undefined {
    const tool = this.tools.get(index);
    const inputStr = this.inputBuffers.get(index);

    if (!tool || !inputStr) {
      return undefined;
    }

    try {
      tool.input = JSON.parse(inputStr);
    } catch {
      tool.input = { raw: inputStr };
    }

    this.tools.delete(index);
    this.inputBuffers.delete(index);

    return tool;
  }

  startTool(index: number, id: string, name: string): void {
    this.tools.set(index, { id, input: {}, name });
    this.inputBuffers.set(index, "");
  }
}
