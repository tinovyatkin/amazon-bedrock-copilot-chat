import * as assert from "node:assert";

import { getBedrockRegionsFromSSM } from "../commands/manage-settings";

/**
 * Integration tests for manage-settings.ts
 *
 * These tests require valid AWS credentials configured in the environment.
 * They make actual API calls to AWS SSM Parameter Store service.
 *
 * Prerequisites:
 * - AWS credentials configured via environment variables or AWS config files
 * - Network access to AWS SSM API endpoints in us-east-1
 * - IAM permissions for ssm:GetParametersByPath
 *
 * To run these tests:
 *   bun run test
 */

suite("getBedrockRegionsFromSSM Integration Tests", () => {
  test("should fetch Bedrock regions from SSM Parameter Store", async function () {
    this.timeout(30_000); // Allow 30 seconds for AWS API call

    const regions = await getBedrockRegionsFromSSM();

    // Validate response structure
    assert.ok(Array.isArray(regions), "getBedrockRegionsFromSSM should return an array");
    assert.ok(regions.length > 0, "Should return at least one region");

    // Validate all entries are strings
    for (const region of regions) {
      assert.strictEqual(typeof region, "string", `Region should be a string, got: ${region}`);
      assert.ok(region.length > 0, "Region string should not be empty");
    }

    // Validate regions follow AWS region naming convention
    // Standard regions: {geo}-{direction}-{number} (e.g., us-east-1, eu-west-2)
    // GovCloud regions: us-gov-{direction}-{number} (e.g., us-gov-east-1, us-gov-west-1)
    // China regions: cn-{direction}-{number} (e.g., cn-north-1, cn-northwest-1)
    const regionPattern = /^[a-z]{2}(-[a-z]+)?-[a-z]+-\d+$/;
    for (const region of regions) {
      assert.ok(regionPattern.test(region), `Region "${region}" should match AWS region pattern`);
    }

    // Validate sorting (regions should be sorted lexicographically with numeric awareness)
    const sortedRegions = regions.toSorted((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    assert.deepStrictEqual(
      regions,
      sortedRegions,
      "Regions should be sorted lexicographically with numeric awareness",
    );

    // Validate common Bedrock regions are present (as of 2024/2025)
    const expectedCommonRegions = ["us-east-1", "us-west-2"];
    for (const expectedRegion of expectedCommonRegions) {
      assert.ok(
        regions.includes(expectedRegion),
        `Should include common Bedrock region: ${expectedRegion}`,
      );
    }

    // Validate no duplicates
    const uniqueRegions = new Set(regions);
    assert.strictEqual(regions.length, uniqueRegions.size, "Should not contain duplicate regions");

    // Log the regions for manual verification (snapshot-like output)
    console.log(`✓ Fetched ${regions.length} Bedrock regions from SSM:`);
    console.log(JSON.stringify(regions, null, 2));
  });

  test("should return cached results on subsequent calls", async function () {
    this.timeout(30_000);

    // First call - fetches from API
    const firstCall = await getBedrockRegionsFromSSM();

    // Second call - should return cached results (faster)
    const startTime = Date.now();
    const secondCall = await getBedrockRegionsFromSSM();
    const duration = Date.now() - startTime;

    // Cached call should be very fast (< 10ms)
    assert.ok(duration < 10, `Cached call should be fast, took ${duration}ms`);

    // Results should be identical
    assert.deepStrictEqual(firstCall, secondCall, "Cached results should match first call results");

    console.log(`✓ Caching works: second call took ${duration}ms`);
  });

  test("should handle SSM parameter path correctly", async function () {
    this.timeout(30_000);

    const regions = await getBedrockRegionsFromSSM();

    // Validate we got regions from the correct SSM parameter path
    // Path: /aws/service/global-infrastructure/services/bedrock/regions
    assert.ok(regions.length > 0, "Should successfully fetch from SSM parameter path");

    // All regions should be valid Bedrock service regions
    // The SSM parameter store path is specifically for Bedrock service availability
    assert.ok(
      regions.every((r) => typeof r === "string" && r.length > 0),
      "All regions from SSM path should be valid strings",
    );

    console.log(`✓ SSM parameter path query successful: ${regions.length} regions`);
  });

  test("should return expected region snapshot", async function () {
    this.timeout(30_000);

    const regions = await getBedrockRegionsFromSSM();

    // Snapshot test: Validate the expected regions as of 2024/2025
    // This list should be updated when AWS adds new Bedrock regions
    const expectedRegionsSnapshot = [
      "ap-northeast-1", // Tokyo
      "ap-northeast-2", // Seoul
      "ap-south-1", // Mumbai
      "ap-southeast-1", // Singapore
      "ap-southeast-2", // Sydney
      "ca-central-1", // Canada
      "eu-central-1", // Frankfurt
      "eu-west-1", // Ireland
      "eu-west-2", // London
      "eu-west-3", // Paris
      "sa-east-1", // São Paulo
      "us-east-1", // N. Virginia
      "us-east-2", // Ohio
      "us-gov-east-1", // AWS GovCloud (US-East)
      "us-gov-west-1", // AWS GovCloud (US-West)
      "us-west-2", // Oregon
    ];

    // Check that all expected regions are present
    for (const expectedRegion of expectedRegionsSnapshot) {
      assert.ok(
        regions.includes(expectedRegion),
        `Expected region "${expectedRegion}" to be in the results. ` +
          `Current regions: ${JSON.stringify(regions)}`,
      );
    }

    // Log if there are any new regions not in our snapshot
    const newRegions = regions.filter((r) => !expectedRegionsSnapshot.includes(r));
    if (newRegions.length > 0) {
      console.log(`⚠ New regions detected (update snapshot): ${JSON.stringify(newRegions)}`);
    }

    console.log(`✓ Region snapshot validated: ${regions.length} regions`);
    console.log(`  Expected: ${expectedRegionsSnapshot.length}, Additional: ${newRegions.length}`);
  });
});
