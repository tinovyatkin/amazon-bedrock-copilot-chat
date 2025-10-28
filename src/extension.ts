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

  const provider = new BedrockChatModelProvider(context.secrets, context.globalState);
  vscode.lm.registerLanguageModelChatProvider("bedrock", provider);

  context.subscriptions.push(
    vscode.commands.registerCommand("bedrock.manage", async () => {
      await manageSettings(context.secrets, context.globalState);
    }),
  );
}

export function deactivate() {
  logger.trace("deactivate called");
}
