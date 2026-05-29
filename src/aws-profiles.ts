import { loadSharedConfigFiles, type SharedConfigInit } from "@smithy/shared-ini-file-loader";

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
 * Determine whether a profile uses AWS IAM Identity Center / SSO configuration.
 * For SSO profiles, passing an explicit region into fromIni() can break token
 * resolution. Assume-role and other profile types should continue to receive the
 * selected Bedrock region as STS client config.
 */
export async function isSsoProfile(
  profileName: string,
  init?: SharedConfigInit,
): Promise<boolean> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles(init);
    const profile = {
      ...configFile?.[profileName],
      ...credentialsFile?.[profileName],
    };

    return Boolean(
      profile.sso_session ??
        profile.sso_start_url ??
        profile.sso_region ??
        profile.sso_account_id ??
        profile.sso_role_name,
    );
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
