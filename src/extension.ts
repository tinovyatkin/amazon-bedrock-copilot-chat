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

  // Refresh provider model list when relevant things change so UI updates immediately
  const cfgDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("bedrock.region") ||
      e.affectsConfiguration("bedrock.profile") ||
      e.affectsConfiguration("bedrock.preferredModel") ||
      e.affectsConfiguration("bedrock.context1M.enabled") ||
      e.affectsConfiguration("bedrock.promptCaching.enabled") ||
      e.affectsConfiguration("bedrock.thinking.enabled") ||
      e.affectsConfiguration("bedrock.thinking.budgetTokens")
    ) {
      provider.notifyModelInformationChanged("configuration changed");
    }
  });

  const secretsDisposable = context.secrets.onDidChange(() => {
    provider.notifyModelInformationChanged("secrets changed");
  });

  // When user selects/deselects models in the global quick pick, mirror that to refresh lists
  const lmDisposable = vscode.lm.onDidChangeChatModels(() => {
    provider.notifyModelInformationChanged("selected chat models changed");
  });

  context.subscriptions.push(cfgDisposable, secretsDisposable, lmDisposable);
}

export function deactivate() {
  logger.trace("deactivate called");
}
