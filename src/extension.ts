import * as vscode from "vscode";

import { manageSettings } from "./commands/manage-settings";
import { logger } from "./logger";
import { BedrockChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Amazon Bedrock Models", { log: true });
  logger.initialize(outputChannel, context.extensionMode);

  // Log activation message with debugging tips
  logger.info(
    "Amazon Bedrock extension activated. For verbose debugging, set log level to Debug via the output channel dropdown menu.",
  );

  const provider = new BedrockChatModelProvider(context.secrets, context.globalState);
  // Register provider and ensure it is disposed with the extension
  const providerDisposable = vscode.lm.registerLanguageModelChatProvider("bedrock", provider);
  const manageCmdDisposable = vscode.commands.registerCommand("bedrock.manage", async () => {
    await manageSettings(context.secrets, context.globalState);
  });

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

  // Debounce secrets changes: this event is global and fires on any secret update
  // across the workspace (all extensions); cannot filter by key. Debounce to
  // coalesce rapid or unrelated updates into a single refresh.
  let secretsRefreshHandle: ReturnType<typeof setTimeout> | undefined;
  const secretsDisposable = context.secrets.onDidChange(() => {
    if (secretsRefreshHandle) {
      clearTimeout(secretsRefreshHandle);
    }
    secretsRefreshHandle = setTimeout(() => {
      provider.notifyModelInformationChanged("secrets changed (debounced)");
      secretsRefreshHandle = undefined;
    }, 400);
  });

  // Clear any pending debounce timer on extension dispose to prevent firing after cleanup
  const secretsDebounceDisposable = new vscode.Disposable(() => {
    if (secretsRefreshHandle) {
      clearTimeout(secretsRefreshHandle);
      secretsRefreshHandle = undefined;
    }
  });

  // When user selects/deselects models in the global quick pick, mirror that to refresh lists
  const lmDisposable = vscode.lm.onDidChangeChatModels(() => {
    provider.notifyModelInformationChanged("selected chat models changed");
  });

  context.subscriptions.push(
    outputChannel,
    provider,
    providerDisposable,
    manageCmdDisposable,
    cfgDisposable,
    secretsDisposable,
    secretsDebounceDisposable,
    lmDisposable,
  );
}

export function deactivate() {
  logger.trace("deactivate called");
}
