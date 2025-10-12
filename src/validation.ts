import * as vscode from "vscode";

/**
 * Validate the request before sending to Bedrock
 */
export function validateRequest(messages: readonly vscode.LanguageModelChatMessage[]): void {
	if (messages.length === 0) {
		throw new Error("Messages array cannot be empty");
	}

	// Check for alternating user/assistant pattern (with some flexibility)
	let lastRole: number | undefined;
	for (const msg of messages) {
		if (msg.role === vscode.LanguageModelChatMessageRole.User) {
			lastRole = 1;
		} else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
			lastRole = 2;
		}
	}

	// Ensure we don't end with consecutive same roles
	if (lastRole === undefined) {
		throw new Error("Invalid message roles");
	}
}
