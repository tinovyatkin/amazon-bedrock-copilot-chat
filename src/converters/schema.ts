/**
 * Convert VSCode tool schema to Bedrock JSON schema format
 */
export function convertSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  // If it's already in the correct format, return it
  if (schema.type || schema.properties || schema.items) {
    return schema;
  }

  // Otherwise, try to convert it
  const result: any = {};

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.parameters) {
    // Handle parameters object
    result.type = "object";
    result.properties = schema.parameters.properties || {};
    if (schema.parameters.required) {
      result.required = schema.parameters.required;
    }
  }

  return Object.keys(result).length > 0 ? result : schema;
}
