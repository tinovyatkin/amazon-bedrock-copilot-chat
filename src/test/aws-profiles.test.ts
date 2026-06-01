import * as assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { getProfileSdkUaAppId, isSsoProfile, listAwsProfiles } from "../aws-profiles";

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

  test("isSsoProfile returns true for a directly configured SSO profile", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(
        configFilepath,
        [
          "[profile sso-direct]",
          "sso_session = my-session",
          "sso_account_id = 111111111111",
          "sso_role_name = ReadOnly",
          "region = us-east-1",
          "",
        ].join("\n"),
      );
      await writeFile(credentialsFilepath, "");

      const result = await isSsoProfile("sso-direct", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(result, true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("isSsoProfile returns true when source_profile chain resolves to an SSO profile", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(
        configFilepath,
        [
          "[profile sso-base]",
          "sso_session = my-session",
          "sso_account_id = 111111111111",
          "sso_role_name = ReadOnly",
          "region = us-east-1",
          "",
          "[profile assume-role]",
          "role_arn = arn:aws:iam::222222222222:role/AssumedRole",
          "source_profile = sso-base",
          "region = us-east-1",
          "",
        ].join("\n"),
      );
      await writeFile(credentialsFilepath, "");

      const result = await isSsoProfile("assume-role", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(result, true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("isSsoProfile returns false for a non-SSO assume-role chain", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(
        configFilepath,
        [
          "[profile assume-role]",
          "role_arn = arn:aws:iam::222222222222:role/AssumedRole",
          "source_profile = static-base",
          "region = us-east-1",
          "",
        ].join("\n"),
      );
      await writeFile(
        credentialsFilepath,
        [
          "[static-base]",
          "aws_access_key_id = AKIAEXAMPLE",
          "aws_secret_access_key = secret",
          "",
        ].join("\n"),
      );

      const result = await isSsoProfile("assume-role", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(result, false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("isSsoProfile returns false when source_profile creates a cycle without SSO", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "bedrock-profiles-"));
    try {
      const configFilepath = path.join(tempDir, "config");
      const credentialsFilepath = path.join(tempDir, "credentials");

      await writeFile(
        configFilepath,
        [
          "[profile a]",
          "role_arn = arn:aws:iam::222222222222:role/A",
          "source_profile = b",
          "",
          "[profile b]",
          "role_arn = arn:aws:iam::222222222222:role/B",
          "source_profile = a",
          "",
        ].join("\n"),
      );
      await writeFile(credentialsFilepath, "");

      const result = await isSsoProfile("a", {
        configFilepath,
        filepath: credentialsFilepath,
        ignoreCache: true,
      });

      assert.strictEqual(result, false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
