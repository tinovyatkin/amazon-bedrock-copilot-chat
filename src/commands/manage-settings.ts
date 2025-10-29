import { paginateGetParametersByPath, SSMClient } from "@aws-sdk/client-ssm";
import * as nodeNativeFetch from "smithy-node-native-fetch";
import * as vscode from "vscode";

import { listAwsProfiles } from "../aws-profiles";
import { logger } from "../logger";
import { getBedrockSettings, updateBedrockSettings } from "../settings";
import type { AuthMethod } from "../types";

const AWS_REGIONS = new Set<string>();

export async function getBedrockRegionsFromSSM(
  abortSignal?: AbortSignal,
  providedLogger?: typeof logger,
): Promise<string[]> {
  if (AWS_REGIONS.size === 0) {
    const client = new SSMClient({ region: "us-east-1", ...nodeNativeFetch });

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
  }

  // sorting regions to keep geographies together
  return [...AWS_REGIONS].toSorted((r1, r2) => r1.localeCompare(r2, undefined, { numeric: true }));
}

export async function manageSettings(
  secrets: vscode.SecretStorage,
  globalState: vscode.Memento,
): Promise<void> {
  const settings = await getBedrockSettings(globalState);
  const currentAuthMethod = globalState.get<AuthMethod>("bedrock.authMethod") ?? "profile";

  const action = await vscode.window.showQuickPick(
    [
      {
        description: `Current: ${currentAuthMethod}`,
        label: "Set Authentication Method",
        value: "auth-method" as const,
      },
      {
        description:
          currentAuthMethod === "profile"
            ? `Current: ${settings.profile ?? "Default"}`
            : "Only for profile auth",
        label: "Set AWS Profile",
        value: "profile" as const,
      },
      {
        description: `Current: ${settings.region}`,
        label: "Set Region",
        value: "region" as const,
      },
      { label: "Clear Settings", value: "clear" as const },
    ],
    {
      placeHolder: "Choose an action",
      title: "Manage Amazon Bedrock Provider",
    },
  );

  if (!action) return;

  switch (action.value) {
    case "auth-method": {
      await handleAuthMethodSelection(secrets, globalState);
      break;
    }
    case "clear": {
      await handleClearSettings(secrets, globalState);
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
  secrets: vscode.SecretStorage,
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
    globalState.update("bedrock.authMethod", undefined),
    globalState.update("bedrock.profile", undefined),
    globalState.update("bedrock.region", undefined),
  ];

  const secretUpdates = [
    secrets.delete("bedrock.apiKey"),
    secrets.delete("bedrock.accessKeyId"),
    secrets.delete("bedrock.secretAccessKey"),
    secrets.delete("bedrock.sessionToken"),
  ];

  const results = await Promise.allSettled([
    ...configUpdates,
    ...globalStateUpdates,
    ...secretUpdates,
  ]);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      "Failed to clear one or more settings",
    );
  }
}

async function clearAuthSettings(
  secrets: vscode.SecretStorage,
  globalState: vscode.Memento,
): Promise<void> {
  await Promise.all([
    secrets.delete("bedrock.apiKey"),
    secrets.delete("bedrock.accessKeyId"),
    secrets.delete("bedrock.secretAccessKey"),
    secrets.delete("bedrock.sessionToken"),
    globalState.update("bedrock.profile", undefined),
  ]);
}

async function handleAccessKeysSetup(secrets: vscode.SecretStorage): Promise<void> {
  const accessKeyId = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: "Enter your AWS access key ID",
    title: "AWS Access Key ID",
  });

  if (accessKeyId === undefined) return;

  if (!accessKeyId.trim()) {
    vscode.window.showWarningMessage("Access key ID cannot be empty.");
    return;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: "Enter your AWS secret access key",
    title: "AWS Secret Access Key",
  });

  if (secretAccessKey === undefined) return;

  if (!secretAccessKey.trim()) {
    vscode.window.showWarningMessage("Secret access key cannot be empty.");
    return;
  }

  const sessionToken = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: "Enter your AWS session token (leave empty if not needed)",
    title: "AWS Session Token (Optional)",
  });

  if (sessionToken === undefined) return;

  await secrets.store("bedrock.accessKeyId", accessKeyId.trim());
  await secrets.store("bedrock.secretAccessKey", secretAccessKey.trim());

  if (sessionToken?.trim()) {
    await secrets.store("bedrock.sessionToken", sessionToken.trim());
  }

  vscode.window.showInformationMessage("AWS access keys saved securely.");
}

