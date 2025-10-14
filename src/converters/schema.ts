import { logger } from "../logger";

/**
 * Convert VSCode tool schema to Bedrock JSON schema format.
 *
 * VSCode already provides schemas in JSON Schema format, so we just need to
 * ensure we have a valid default if the schema is missing.
 */
export function convertSchema(schema: unknown): unknown {
  // Log the input schema for debugging
  if (schema) {
    logger.log("Tool schema:", JSON.stringify(schema, null, 2));
  } else {
    logger.log("Tool schema is null/undefined, using default");
  }

  // Return the schema as-is if provided, otherwise use a default empty object schema
  return schema ?? { type: "object" };
}
