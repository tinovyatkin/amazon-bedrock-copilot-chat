import type { PackageJson } from "type-fest" with { "resolution-mode": "import" };
import * as vscode from "vscode";

import { manageSettings } from "./commands/manage-settings";
import { logger } from "./logger";
import { BedrockChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Bedrock Chat", { log: true });
  logger.initialize(outputChannel, context.extensionMode);

  // Log activation message with debugging tips
  logger.info(
    "Amazon Bedrock extension activated. For verbose debugging, set log level to Debug via the output channel dropdown menu.",
  );

  context.subscriptions.push(outputChannel);

  const ext = vscode.extensions.getExtension("vtkn.amazon-bedrock-copilot-chat");
  const extVersion = (ext?.packageJSON as PackageJson | undefined)?.version ?? "unknown";
  const vscodeVersion = vscode.version;
  const ua = `amazon-bedrock-copilot-chat/${extVersion} VSCode/${vscodeVersion}`;

  const provider = new BedrockChatModelProvider(context.globalState, ua);
  vscode.lm.registerLanguageModelChatProvider("bedrock", provider);

  context.subscriptions.push(
    vscode.commands.registerCommand("bedrock.manage", async () => {
      await manageSettings(context.globalState);
    }),
  );
}

export function deactivate() {
  logger.trace("deactivate called");
}
