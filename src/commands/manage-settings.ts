import { paginateGetParametersByPath, SSMClient } from "@aws-sdk/client-ssm";
import * as vscode from "vscode";

import { listAwsProfiles } from "../aws-profiles";
import { logger } from "../logger";
import { getBedrockSettings, updateBedrockSettings } from "../settings";

const AWS_REGIONS = new Set<string>();

export async function getBedrockRegionsFromSSM(
  abortSignal?: AbortSignal,
  providedLogger?: typeof logger,
): Promise<string[]> {
  if (AWS_REGIONS.size === 0) {
    const client = new SSMClient({ region: "us-east-1" });

    try {
      // AWS maintains service availability info in SSM Parameter Store
      for await (const page of paginateGetParametersByPath(
        { client },
        {
          Path: "/aws/service/global-infrastructure/services/bedrock/regions",
          Recursive: true,
        },
        { abortSignal },
      )) {
        for (const param of page.Parameters ?? []) {
          if (param.Type !== "String" || param.Name?.endsWith("/endpoint")) continue;
          const region = param.Value;
          if (region) AWS_REGIONS.add(region);
        }
      }
    } catch (error) {
      providedLogger?.error("Error fetching Bedrock regions from SSM", error);
    }

    if (AWS_REGIONS.size === 0) AWS_REGIONS.add("us-east-1");
  }

  // sorting regions to keep geographies together
  return [...AWS_REGIONS].toSorted((r1, r2) => r1.localeCompare(r2, undefined, { numeric: true }));
}

export async function manageSettings(globalState: vscode.Memento): Promise<void> {
  const settings = await getBedrockSettings(globalState);

  const action = await vscode.window.showQuickPick(
    [
      { label: "Set AWS Profile", value: "profile" as const },
      { label: "Set Region", value: "region" as const },
      { label: "Clear Settings", value: "clear" as const },
    ],
    {
      placeHolder: "Choose an action",
      title: "Manage Amazon Bedrock Provider",
    },
  );

  if (!action) return;

  switch (action.value) {
    case "clear": {
      await handleClearSettings(globalState);
      break;
    }
    case "profile": {
      await handleProfileSelection(settings.profile, globalState);
      break;
    }
    case "region": {
      await handleRegionSelection(settings.region, globalState);
      break;
    }
  }
}

async function askConfigurationScope(): Promise<undefined | vscode.ConfigurationTarget> {
  const scope = await vscode.window.showQuickPick(
    [
      {
        description: "Save for this workspace only",
        label: "$(folder) Workspace Settings",
        value: vscode.ConfigurationTarget.Workspace,
      },
      {
        description: "Save globally for all workspaces",
        label: "$(globe) User Settings",
        value: vscode.ConfigurationTarget.Global,
      },
    ],
    {
      placeHolder: "Where do you want to save this setting?",
      title: "Configuration Scope",
    },
  );

  return scope?.value;
}

async function clearAllSettings(
  config: vscode.WorkspaceConfiguration,
  globalState: vscode.Memento,
): Promise<void> {
  const configKeys = [
    "profile",
    "region",
    "preferredModel",
    "promptCaching.enabled",
    "context1M.enabled",
    "thinking.enabled",
    "thinking.budgetTokens",
  ];

  const configUpdates = configKeys.flatMap((key) => [
    config.update(key, undefined, vscode.ConfigurationTarget.Workspace),
    config.update(key, undefined, vscode.ConfigurationTarget.Global),
  ]);

  const globalStateUpdates = [
    globalState.update("bedrock.profile", undefined),
    globalState.update("bedrock.region", undefined),
  ];

  await Promise.all([...configUpdates, ...globalStateUpdates]);
}

async function handleClearSettings(globalState: vscode.Memento): Promise<void> {
  const config = vscode.workspace.getConfiguration("bedrock");
  await clearAllSettings(config, globalState);
  vscode.window.showInformationMessage("Amazon Bedrock settings cleared from all scopes.");
}

async function handleProfileSelection(
  existingProfile: string | undefined,
  globalState: vscode.Memento,
): Promise<void> {
  const profiles = await listAwsProfiles(logger);
  if (profiles.length === 0) {
    vscode.window.showInformationMessage(
      "No local AWS credential files found. You can still use Default credentials (env/SSO/IMDS).",
    );
  }

  const items = [
    {
      description: "Use default AWS credentials chain",
      label: "$(key) Default Credentials",
      value: undefined,
    },
    ...profiles.map((profile) => ({
      description: profile === existingProfile ? "Currently selected" : "",
      label: `$(account) ${profile}`,
      value: profile,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    ignoreFocusOut: true,
    placeHolder: existingProfile ? `Current: ${existingProfile}` : "Current: Default credentials",
    title: "Select AWS Profile",
  });

  if (selected === undefined) return;

  const scope = await askConfigurationScope();
  if (scope === undefined) return;

  await updateBedrockSettings("profile", selected.value, scope, globalState);

  const scopeLabel = scope === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
  const profileName = selected.value ?? "Default credentials";
  vscode.window.showInformationMessage(
    `AWS profile set to: ${profileName} (${scopeLabel} settings)`,
  );
}

async function handleRegionSelection(
  existingRegion: string,
  globalState: vscode.Memento,
): Promise<void> {
  const abortController = new AbortController();
  const cancellationToken = new vscode.CancellationTokenSource();
  cancellationToken.token.onCancellationRequested(() => {
    abortController.abort();
  });

  const region = await vscode.window.showQuickPick(
    getBedrockRegionsFromSSM(abortController.signal, logger),
    {
      ignoreFocusOut: true,
      placeHolder: `Current: ${existingRegion}`,
      title: "Amazon Bedrock Region",
    },
  );

  if (!region) return;

  const scope = await askConfigurationScope();
  if (scope === undefined) return;

  await updateBedrockSettings("region", region, scope, globalState);

  const scopeLabel = scope === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
  vscode.window.showInformationMessage(
    `Amazon Bedrock region set to ${region} (${scopeLabel} settings).`,
  );
}
