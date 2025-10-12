import * as vscode from "vscode";
import { listAwsProfiles, hasAwsCredentials } from "../aws-profiles";

const REGIONS = [
	"us-east-1",
	"us-east-2",
	"us-west-2",
	"ap-south-1",
	"ap-northeast-1",
	"ap-northeast-2",
	"ap-southeast-1",
	"ap-southeast-2",
	"ca-central-1",
	"eu-central-1",
	"eu-west-1",
	"eu-west-2",
	"eu-west-3",
	"sa-east-1",
];

export async function manageSettings(globalState: vscode.Memento): Promise<void> {
	const existingProfile = globalState.get<string>("bedrock.profile");
	const existingRegion = globalState.get<string>("bedrock.region") ?? "us-east-1";

	const action = await vscode.window.showQuickPick(
		[
			{ label: "Set AWS Profile", value: "profile" },
			{ label: "Set Region", value: "region" },
			{ label: "Clear Settings", value: "clear" },
		],
		{
			title: "Manage AWS Bedrock Provider",
			placeHolder: "Choose an action",
		}
	);

	if (!action) {
		return;
	}

	if (action.value === "profile") {
		// Check if AWS credentials exist
		if (!hasAwsCredentials()) {
			const result = await vscode.window.showWarningMessage(
				"No AWS credentials files found. Please configure AWS credentials first.",
				"Open AWS Documentation"
			);
			if (result === "Open AWS Documentation") {
				vscode.env.openExternal(
					vscode.Uri.parse("https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html")
				);
			}
			return;
		}

		// List available profiles
		const profiles = await listAwsProfiles();
		if (profiles.length === 0) {
			vscode.window.showWarningMessage("No AWS profiles found in credentials files.");
			return;
		}

		// Add option to use default credentials
		const items = [
			{
				label: "$(key) Default Credentials",
				description: "Use default AWS credentials chain",
				value: undefined,
			},
			...profiles.map((profile) => ({
				label: `$(account) ${profile}`,
				description: profile === existingProfile ? "Currently selected" : "",
				value: profile,
			})),
		];

		const selected = await vscode.window.showQuickPick(items, {
			title: "Select AWS Profile",
			placeHolder: existingProfile
				? `Current: ${existingProfile}`
				: "Current: Default credentials",
			ignoreFocusOut: true,
		});

		if (selected !== undefined) {
			if (selected.value) {
				await globalState.update("bedrock.profile", selected.value);
				vscode.window.showInformationMessage(`AWS profile set to: ${selected.value}`);
			} else {
				await globalState.update("bedrock.profile", undefined);
				vscode.window.showInformationMessage("AWS profile set to: Default credentials");
			}
		}
	} else if (action.value === "region") {
		const region = await vscode.window.showQuickPick(REGIONS, {
			title: "AWS Bedrock Region",
			placeHolder: `Current: ${existingRegion}`,
			ignoreFocusOut: true,
		});
		if (region) {
			await globalState.update("bedrock.region", region);
			vscode.window.showInformationMessage(`AWS Bedrock region set to ${region}.`);
		}
	} else if (action.value === "clear") {
		await globalState.update("bedrock.profile", undefined);
		await globalState.update("bedrock.region", undefined);
		vscode.window.showInformationMessage("AWS Bedrock settings cleared.");
	}
}
