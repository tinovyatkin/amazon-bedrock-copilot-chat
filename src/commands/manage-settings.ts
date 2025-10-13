import * as vscode from "vscode";
import { hasAwsCredentials, listAwsProfiles } from "../aws-profiles";

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
			placeHolder: "Choose an action",
			title: "Manage AWS Bedrock Provider",
		}
	);

	if (!action) {
		return;
	}

	if (action.value === "profile") {
		// Attempt to list available profiles (Default credentials are always offered)
		let profiles: string[] = [];
		if (hasAwsCredentials()) {
			profiles = await listAwsProfiles();
		} else {
			vscode.window.showInformationMessage(
				"No local AWS credential files found. You can still use Default credentials (env/SSO/IMDS)."
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
			ignoreFocusOut: true,
			placeHolder: `Current: ${existingRegion}`,
			title: "AWS Bedrock Region",
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
