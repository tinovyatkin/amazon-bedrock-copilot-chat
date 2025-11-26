import * as vscode from "vscode";
import { getProfileRegion } from "./aws-profiles";

/**
 * Settings helper that reads configuration with priority order:
 * 1. VSCode workspace settings (.vscode/settings.json)
 * 2. VSCode user settings (global)
 * 3. GlobalState (for backward compatibility)
 * 4. Profile configuration (for region)
 * 5. Environment variables (for region)
 * 6. Default value
 */

export interface BedrockSettings {
  context1M: {
    enabled: boolean;
  };
  preferredModel: string | undefined;
  profile: string | undefined;
  promptCaching: {
    enabled: boolean;
  };
  region: string;
  thinking: {
    budgetTokens: number;
    enabled: boolean;
  };
}

/**
 * Get Bedrock settings with priority order
 */
export async function getBedrockSettings(globalState: vscode.Memento): Promise<BedrockSettings> {
  const config = vscode.workspace.getConfiguration("bedrock");

  // Read profile first (needed for region resolution)
  // Note: null in config means "use default credentials", so we check inspect() for undefined
  const profileInspect = config.inspect<null | string>("profile");
  let profile: string | undefined;

  if (profileInspect?.workspaceValue !== undefined) {
    // Workspace setting takes precedence
    profile = profileInspect.workspaceValue ?? undefined;
  } else if (profileInspect?.globalValue === undefined) {
    // Fall back to globalState for backward compatibility
    profile = globalState.get<string>("bedrock.profile");
  } else {
    // User setting takes precedence over globalState
    profile = profileInspect.globalValue ?? undefined;
  }

  // Read region with priority: workspace > user > globalState > profile config > env vars > default
  const region: string =
    config.get<string>("region") ??
    globalState.get<string>("bedrock.region") ??
    (profile ? await getProfileRegion(profile) : undefined) ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    "us-east-1";

  // Read preferred model with priority: workspace > user > globalState > default
  const preferredModelInspect = config.inspect<null | string>("preferredModel");
  let preferredModel: string | undefined;

  if (preferredModelInspect?.workspaceValue !== undefined) {
    preferredModel = preferredModelInspect.workspaceValue ?? undefined;
  } else if (preferredModelInspect?.globalValue === undefined) {
    // No globalState fallback for preferredModel as it's a new setting
    preferredModel = undefined;
  } else {
    preferredModel = preferredModelInspect.globalValue ?? undefined;
  }

  // Read 1M context settings with defaults (enabled by default)
  const context1MEnabled = config.get<boolean>("context1M.enabled") ?? true;

  // Read prompt caching settings with defaults (enabled by default)
  const promptCachingEnabled = config.get<boolean>("promptCaching.enabled") ?? true;

  // Read thinking settings with defaults
  // Check GitHub Copilot's anthropic thinking settings first, then fall back to bedrock settings
  const copilotConfig = vscode.workspace.getConfiguration("github.copilot.chat.anthropic");
  const copilotThinkingEnabled = copilotConfig.get<boolean>("thinking.enabled");
  const copilotThinkingMaxTokens = copilotConfig.get<number>("thinking.maxTokens");

  const thinkingEnabled = copilotThinkingEnabled ?? config.get<boolean>("thinking.enabled") ?? true;
  const thinkingBudgetTokens =
    copilotThinkingMaxTokens ?? config.get<number>("thinking.budgetTokens") ?? 10_000;

  return {
    context1M: {
      enabled: context1MEnabled,
    },
    preferredModel,
    profile,
    promptCaching: {
      enabled: promptCachingEnabled,
    },
    region,
    thinking: {
      budgetTokens: Math.max(1024, thinkingBudgetTokens), // Ensure minimum 1024
      enabled: thinkingEnabled,
    },
  };
}

/**
 * Update Bedrock settings in both workspace configuration and globalState
 * @param target - ConfigurationTarget (Workspace or Global)
 * @param globalState - VSCode global state for backward compatibility
 */
export async function updateBedrockSettings(
  setting: "preferredModel" | "profile" | "region",
  value: string | undefined,
  target: vscode.ConfigurationTarget,
  globalState: vscode.Memento,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("bedrock");

  // Update VSCode settings
  await config.update(setting, value, target);

  // Also update globalState for backward compatibility
  // Only do this for region and profile, not preferredModel (new setting)
  if (setting === "region" || setting === "profile") {
    await globalState.update(`bedrock.${setting}`, value);
  }
}
