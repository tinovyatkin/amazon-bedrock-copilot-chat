import { loadSharedConfigFiles } from "@smithy/shared-ini-file-loader";

import type { logger as Logger } from "./logger";

/**
 * Get the configured region for a specific AWS profile
 * @param profileName The profile name to look up
 * @returns The region configured in the profile, or undefined if not found
 */
export async function getProfileRegion(profileName: string): Promise<string | undefined> {
  try {
    const { configFile } = await loadSharedConfigFiles();
    return configFile?.[profileName]?.region;
  } catch {
    return undefined;
  }
}

/**
 * List all available AWS profile names from credentials and config files
 * @param logger Optional logger instance to log errors
 */
export async function listAwsProfiles(logger?: typeof Logger): Promise<string[]> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles();
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
