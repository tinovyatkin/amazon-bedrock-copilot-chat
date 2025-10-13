import * as vscode from "vscode";
import { CancellationToken, LanguageModelResponsePart, Progress } from "vscode";
import { ToolBuffer } from "./tool-buffer";
import { logger } from "./logger";

export class StreamProcessor {
	async processStream(
		stream: AsyncIterable<any>,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		const toolBuffer = new ToolBuffer();

		for await (const event of stream) {
			if (token.isCancellationRequested) {
				logger.log("[Stream Processor] Cancellation requested");
				break;
			}

			if (event.contentBlockStart) {
				const start = event.contentBlockStart;
				if (start.start?.toolUse) {
					const toolUse = start.start.toolUse;
					toolBuffer.startTool(start.contentBlockIndex, toolUse.toolUseId, toolUse.name);
					logger.log("[Stream Processor] Tool call started:", toolUse.name);
				}
			} else if (event.contentBlockDelta) {
				const delta = event.contentBlockDelta;
				if (delta.delta?.text) {
					progress.report(new vscode.LanguageModelTextPart(delta.delta.text));
				} else if (delta.delta?.toolUse) {
					toolBuffer.appendInput(delta.contentBlockIndex, delta.delta.toolUse.input);
				}
			} else if (event.contentBlockStop) {
				const stop = event.contentBlockStop;
				const tool = toolBuffer.finalizeTool(stop.contentBlockIndex);
				if (tool) {
					logger.log("[Stream Processor] Tool call finalized:", tool.name);
					progress.report(new vscode.LanguageModelToolCallPart(tool.id, tool.name, tool.input));
				}
			} else if (event.messageStop) {
				logger.log("[Stream Processor] Message stop event");
			} else if (event.metadata) {
				logger.log("[Stream Processor] Metadata:", event.metadata);
			}
		}
	}
}
