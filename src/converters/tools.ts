import type * as bedrockRuntime from "@aws-sdk/client-bedrock-runtime";
import { LanguageModelChatProvider, LanguageModelChatToolMode } from "vscode";
import { getModelProfile } from "../profiles";
import { convertSchema } from "./schema";

/**
 * Convert VSCode tools to Bedrock tool configuration
 */
export function convertTools(
  options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
  modelId: string,
): bedrockRuntime.ToolConfiguration | undefined {
  if (!options.tools || options.tools.length === 0) {
    return undefined;
  }

  const profile = getModelProfile(modelId);
  const tools: bedrockRuntime.Tool[] = options.tools.map((tool: any) => ({
    toolSpec: {
      description: tool.description,
      inputSchema: {
        json: convertSchema(tool.inputSchema),
      },
      name: tool.name,
    },
  }));

  // Add cache point after tool definitions if prompt caching is supported
  // This is one of three strategic cache points: after system messages,
  // after tool definitions, and after tool results (within 4-point limit)
  if (profile.supportsPromptCaching && tools.length > 0) {
    tools.push({ cachePoint: { type: "default" } });
  }

  const config: bedrockRuntime.ToolConfiguration = { tools };

  // Add tool choice if supported by the model
  if (profile.supportsToolChoice && options.toolMode) {
    if (options.toolMode === LanguageModelChatToolMode.Required) {
      config.toolChoice = { any: {} };
    } else if (options.toolMode === LanguageModelChatToolMode.Auto) {
      config.toolChoice = { auto: {} };
    }
  }

  return config;
}
