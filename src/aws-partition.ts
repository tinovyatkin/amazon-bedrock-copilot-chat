/**
 * AWS Partition and Region utilities for cross-partition compatibility
 */

/**
 * AWS partitions represent isolated AWS environments
 * - aws: Commercial AWS (standard regions like us-east-1, eu-west-1)
 * - aws-us-gov: AWS GovCloud (US) (us-gov-west-1, us-gov-east-1)
 * - aws-cn: AWS China (cn-north-1, cn-northwest-1)
 */
export type AWSPartition = "aws" | "aws-cn" | "aws-us-gov";

/**
 * Get the ARN partition identifier for constructing AWS Resource Names
 *
 * Used when building ARNs in the format:
 * arn:{partition}:service:region:account:resource
 *
 * @param partition The AWS partition
 * @returns The partition string for ARN construction
 */
export function getArnPartition(partition: AWSPartition): string {
  return partition;
}

/**
 * Determine the AWS partition from a region identifier
 * @param region AWS region identifier (e.g., "us-east-1", "us-gov-west-1", "cn-north-1")
 * @returns The partition this region belongs to
 */
export function getPartitionFromRegion(region: string): AWSPartition {
  // GovCloud regions start with "us-gov-"
  if (region.startsWith("us-gov-")) {
    return "aws-us-gov";
  }

  // China regions start with "cn-"
  if (region.startsWith("cn-")) {
    return "aws-cn";
  }

  // Everything else is commercial AWS
  return "aws";
}

/**
 * Extract the region prefix used for regional inference profile IDs
 *
 * Regional inference profiles use a prefix format for routing:
 * - Commercial regions: Single part (us, eu, ap, etc.)
 * - GovCloud regions: Three parts (us-gov-west, us-gov-east)
 * - China regions: Two parts (cn-north, cn-northwest)
 *
 * Examples:
 * - us-east-1 → "us"
 * - us-gov-west-1 → "us-gov-west"
 * - cn-north-1 → "cn-north"
 * - eu-west-1 → "eu"
 * - ap-southeast-2 → "ap"
 *
 * @param region AWS region identifier
 * @returns Region prefix for use in inference profile IDs
 */
export function getRegionPrefix(region: string): string {
  // GovCloud regions: us-gov-west-1 → us-gov-west
  // Format: us-gov-{direction}-{number}
  if (region.startsWith("us-gov-")) {
    const parts = region.split("-");
    if (parts.length >= 3) {
      return `${parts[0]}-${parts[1]}-${parts[2]}`; // us-gov-west or us-gov-east
    }
  }

  // China regions: cn-north-1 → cn-north, cn-northwest-1 → cn-northwest
  // Format: cn-{location}-{number}
  if (region.startsWith("cn-")) {
    const parts = region.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`; // cn-north or cn-northwest
    }
  }

  // Standard commercial regions: us-east-1 → us, eu-west-1 → eu
  // Format: {continent}-{location}-{number}
  return region.split("-")[0];
}

/**
 * Check if global inference profiles are supported in this partition
 *
 * Global inference profiles (e.g., "global.anthropic.claude-...") route requests
 * across multiple regions within a partition for better availability. However,
 * they are only available in the commercial AWS partition.
 *
 * - Commercial (aws): Supports global profiles ✓
 * - GovCloud (aws-us-gov): No global profiles ✗
 * - China (aws-cn): No global profiles ✗
 *
 * @param partition The AWS partition to check
 * @returns true if global inference profiles are supported
 */
export function supportsGlobalInferenceProfiles(partition: AWSPartition): boolean {
  return partition === "aws";
}
