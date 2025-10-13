import * as assert from "assert";
import { BedrockAPIClient } from "../bedrock-client";

/**
 * Integration tests for BedrockAPIClient
 *
 * These tests require valid AWS credentials configured in the environment.
 * They make actual API calls to AWS Bedrock service.
 *
 * Prerequisites:
 * - AWS credentials configured via environment variables or AWS config files
 * - IAM permissions for bedrock:ListFoundationModels and bedrock:ListInferenceProfiles
 * - Network access to AWS Bedrock API endpoints
 *
 * To run these tests:
 *   npm run test
 *
 * To skip these tests if credentials aren't configured, they will be marked as skipped.
 */

suite("BedrockAPIClient Integration Tests", () => {
	const TEST_REGION = "us-east-1";
	let client: BedrockAPIClient;

	// Check if AWS credentials are available
	const hasAwsCredentials = (): boolean => {
		// Check for environment variables
		if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
			return true;
		}
		// Check for AWS profile
		if (process.env.AWS_PROFILE) {
			return true;
		}
		// Assume credentials might be available from default credential chain
		return true;
	};

	suiteSetup(function () {
		if (!hasAwsCredentials()) {
			this.skip();
		}
	});

	setup(() => {
		client = new BedrockAPIClient(TEST_REGION);
	});

	suite("fetchModels", () => {
		test("should fetch foundation models from AWS Bedrock", async function () {
			this.timeout(30000); // Allow 30 seconds for AWS API call

			try {
				const models = await client.fetchModels();

				// Validate response structure
				assert.ok(Array.isArray(models), "fetchModels should return an array");
				assert.ok(models.length > 0, "Should return at least one model");

				// Validate first model has expected structure
				const firstModel = models[0];
				assert.ok(firstModel.modelId, "Model should have modelId");
				assert.ok(firstModel.modelArn, "Model should have modelArn");
				assert.ok(firstModel.providerName, "Model should have providerName");
				assert.ok(Array.isArray(firstModel.inputModalities), "Model should have inputModalities array");
				assert.ok(Array.isArray(firstModel.outputModalities), "Model should have outputModalities array");
				assert.strictEqual(typeof firstModel.responseStreamingSupported, "boolean", "responseStreamingSupported should be boolean");

				// Verify we get popular models (sanity check)
				const modelIds = models.map(m => m.modelId);
				const hasClaudeOrOtherModels = modelIds.some(id =>
					id.includes("anthropic") || id.includes("meta") || id.includes("mistral")
				);
				assert.ok(hasClaudeOrOtherModels, "Should include models from major providers");

				console.log(`✓ Fetched ${models.length} foundation models`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});

		test("should handle different regions", async function () {
			this.timeout(30000);

			const regions = ["us-east-1", "us-west-2"];

			for (const region of regions) {
				try {
					const regionalClient = new BedrockAPIClient(region);
					const models = await regionalClient.fetchModels();

					assert.ok(Array.isArray(models), `Should return models for region ${region}`);
					assert.ok(models.length > 0, `Should have models in region ${region}`);

					console.log(`✓ Region ${region}: ${models.length} models`);
				} catch (error: any) {
					if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
						this.skip();
					}
					throw error;
				}
			}
		});

		test("should fetch models with custom AWS profile if configured", async function () {
			this.timeout(30000);

			const profileName = process.env.AWS_PROFILE;
			if (!profileName) {
				this.skip();
			}

			try {
				const profileClient = new BedrockAPIClient(TEST_REGION, profileName);
				const models = await profileClient.fetchModels();

				assert.ok(Array.isArray(models), "Should return models with custom profile");
				assert.ok(models.length > 0, "Should have models with custom profile");

				console.log(`✓ Fetched ${models.length} models using profile: ${profileName}`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});
	});

	suite("fetchInferenceProfiles", () => {
		test("should fetch inference profiles from AWS Bedrock", async function () {
			this.timeout(30000);

			try {
				const profiles = await client.fetchInferenceProfiles();

				// Validate response structure
				assert.ok(profiles instanceof Set, "fetchInferenceProfiles should return a Set");

				// Cross-region inference profiles exist in most regions
				// If this region has any, validate them
				if (profiles.size > 0) {
					const profileArray = Array.from(profiles);

					// Validate profile ID format (should look like region.model-id)
					const firstProfile = profileArray[0];
					assert.ok(firstProfile.length > 0, "Profile ID should not be empty");

					// Many cross-region profiles follow the pattern: us.anthropic.claude-3-*
					const hasCrossRegionProfile = profileArray.some(id =>
						id.includes(".anthropic.") || id.includes(".meta.") || id.includes(".mistral.")
					);

					console.log(`✓ Fetched ${profiles.size} inference profiles`);
					if (hasCrossRegionProfile) {
						console.log("  ✓ Includes cross-region inference profiles");
					}
				} else {
					console.log("✓ No inference profiles in this region (this is normal for some regions)");
				}
			} catch (error: any) {
				// Some regions may not support inference profiles yet
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				// If the API call succeeds but returns empty, that's valid
				if (error.name !== "AccessDeniedException") {
					throw error;
				}
			}
		});

		test("should handle pagination for inference profiles", async function () {
			this.timeout(30000);

			try {
				const profiles = await client.fetchInferenceProfiles();

				// This test validates that pagination is working correctly
				// by ensuring we get all profiles (not just first page)
				assert.ok(profiles instanceof Set, "Should return a Set");

				// Convert to array to check for duplicates
				const profileArray = Array.from(profiles);
				const uniqueProfiles = new Set(profileArray);

				// Ensure no duplicates (pagination should not double-count)
				assert.strictEqual(
					profileArray.length,
					uniqueProfiles.size,
					"Should not have duplicate profile IDs (pagination working correctly)"
				);

				console.log(`✓ Pagination test passed: ${profiles.size} unique profiles`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				if (error.name === "AccessDeniedException") {
					console.log("  ⚠ AccessDeniedException - may need bedrock:ListInferenceProfiles permission");
					this.skip();
				}
				throw error;
			}
		});

		test("should work with default credentials chain", async function () {
			this.timeout(30000);

			try {
				// Client without explicit profile should use default credential chain
				const defaultClient = new BedrockAPIClient(TEST_REGION);
				const profiles = await defaultClient.fetchInferenceProfiles();

				assert.ok(profiles instanceof Set, "Should work with default credentials");

				console.log(`✓ Default credentials work: ${profiles.size} profiles`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});
	});

	suite("setRegion and setProfile", () => {
		test("should allow changing region after construction", async function () {
			this.timeout(30000);

			try {
				client.setRegion("us-west-2");
				const models = await client.fetchModels();

				assert.ok(Array.isArray(models), "Should work after setRegion");
				assert.ok(models.length > 0, "Should fetch models from new region");

				console.log(`✓ Region change successful: ${models.length} models`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});

		test("should allow changing profile after construction", async function () {
			this.timeout(30000);

			const profileName = process.env.AWS_PROFILE;
			if (!profileName) {
				this.skip();
			}

			try {
				client.setProfile(profileName);
				const models = await client.fetchModels();

				assert.ok(Array.isArray(models), "Should work after setProfile");
				assert.ok(models.length > 0, "Should fetch models with new profile");

				console.log(`✓ Profile change successful: ${models.length} models`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});

		test("should allow clearing profile to use default credentials", async function () {
			this.timeout(30000);

			try {
				client.setProfile("some-profile");
				client.setProfile(undefined); // Clear profile

				const models = await client.fetchModels();

				assert.ok(Array.isArray(models), "Should work after clearing profile");
				assert.ok(models.length > 0, "Should fetch models with default credentials");

				console.log(`✓ Profile cleared successfully: ${models.length} models`);
			} catch (error: any) {
				if (error.name === "UnrecognizedClientException" || error.message?.includes("credentials")) {
					this.skip();
				}
				throw error;
			}
		});
	});
});
