import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as ini from "ini";

/**
 * Get the path to the AWS config file
 */
export function getConfigFilename(): string {
	const envVal = process.env.AWS_CONFIG_FILE;
	if (envVal) {
		return path.resolve(envVal);
	}
	return path.join(os.homedir(), ".aws", "config");
}

/**
 * Get the path to the AWS credentials file
 */
export function getCredentialsFilename(): string {
	const envVal = process.env.AWS_SHARED_CREDENTIALS_FILE;
	if (envVal) {
		return path.resolve(envVal);
	}
	return path.join(os.homedir(), ".aws", "credentials");
}

/**
 * Check if AWS credentials files exist
 */
export function hasAwsCredentials(): boolean {
	const credentialsFile = getCredentialsFilename();
	const configFile = getConfigFilename();
	return fs.existsSync(credentialsFile) || fs.existsSync(configFile);
}

/**
 * List all available AWS profile names from credentials and config files
 */
export async function listAwsProfiles(): Promise<string[]> {
	const profiles = new Set<string>();

	// Read credentials file
	const credentialsFile = getCredentialsFilename();
	try {
		if (fs.existsSync(credentialsFile)) {
			const content = fs.readFileSync(credentialsFile, "utf-8");
			const parsed = ini.parse(content);
			Object.keys(parsed).forEach((key) => profiles.add(key));
		}
	} catch {
		// Ignore errors reading credentials file
	}

	// Read config file
	const configFile = getConfigFilename();
	try {
		if (fs.existsSync(configFile)) {
			const content = fs.readFileSync(configFile, "utf-8");
			const parsed = ini.parse(content);
			Object.keys(parsed).forEach((key) => {
				// Config file uses "profile <name>" format for non-default profiles
				if (key.startsWith("profile ")) {
					profiles.add(key.substring(8));
				} else if (key === "default") {
					profiles.add(key);
				}
			});
		}
	} catch {
		// Ignore errors reading config file
	}

	return Array.from(profiles).sort();
}
