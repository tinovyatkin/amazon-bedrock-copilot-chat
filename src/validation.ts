import { type Message as BedrockMessage, ConversationRole } from "@aws-sdk/client-bedrock-runtime";

/**
 * Validate converted Bedrock messages before sending to API
 * Bedrock Converse API requires:
 * - At least one message
 * - First message must be user role
 * - Messages must alternate between user and assistant roles
 */
export function validateBedrockMessages(messages: BedrockMessage[]): void {
  if (messages.length === 0) {
    throw new Error("Messages array cannot be empty");
  }

  // Bedrock requires first message to be user role
  if (messages[0].role !== ConversationRole.USER) {
    throw new Error("First message must be User role");
  }

  // Validate alternating user/assistant pattern
  let lastRole: ConversationRole | undefined;
  for (const msg of messages) {
    const currentRole = msg.role;

    // Check for consecutive messages with same role
    if (lastRole === currentRole) {
      throw new Error(
        `Invalid message sequence: consecutive ${currentRole === ConversationRole.USER ? "User" : "Assistant"} messages`,
      );
    }
    lastRole = currentRole;
  }
}