async function handleApiKeySetup(secrets: vscode.SecretStorage): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: "Enter your AWS Bedrock API key (bearer token)",
    title: "AWS Bedrock API Key",
  });

  if (apiKey === undefined) return;

  if (!apiKey.trim()) {
    vscode.window.showWarningMessage("API key cannot be empty.");
    return;
  }

  await secrets.store("bedrock.apiKey", apiKey.trim());
  vscode.window.showInformationMessage("AWS Bedrock API key saved securely.");
}

async function handleAuthMethodSelection(
  secrets: vscode.SecretStorage,
  globalState: vscode.Memento,
): Promise<void> {
  const method = await vscode.window.showQuickPick(
    [
      {
        description: "Use AWS named profile from ~/.aws/credentials (recommended)",
        label: "AWS Profile",
        value: "profile" as const,
      },
      {
        description: "Use AWS Bedrock API key (bearer token)",
        label: "API Key",
        value: "api-key" as const,
      },
      {
        description: "Use AWS access key ID and secret",
        label: "Access Keys",
        value: "access-keys" as const,
      },
    ],
    {
      ignoreFocusOut: true,
      placeHolder: "Choose how to authenticate with AWS Bedrock",
      title: "Select Authentication Method",
    },
  );

  if (!method) return;

  // Clear existing auth settings before setting new method
  await clearAuthSettings(secrets, globalState);
  await globalState.update("bedrock.authMethod", method.value);

  switch (method.value) {
    case "access-keys": {
      await handleAccessKeysSetup(secrets);
      break;
    }
    case "api-key": {
      await handleApiKeySetup(secrets);
      break;
    }
    case "profile": {
      // For profile, prompt to set it up
      const settings = await getBedrockSettings(globalState);
      await handleProfileSelection(settings.profile, globalState);
      break;
    }
  }
}

async function handleClearSettings(
  secrets: vscode.SecretStorage,
  globalState: vscode.Memento,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("bedrock");
  await clearAllSettings(config, secrets, globalState);
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
  existingRegion: string | undefined,
  globalState: vscode.Memento,
): Promise<void> {
  const abortController = new AbortController();
  const cancellationToken = new vscode.CancellationTokenSource();
  cancellationToken.token.onCancellationRequested(() => {
    abortController.abort();
  });

  try {
    const regions = await getBedrockRegionsFromSSM(abortController.signal, logger);

    const region: string | undefined =
      regions.length === 0
        ? await promptForManualRegion(cancellationToken.token)
        : await vscode.window.showQuickPick(
            regions,
            {
              ignoreFocusOut: true,
              placeHolder: existingRegion ? `Current: ${existingRegion}` : "Current: Not set",
              title: "Amazon Bedrock Region",
            },
            cancellationToken.token,
          );

    if (!region) return;

    const scope = await askConfigurationScope();
    if (scope === undefined) return;

    await updateBedrockSettings("region", region, scope, globalState);

    const scopeLabel = scope === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
    vscode.window.showInformationMessage(
      `Amazon Bedrock region set to ${region} (${scopeLabel} settings).`,
    );
  } finally {
    cancellationToken.dispose();
  }
}

async function promptForManualRegion(
  cancellationToken?: vscode.CancellationToken,
): Promise<string | undefined> {
  // Inform the user why manual input is needed
  vscode.window.showInformationMessage(
    "Unable to fetch Bedrock regions automatically. Please enter your AWS region manually.",
  );

  while (true) {
    const region = await vscode.window.showInputBox(
      {
        ignoreFocusOut: true,
        prompt: "Enter the AWS region you want to use",
        title: "AWS Region",
      },
      cancellationToken,
    );

    if (region === undefined) return;

    const trimmedRegion = region.trim().toLowerCase();

    if (!trimmedRegion) {
      vscode.window.showWarningMessage("Region cannot be empty.");
      continue;
    }

    // Validate AWS region format (e.g., us-east-1, eu-west-2)
    const regionPattern = /^[a-z]{2}(-[a-z]+)?-[a-z]+-\d+$/;

    if (!regionPattern.test(trimmedRegion)) {
      vscode.window.showWarningMessage(
        "Invalid AWS region. Please enter a region such as us-east-1.",
      );
      continue;
    }

    return trimmedRegion;
  }
}
