import * as assert from "node:assert";
import { listAwsProfiles } from "../aws-profiles";

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
});
