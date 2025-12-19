import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  type AWSPartition,
  getArnPartition,
  getPartitionFromRegion,
  getRegionPrefix,
  supportsGlobalInferenceProfiles,
} from "../aws-partition";

describe("AWS Partition Utilities", () => {
  describe("getPartitionFromRegion", () => {
    it("should detect commercial partition for standard regions", () => {
      const commercialRegions = [
        "us-east-1",
        "us-west-2",
        "eu-west-1",
        "eu-central-1",
        "ap-southeast-2",
        "ap-northeast-1",
        "sa-east-1",
        "ca-central-1",
        "af-south-1",
        "me-south-1",
      ];

      for (const region of commercialRegions) {
        assert.equal(getPartitionFromRegion(region), "aws", `Failed for region: ${region}`);
      }
    });

    it("should detect GovCloud partition for us-gov regions", () => {
      const govCloudRegions = ["us-gov-west-1", "us-gov-east-1"];

      for (const region of govCloudRegions) {
        assert.equal(getPartitionFromRegion(region), "aws-us-gov", `Failed for region: ${region}`);
      }
    });

    it("should detect China partition for cn regions", () => {
      const chinaRegions = ["cn-north-1", "cn-northwest-1"];

      for (const region of chinaRegions) {
        assert.equal(getPartitionFromRegion(region), "aws-cn", `Failed for region: ${region}`);
      }
    });
  });

  describe("getRegionPrefix", () => {
    it("should extract single-part prefix for commercial regions", () => {
      const testCases = [
        { expected: "us", region: "us-east-1" },
        { expected: "us", region: "us-west-2" },
        { expected: "eu", region: "eu-west-1" },
        { expected: "eu", region: "eu-central-1" },
        { expected: "ap", region: "ap-southeast-2" },
        { expected: "ap", region: "ap-northeast-1" },
        { expected: "sa", region: "sa-east-1" },
        { expected: "ca", region: "ca-central-1" },
        { expected: "af", region: "af-south-1" },
        { expected: "me", region: "me-south-1" },
      ];

      for (const { expected, region } of testCases) {
        assert.equal(getRegionPrefix(region), expected, `Failed for region: ${region}`);
      }
    });

    it("should extract three-part prefix for GovCloud regions", () => {
      const testCases = [
        { expected: "us-gov-west", region: "us-gov-west-1" },
        { expected: "us-gov-east", region: "us-gov-east-1" },
      ];

      for (const { expected, region } of testCases) {
        assert.equal(getRegionPrefix(region), expected, `Failed for region: ${region}`);
      }
    });

    it("should extract two-part prefix for China regions", () => {
      const testCases = [
        { expected: "cn-north", region: "cn-north-1" },
        { expected: "cn-northwest", region: "cn-northwest-1" },
      ];

      for (const { expected, region } of testCases) {
        assert.equal(getRegionPrefix(region), expected, `Failed for region: ${region}`);
      }
    });
  });

  describe("supportsGlobalInferenceProfiles", () => {
    it("should return true only for commercial partition", () => {
      const testCases: { expected: boolean; partition: AWSPartition }[] = [
        { expected: true, partition: "aws" },
        { expected: false, partition: "aws-us-gov" },
        { expected: false, partition: "aws-cn" },
      ];

      for (const { expected, partition } of testCases) {
        assert.equal(
          supportsGlobalInferenceProfiles(partition),
          expected,
          `Failed for partition: ${partition}`,
        );
      }
    });
  });

  describe("getArnPartition", () => {
    it("should return the partition identifier for ARN construction", () => {
      const testCases: { expected: string; partition: AWSPartition }[] = [
        { expected: "aws", partition: "aws" },
        { expected: "aws-us-gov", partition: "aws-us-gov" },
        { expected: "aws-cn", partition: "aws-cn" },
      ];

      for (const { expected, partition } of testCases) {
        assert.equal(getArnPartition(partition), expected, `Failed for partition: ${partition}`);
      }
    });
  });

  describe("Regional Inference Profile ID Construction", () => {
    it("should construct correct profile IDs for different partitions", () => {
      // Test that the region prefix produces correct inference profile IDs
      const testCases = [
        {
          expectedProfileId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "us-east-1",
        },
        {
          expectedProfileId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "eu-west-1",
        },
        {
          expectedProfileId: "ap.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "ap-southeast-2",
        },
        {
          expectedProfileId: "us-gov-west.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "us-gov-west-1",
        },
        {
          expectedProfileId: "us-gov-east.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "us-gov-east-1",
        },
        {
          expectedProfileId: "cn-north.anthropic.claude-sonnet-4-5-20250929-v1:0",
          region: "cn-north-1",
        },
      ];

      for (const { expectedProfileId, region } of testCases) {
        const prefix = getRegionPrefix(region);
        const modelId = "anthropic.claude-sonnet-4-5-20250929-v1:0";
        const constructedProfileId = `${prefix}.${modelId}`;

        assert.equal(
          constructedProfileId,
          expectedProfileId,
          `Failed for region: ${region}, constructed: ${constructedProfileId}`,
        );
      }
    });
  });
});
