import * as vscode from "vscode";

class Logger {
  private extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production;
  private outputChannel: undefined | vscode.LogOutputChannel;

  debug(message: string, ...args: unknown[]) {
    this.outputChannel?.debug(message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.outputChannel?.error(message, ...args);
  }

  info(message: string, ...args: unknown[]) {
    this.outputChannel?.info(message, ...args);
  }

  initialize(outputChannel: vscode.LogOutputChannel, extensionMode: vscode.ExtensionMode) {
    this.outputChannel = outputChannel;
    this.extensionMode = extensionMode;
  }

  log(message: string, ...args: unknown[]) {
    // Deprecated: Use info(), debug(), trace(), warn(), or error() instead
    this.outputChannel?.info(message, ...args);
  }

  trace(message: string, ...args: unknown[]) {
    this.outputChannel?.trace(message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.outputChannel?.warn(message, ...args);
  }
}

export const logger = new Logger();
