import * as vscode from "vscode";
import { BedrockChatModelProvider } from "./provider";
import { manageSettings } from "./commands/manage-settings";
import { logger } from "./logger";

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel("Bedrock Chat");
	logger.initialize(outputChannel, context.extensionMode);

	context.subscriptions.push(outputChannel);

	const ext = vscode.extensions.getExtension("tinovyatkin.amazon-bedrock-copilot-chat");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	const ua = `amazon-bedrock-copilot-chat/${extVersion} VSCode/${vscodeVersion}`;

	const provider = new BedrockChatModelProvider(context.globalState, ua);
	vscode.lm.registerLanguageModelChatProvider("bedrock", provider);

	context.subscriptions.push(
		vscode.commands.registerCommand("bedrock.manage", async () => {
			await manageSettings(context.globalState);
		})
	);
}

export function deactivate() {}
