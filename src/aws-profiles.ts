import { loadSharedConfigFiles, type SharedConfigInit } from "@smithy/shared-ini-file-loader";
import type { IniSection } from "@smithy/types";

import type { logger as Logger } from "./logger";

/**
 * Get the configured region for a specific AWS profile
 * @param profileName The profile name to look up
 * @param init Optional shared config loader options (useful for tests)
 * @returns The region configured in the profile, or undefined if not found
 */
export async function getProfileRegion(
  profileName: string,
  init?: SharedConfigInit,
): Promise<string | undefined> {
  try {
    const { configFile } = await loadSharedConfigFiles(init);
    return configFile?.[profileName]?.region;
  } catch {
    return undefined;
  }
}

/**
 * Get the configured SDK user agent app ID for a specific AWS profile.
 *
 * This is read from the `sdk_ua_app_id` property in `~/.aws/config` (or `AWS_CONFIG_FILE`).
 * When present, it should be passed as `userAgentAppId` to AWS SDK v3 clients.
 *
 * @param profileName The profile name to look up
 * @param init Optional shared config loader options (useful for tests)
 * @returns The configured SDK UA app id, or undefined if not found
 */
export async function getProfileSdkUaAppId(
  profileName: string,
  init?: SharedConfigInit,
): Promise<string | undefined> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles(init);
    const fromConfig = configFile?.[profileName]?.sdk_ua_app_id;
    const fromCredentials = credentialsFile?.[profileName]?.sdk_ua_app_id;
    const value = fromConfig ?? fromCredentials;
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine whether a profile uses AWS IAM Identity Center / SSO configuration,
 * walking the `source_profile` chain so that assume-role profiles whose source
 * resolves to an SSO/Identity Center profile are also detected.
 *
 * For SSO profiles, passing an explicit region into fromIni() can break token
 * resolution -- and because `fromIni` propagates the same `clientConfig` while
 * recursively resolving `source_profile`, chained profiles must be inspected as
 * well. Assume-role and other non-SSO profile chains should continue to receive
 * the selected Bedrock region as STS client config.
 */
export async function isSsoProfile(profileName: string, init?: SharedConfigInit): Promise<boolean> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles(init);
    const visited = new Set<string>();
    let current: string | undefined = profileName;
    while (typeof current === "string" && !visited.has(current)) {
      visited.add(current);
      const profile: IniSection = {
        ...configFile?.[current],
        ...credentialsFile?.[current],
      };

      if (
        typeof profile.sso_session === "string" ||
        typeof profile.sso_start_url === "string" ||
        typeof profile.sso_region === "string" ||
        typeof profile.sso_account_id === "string" ||
        typeof profile.sso_role_name === "string"
      ) {
        return true;
      }

      current = profile.source_profile;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * List all available AWS profile names from credentials and config files
 * @param logger Optional logger instance to log errors
 * @param init Optional shared config loader options (useful for tests)
 */
export async function listAwsProfiles(
  logger?: typeof Logger,
  init?: SharedConfigInit,
): Promise<string[]> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles(init);
    const profiles = new Set<string>();

    // Add profiles from both files
    // Note: loadSharedConfigFiles already normalizes profile names
    // (removes "profile " prefix from config file)
    for (const key of Object.keys(configFile ?? {})) {
      profiles.add(key);
    }
    for (const key of Object.keys(credentialsFile ?? {})) {
      profiles.add(key);
    }

    return [...profiles].toSorted();
  } catch (error) {
    logger?.error("Failed to load AWS profiles", error);
    // If loading fails, return empty array
    return [];
  }
}
