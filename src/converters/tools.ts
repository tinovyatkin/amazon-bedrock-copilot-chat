import { LanguageModelChatProvider, LanguageModelChatToolMode } from "vscode";
import type * as bedrockRuntime from '@aws-sdk/client-bedrock-runtime';
import { convertSchema } from "./schema";
import { getModelProfile } from "../profiles";

/**
 * Convert VSCode tools to Bedrock tool configuration
 */
export function convertTools(
	options: Parameters<LanguageModelChatProvider['provideLanguageModelChatResponse']>[2],
	modelId: string
): bedrockRuntime.ToolConfiguration | undefined {
	if (!options.tools || options.tools.length === 0) {
		return undefined;
	}

	const profile = getModelProfile(modelId);
	const tools = options.tools.map((tool: any) => ({
		toolSpec: {
			description: tool.description,
			inputSchema: {
				json: convertSchema(tool.inputSchema),
			},
			name: tool.name,
		},
	}));

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
