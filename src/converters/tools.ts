import type * as bedrockRuntime from "@aws-sdk/client-bedrock-runtime";
import type { LanguageModelChatTool } from "vscode";
import { LanguageModelChatProvider, LanguageModelChatToolMode } from "vscode";

import { logger } from "../logger";
import { getModelProfile } from "../profiles";
import { convertSchema } from "./schema";

/**
 * Convert VSCode tools to Bedrock tool configuration
 */
export function convertTools(
  options: Parameters<LanguageModelChatProvider["provideLanguageModelChatResponse"]>[2],
  modelId: string,
  extendedThinkingEnabled?: boolean,
  promptCachingEnabled?: boolean,
): bedrockRuntime.ToolConfiguration | undefined {
  if (!options.tools || options.tools.length === 0) {
    return undefined;
  }

  logger.debug(`Converting ${options.tools.length} tools for model ${modelId}`);

  const profile = getModelProfile(modelId);

  // Convert tools to Bedrock format
  // VSCode already provides tools in the correct format, we just need to wrap them
  const tools = options.tools.map(
    (tool: LanguageModelChatTool): bedrockRuntime.Tool => ({
      toolSpec: {
        description: tool.description,
        inputSchema: {
          json: convertSchema(tool.inputSchema),
        },
        name: tool.name,
      },
    }),
  );

  // Add cache point after tool definitions if prompt caching is supported and enabled
  // This is one of three strategic cache points: after system messages,
  // after tool definitions, and after tool results (within 4-point limit)
  // promptCachingEnabled defaults to true if not specified
  const cachingEnabled = promptCachingEnabled ?? true;
  if (profile.supportsPromptCaching && cachingEnabled && tools.length > 0) {
    tools.push({ cachePoint: { type: "default" } });
  }

  const config: bedrockRuntime.ToolConfiguration = { tools };

  // Add tool choice if supported by the model
  // CRITICAL: Cannot set tool_choice when extended thinking enabled
  // API error: "Thinking may not be enabled when tool_choice forces tool use"
  if (profile.supportsToolChoice && options.toolMode && !extendedThinkingEnabled) {
    if (options.toolMode === LanguageModelChatToolMode.Required) {
      config.toolChoice = { any: {} } satisfies bedrockRuntime.AnyToolChoice;
    } else if (options.toolMode === LanguageModelChatToolMode.Auto) {
      config.toolChoice = { auto: {} } satisfies bedrockRuntime.AutoToolChoice;
    }
  } else if (profile.supportsToolChoice && options.toolMode && extendedThinkingEnabled) {
    logger.debug("[Tool Converter] Skipping tool_choice (incompatible with extended thinking)", {
      requestedMode: options.toolMode,
    });
  }

  logger.debug("Tool configuration created successfully");
  return config;
}
