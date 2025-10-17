import { paginateGetParametersByPath, SSMClient } from "@aws-sdk/client-ssm";
import * as vscode from "vscode";

import { hasAwsCredentials, listAwsProfiles } from "../aws-profiles";
import { getBedrockSettings, updateBedrockSettings } from "../settings";

const AWS_REGIONS: string[] = [];

export async function getBedrockRegionsFromSSM(): Promise<string[]> {
  if (AWS_REGIONS.length > 0) return AWS_REGIONS;

  const client = new SSMClient({ region: "us-east-1" });

  try {
    // AWS maintains service availability info in SSM Parameter Store
    for await (const page of paginateGetParametersByPath(
      { client },
      {
        Path: "/aws/service/global-infrastructure/services/bedrock/regions",
        Recursive: true,
      },
    )) {
      for (const param of page.Parameters ?? []) {
        const region = param.Value;
        if (region) AWS_REGIONS.push(region);
      }
    }
  } catch (error) {
    console.error("Error fetching from SSM:", error);
  }

  if (AWS_REGIONS.length === 0) AWS_REGIONS.push("us-east-1");
  return AWS_REGIONS;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export async function manageSettings(globalState: vscode.Memento): Promise<void> {
  const settings = getBedrockSettings(globalState);
  const existingProfile = settings.profile;
  const existingRegion = settings.region;

  const action = await vscode.window.showQuickPick(
    [
      { label: "Set AWS Profile", value: "profile" },
      { label: "Set Region", value: "region" },
      { label: "Clear Settings", value: "clear" },
    ],
    {
      placeHolder: "Choose an action",
      title: "Manage Amazon Bedrock Provider",
    },
  );

  if (!action) {
    return;
  }

  switch (action.value) {
    case "clear": {
      const config = vscode.workspace.getConfiguration("bedrock");

      // Clear both workspace and user settings
      await Promise.all([
        config.update("profile", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("profile", undefined, vscode.ConfigurationTarget.Global),
        config.update("region", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("region", undefined, vscode.ConfigurationTarget.Global),
        config.update("preferredModel", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("preferredModel", undefined, vscode.ConfigurationTarget.Global),
        config.update("promptCaching.enabled", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("promptCaching.enabled", undefined, vscode.ConfigurationTarget.Global),
        config.update("context1M.enabled", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("context1M.enabled", undefined, vscode.ConfigurationTarget.Global),
        config.update("thinking.enabled", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("thinking.enabled", undefined, vscode.ConfigurationTarget.Global),
        config.update("thinking.budgetTokens", undefined, vscode.ConfigurationTarget.Workspace),
        config.update("thinking.budgetTokens", undefined, vscode.ConfigurationTarget.Global),
        globalState.update("bedrock.profile", undefined),
        globalState.update("bedrock.region", undefined),
      ]);

      vscode.window.showInformationMessage("Amazon Bedrock settings cleared from all scopes.");

      break;
    }
    case "profile": {
      // Attempt to list available profiles (Default credentials are always offered)
      let profiles: string[] = [];
      if (hasAwsCredentials()) {
        profiles = await listAwsProfiles();
      } else {
        vscode.window.showInformationMessage(
          "No local AWS credential files found. You can still use Default credentials (env/SSO/IMDS).",
        );
      }

      // Add option to use default credentials
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
        placeHolder: existingProfile
          ? `Current: ${existingProfile}`
          : "Current: Default credentials",
        title: "Select AWS Profile",
      });

      if (selected !== undefined) {
        // Ask where to save the setting
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

        if (scope) {
          await updateBedrockSettings("profile", selected.value, scope.value, globalState);

          const scopeLabel =
            scope.value === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
          if (selected.value) {
            vscode.window.showInformationMessage(
              `AWS profile set to: ${selected.value} (${scopeLabel} settings)`,
            );
          } else {
            vscode.window.showInformationMessage(
              `AWS profile set to: Default credentials (${scopeLabel} settings)`,
            );
          }
        }
      }

      break;
    }
    case "region": {
      const region = await vscode.window.showQuickPick(getBedrockRegionsFromSSM(), {
        ignoreFocusOut: true,
        placeHolder: `Current: ${existingRegion}`,
        title: "Amazon Bedrock Region",
      });
      if (region) {
        // Ask where to save the setting
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

        if (scope) {
          await updateBedrockSettings("region", region, scope.value, globalState);

          const scopeLabel =
            scope.value === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
          vscode.window.showInformationMessage(
            `Amazon Bedrock region set to ${region} (${scopeLabel} settings).`,
          );
        }
      }

      break;
    }
    // No default
  }
}
