# AWS GovCloud Compatibility

This extension now fully supports AWS GovCloud (US) regions (`us-gov-west-1`, `us-gov-east-1`) as well as AWS China regions (`cn-north-1`, `cn-northwest-1`).

## What Was Fixed

### 1. Region Prefix Parsing (Critical Fix)

**Problem:** The code was using simple string splitting that broke for GovCloud regions.

```typescript
// ❌ Before: us-gov-west-1 → "us" (incorrect)
const regionPrefix = settings.region.split("-")[0];

// ✅ After: us-gov-west-1 → "us-gov-west" (correct)
const regionPrefix = getRegionPrefix(settings.region);
```

**Impact:** Regional inference profiles now work correctly in GovCloud.

### 2. Partition-Aware Fallback Detection

**Problem:** When `ListFoundationModels` API is denied, the fallback detection was trying to use global inference profiles that don't exist in GovCloud.

**Fix:** Added partition detection that:

- Skips global profile checks in GovCloud and China (not supported)
- Uses correct regional profile prefixes for each partition
- Logs clear messages about partition-specific behavior

### 3. New Utility Module: `aws-partition.ts`

Created a centralized module for partition and region handling with:

- `getPartitionFromRegion(region)` - Detect aws, aws-us-gov, or aws-cn
- `getRegionPrefix(region)` - Extract correct prefix for inference profiles
- `supportsGlobalInferenceProfiles(partition)` - Check partition capabilities
- `getArnPartition(partition)` - Get ARN partition identifier

## Partition Differences

### Commercial AWS (`aws`)

- **Regions:** us-east-1, eu-west-1, ap-southeast-2, etc.
- **Global Profiles:** ✅ Supported (e.g., `global.anthropic.claude-...`)
- **Regional Profiles:** ✅ Supported (e.g., `us.anthropic.claude-...`)
- **Region Prefix:** Single part (us, eu, ap, etc.)

### GovCloud (`aws-us-gov`)

- **Regions:** us-gov-west-1, us-gov-east-1
- **Global Profiles:** ❌ Not supported
- **Regional Profiles:** ✅ Supported (e.g., `us-gov-west.anthropic.claude-...`)
- **Region Prefix:** Three parts (us-gov-west, us-gov-east)
- **Endpoints:** Separate endpoints (handled automatically by AWS SDK)
- **Model Availability:** Limited subset of models

### China (`aws-cn`)

- **Regions:** cn-north-1, cn-northwest-1
- **Global Profiles:** ❌ Not supported
- **Regional Profiles:** ✅ Supported (e.g., `cn-north.anthropic.claude-...`)
- **Region Prefix:** Two parts (cn-north, cn-northwest)

## Configuration

No special configuration needed! Just select a GovCloud region in the extension settings:

1. Open Command Palette: `Cmd+Shift+P`
2. Run: `Manage Amazon Bedrock Provider`
3. Select region: `us-gov-west-1` or `us-gov-east-1`
4. Configure your AWS profile

## Testing

Comprehensive unit tests verify:

- ✅ Partition detection for all region types
- ✅ Correct region prefix extraction
- ✅ Global profile support detection
- ✅ Regional inference profile ID construction

Run tests:

```bash
bun test src/__tests__/aws-partition.test.ts
```

## Implementation Details

### Region Prefix Logic

The region prefix extraction handles all AWS partition formats:

| Region         | Prefix       | Format      |
| -------------- | ------------ | ----------- |
| us-east-1      | us           | Single part |
| eu-west-1      | eu           | Single part |
| us-gov-west-1  | us-gov-west  | Three parts |
| us-gov-east-1  | us-gov-east  | Three parts |
| cn-north-1     | cn-north     | Two parts   |
| cn-northwest-1 | cn-northwest | Two parts   |

### Fallback Model Detection

When `ListFoundationModels` is denied, the extension:

1. **Detects partition** from the configured region
2. **Checks global profile** (only if commercial partition)
3. **Checks regional profile** with correct prefix
4. **Falls back to base model** if no profile accessible

Logging shows partition-specific behavior:

```text
[Bedrock API Client] Fallback detection configuration
  partition: aws-us-gov
  region: us-gov-west-1
  regionPrefix: us-gov-west
  hasGlobalProfiles: false
```

## Known Limitations

1. **Model Availability:** GovCloud has a limited subset of Bedrock models
   - Available: Claude 4.5 Sonnet, Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3 Haiku
   - Check AWS documentation for current model availability

2. **Feature Availability:** Some Bedrock features may not be available in all partitions
   - Bedrock Data Automation: Available in us-gov-west-1
   - Check the [Feature support by AWS Region](https://docs.aws.amazon.com/bedrock/latest/userguide/features-regions.html) documentation

3. **Cross-Partition Access:** Resources must be in the same partition
   - Cannot mix commercial and GovCloud resources
   - IAM credentials from one partition don't work in another

## References

- [AWS GovCloud (US) User Guide - Amazon Bedrock](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-bedrock.html)
- [Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html)
- [AWS Partitions Documentation](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/partitions.html)
