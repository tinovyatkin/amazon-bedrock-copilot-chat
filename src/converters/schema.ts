import type { ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import type { LanguageModelChatTool } from "vscode";

import { logger } from "../logger";

/**
 * Convert VSCode tool schema to Bedrock JSON schema format.
 *
 * VSCode already provides schemas in JSON Schema format, so we just need to
 * ensure we have a valid default if the schema is missing.
 */

export function convertSchema(schema: LanguageModelChatTool["inputSchema"]) {
  // Log the input schema for debugging
  if (schema == null) {
    logger.debug("Tool schema is null/undefined, using default");
    return { type: "object" };
  } else {
    logger.debug("Tool schema:", JSON.stringify(schema, undefined, 2));
  }

  // Return the schema as-is if provided, otherwise use a default empty object schema
  return schema as NonNullable<ToolInputSchema["json"]>;
}
