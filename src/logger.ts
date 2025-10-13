import * as vscode from "vscode";

class Logger {
	private extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production;
	private outputChannel: undefined | vscode.OutputChannel;

	error(message: string, ...args: any[]) {
		const formattedMessage = this.formatMessage(message, args);
		this.outputChannel?.appendLine(`ERROR: ${formattedMessage}`);
	}

	initialize(outputChannel: vscode.OutputChannel, extensionMode: vscode.ExtensionMode) {
		this.outputChannel = outputChannel;
		this.extensionMode = extensionMode;
	}

	log(message: string, ...args: any[]) {
		if (this.extensionMode === vscode.ExtensionMode.Development) {
			const formattedMessage = this.formatMessage(message, args);
			this.outputChannel?.appendLine(formattedMessage);
		}
	}

	private formatMessage(message: string, args: any[]): string {
		if (args.length === 0) {
			return message;
		}
		const argsStr = args
			.map((arg) => {
				if (typeof arg === "object") {
					try {
						return JSON.stringify(arg, null, 2);
					} catch {
						return String(arg);
					}
				}
				return String(arg);
			})
			.join(" ");
		return `${message} ${argsStr}`;
	}
}

export const logger = new Logger();
