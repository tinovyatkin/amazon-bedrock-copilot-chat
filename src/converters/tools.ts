import { ProvideLanguageModelChatResponseOptions, LanguageModelChatToolMode } from "vscode";
import { convertSchema } from "./schema";
import { getModelProfile } from "../profiles";

/**
 * Convert VSCode tools to Bedrock tool configuration
 */
export function convertTools(
	options: ProvideLanguageModelChatResponseOptions,
	modelId: string
): { tools: any[]; toolChoice?: any } | undefined {
	if (!options.tools || options.tools.length === 0) {
		return undefined;
	}

	const profile = getModelProfile(modelId);
	const tools = options.tools.map((tool: any) => ({
		toolSpec: {
			name: tool.name,
			description: tool.description,
			inputSchema: {
				json: convertSchema(tool.inputSchema),
			},
		},
	}));

	const config: { tools: any[]; toolChoice?: any } = { tools };

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
