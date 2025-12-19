import * as assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { getProfileSdkUaAppId, listAwsProfiles } from "../aws-profiles";

suite("aws-profiles", () => {
  test("listAwsProfiles returns an array", async () => {
    const profiles = await listAwsProfiles();
    assert.ok(Array.isArray(profiles));
  });

  test("listAwsProfiles returns at least one profile in current environment", async () => {
    const profiles = await listAwsProfiles();
    assert.ok(
      profiles.length > 0,
      "Expected at least one AWS profile to be configured in the current environment",
    );
  });

  test("listAwsProfiles returns sorted profiles", async () => {
    const profiles = await listAwsProfiles();
    if (profiles.length > 1) {
      // Verify the array is sorted
      const sorted = profiles.toSorted();
      assert.deepStrictEqual(profiles, sorted, "Profiles should be returned in sorted order");
    }
  });

  test("listAwsProfiles returns unique profiles", async () => {
    const profiles = await listAwsProfiles();
    const uniqueProfiles = [...new Set(profiles)];
    assert.deepStrictEqual(profiles, uniqueProfiles, "Profiles should not contain duplicates");
  });

  test("getProfileSdkUaAppId reads sdk_ua_app_id from config profile section", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(
        configFilepath,
        ["[profile test]", "region=us-east-1", "sdk_ua_app_id =  example-app-id  ", ""].join("\n"),
      );
      await writeFile(
        credentialsFilepath,
        ["[test]", "aws_access_key_id = TEST", "aws_secret_access_key = TEST", ""].join("\n"),
      );

      const appId = await getProfileSdkUaAppId("test", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(appId, "example-app-id");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("getProfileSdkUaAppId returns undefined when sdk_ua_app_id is not configured", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(configFilepath, ["[profile test]", "region=us-east-1", ""].join("\n"));
      await writeFile(
        credentialsFilepath,
        ["[test]", "aws_access_key_id = TEST", "aws_secret_access_key = TEST", ""].join("\n"),
      );

      const appId = await getProfileSdkUaAppId("test", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(appId, undefined);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
