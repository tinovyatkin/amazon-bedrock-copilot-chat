import * as vscode from "vscode";

/**
 * Validate the request before sending to Bedrock
 * Bedrock Converse API requires:
 * - First message must be User role
 * - Messages must alternate between User and Assistant roles
 */
export function validateRequest(messages: readonly vscode.LanguageModelChatMessage[]): void {
  if (messages.length === 0) {
    throw new Error("Messages array cannot be empty");
  }

  // Bedrock requires first message to be User role
  if (messages[0].role !== vscode.LanguageModelChatMessageRole.User) {
    throw new Error("First message must be User role");
  }

  // Validate alternating user/assistant pattern
  let lastRole: undefined | vscode.LanguageModelChatMessageRole;
  for (const msg of messages) {
    const currentRole = msg.role;

    // Check for consecutive messages with same role
    if (lastRole === currentRole) {
      throw new Error(
        `Invalid message sequence: consecutive ${currentRole === vscode.LanguageModelChatMessageRole.User ? "User" : "Assistant"} messages`,
      );
    }
    lastRole = currentRole;
  }
}
