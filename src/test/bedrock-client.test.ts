import { ValidationException } from "@aws-sdk/client-bedrock-runtime";
import * as assert from "node:assert";

import { BedrockAPIClient } from "../bedrock-client";
import type { BedrockModelSummary } from "../types";

interface BedrockAPIClientInternals {
  bedrockClient: MockSendClient;
  bedrockRuntimeClient: MockSendClient;
  detectAnthropicFallbackModels: (abortSignal?: AbortSignal) => Promise<BedrockModelSummary[]>;
  inferenceProfileCache: Map<string, string>;
  unsupportedCountTokensModels: Set<string>;
}

interface MockSendClient {
  send: (command: unknown, options?: unknown) => Promise<unknown>;
}

const countTokensInput = {} as Parameters<BedrockAPIClient["countTokens"]>[1];

function awsError(
  name: string,
  message: string,
  httpStatusCode?: number,
  responseStatusCode?: number,
): Error {
  const error = new Error(message) as Error & {
    $metadata?: { httpStatusCode: number };
    $response?: { statusCode: number };
  };
  error.name = name;
  if (httpStatusCode) {
    error.$metadata = { httpStatusCode };
  }
  if (responseStatusCode) {
    error.$response = { statusCode: responseStatusCode };
  }
  return error;
}

function getCommandModelId(command: unknown): string | undefined {
  return (command as { input?: { modelId?: string } }).input?.modelId;
}

function internals(client: BedrockAPIClient): BedrockAPIClientInternals {
  return client as unknown as BedrockAPIClientInternals;
}

function runtimeValidationError(): ValidationException {
  return new ValidationException({
    $metadata: { httpStatusCode: 400 },
    message: "Model or inference profile is not accessible",
  });
}

suite("BedrockAPIClient unit tests", () => {
  suite("CountTokens unsupported cache", () => {
    test("does not cache transient CountTokens failures", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let countTokensCalls = 0;

      state.bedrockRuntimeClient = {
        send: async () => {
          countTokensCalls += 1;
          throw awsError("ThrottlingException", "Rate exceeded");
        },
      };

      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);
      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);

      assert.equal(countTokensCalls, 2);
      assert.equal(state.unsupportedCountTokensModels.has("openai.gpt-oss-120b-1:0"), false);
    });

    test("caches deterministic CountTokens unsupported failures", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let countTokensCalls = 0;

      state.bedrockRuntimeClient = {
        send: async () => {
          countTokensCalls += 1;
          throw awsError("ResourceNotFoundException", "Model does not support CountTokens", 404);
        },
      };

      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);
      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);

      assert.equal(countTokensCalls, 1);
      assert.equal(state.unsupportedCountTokensModels.has("openai.gpt-oss-120b-1:0"), true);
    });

    test("caches current CountTokens unsupported validation messages", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let countTokensCalls = 0;

      state.bedrockRuntimeClient = {
        send: async () => {
          countTokensCalls += 1;
          throw awsError(
            "ValidationException",
            "CountTokens API does not currently support this model.",
          );
        },
      };

      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);
      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);

      assert.equal(countTokensCalls, 1);
      assert.equal(state.unsupportedCountTokensModels.has("openai.gpt-oss-120b-1:0"), true);
    });

    test("caches structured not-found CountTokens responses", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let countTokensCalls = 0;

      state.bedrockRuntimeClient = {
        send: async () => {
          countTokensCalls += 1;
          throw awsError("ValidationException", "Model lookup failed", undefined, 404);
        },
      };

      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);
      await client.countTokens("openai.gpt-oss-120b-1:0", countTokensInput);

      assert.equal(countTokensCalls, 1);
      assert.equal(state.unsupportedCountTokensModels.has("openai.gpt-oss-120b-1:0"), true);
    });

    test("clears CountTokens unsupported cache when clients are recreated", () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      state.unsupportedCountTokensModels.add("openai.gpt-oss-120b-1:0");

      client.setRegion("us-west-2");

      assert.equal(state.unsupportedCountTokensModels.size, 0);
    });
  });

  suite("inference profile negative cache", () => {
    test("resolves apac dotted inference profiles", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let lookupCalls = 0;

      state.bedrockClient = {
        send: async () => {
          lookupCalls += 1;
          return {
            models: [
              {
                modelArn:
                  "arn:aws:bedrock:ap-southeast-1::foundation-model/anthropic.claude-3-sonnet:0",
              },
            ],
          };
        },
      };

      const resolvedModelId = await client.resolveModelId("apac.anthropic.claude-3-sonnet:0");

      assert.equal(lookupCalls, 1);
      assert.equal(resolvedModelId, "anthropic.claude-3-sonnet:0");
    });

    test("resolves current geo dotted inference profiles", async () => {
      const testCases = [
        {
          baseModelId: "anthropic.claude-opus-4-7",
          profileId: "jp.anthropic.claude-opus-4-7",
        },
        {
          baseModelId: "anthropic.claude-opus-4-7",
          profileId: "au.anthropic.claude-opus-4-7",
        },
      ];

      for (const { baseModelId, profileId } of testCases) {
        const client = new BedrockAPIClient("us-east-1");
        const state = internals(client);
        let lookupCalls = 0;

        state.bedrockClient = {
          send: async () => {
            lookupCalls += 1;
            return {
              models: [
                {
                  modelArn: `arn:aws:bedrock:us-east-1::foundation-model/${baseModelId}`,
                },
              ],
            };
          },
        };

        const resolvedModelId = await client.resolveModelId(profileId);

        assert.equal(lookupCalls, 1);
        assert.equal(resolvedModelId, baseModelId);
      }
    });

    test("does not cache aborted profile lookups", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let lookupCalls = 0;

      state.bedrockClient = {
        send: async () => {
          lookupCalls += 1;
          throw awsError("AbortError", "Operation aborted");
        },
      };

      await client.resolveModelId("global.openai.gpt-oss-120b-1:0");
      await client.resolveModelId("global.openai.gpt-oss-120b-1:0");

      assert.equal(lookupCalls, 2);
      assert.equal(state.inferenceProfileCache.has("global.openai.gpt-oss-120b-1:0"), false);
    });

    test("caches definite profile misses", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      let lookupCalls = 0;

      state.bedrockClient = {
        send: async () => {
          lookupCalls += 1;
          throw awsError("ResourceNotFoundException", "Profile not found", 404);
        },
      };

      await client.resolveModelId("global.openai.gpt-oss-120b-1:0");
      await client.resolveModelId("global.openai.gpt-oss-120b-1:0");

      assert.equal(lookupCalls, 1);
      assert.equal(
        state.inferenceProfileCache.get("global.openai.gpt-oss-120b-1:0"),
        "global.openai.gpt-oss-120b-1:0",
      );
    });
  });

  suite("fallback Anthropic profile detection", () => {
    test("detects Claude 4.7 models via known inference profiles", async () => {
      const client = new BedrockAPIClient("us-east-1");
      const state = internals(client);
      const accessibleProfileIds = new Set([
        "global.anthropic.claude-sonnet-4-7",
        "us.anthropic.claude-opus-4-7",
      ]);
      const probedProfileIds: string[] = [];

      state.bedrockRuntimeClient = {
        send: async (command) => {
          const modelId = getCommandModelId(command);
          if (modelId) {
            probedProfileIds.push(modelId);
          }
          if (modelId && accessibleProfileIds.has(modelId)) {
            return {};
          }
          throw runtimeValidationError();
        },
      };
      state.bedrockClient = {
        send: async () => ({
          authorizationStatus: "NOT_AUTHORIZED",
          regionAvailability: "UNAVAILABLE",
        }),
      };

      const models = await state.detectAnthropicFallbackModels();
      const modelIds = new Set(models.map((model) => model.modelId));

      assert.ok(modelIds.has("anthropic.claude-opus-4-7"));
      assert.ok(modelIds.has("anthropic.claude-sonnet-4-7"));
      assert.ok(probedProfileIds.includes("global.anthropic.claude-opus-4-7"));
      assert.ok(probedProfileIds.includes("us.anthropic.claude-opus-4-7"));
      assert.ok(probedProfileIds.includes("global.anthropic.claude-sonnet-4-7"));
      assert.ok(client.getFallbackInferenceProfileIds().has("us.anthropic.claude-opus-4-7"));
      assert.ok(client.getFallbackInferenceProfileIds().has("global.anthropic.claude-sonnet-4-7"));
    });

    test("uses model-specific Claude 4.7 geo profile prefixes", async () => {
      const client = new BedrockAPIClient("ap-northeast-1");
      const state = internals(client);
      const probedProfileIds: string[] = [];

      state.bedrockRuntimeClient = {
        send: async (command) => {
          const modelId = getCommandModelId(command);
          if (modelId) {
            probedProfileIds.push(modelId);
          }
          if (modelId === "jp.anthropic.claude-opus-4-7") {
            return {};
          }
          throw runtimeValidationError();
        },
      };
      state.bedrockClient = {
        send: async () => ({
          authorizationStatus: "NOT_AUTHORIZED",
          regionAvailability: "UNAVAILABLE",
        }),
      };

      const models = await state.detectAnthropicFallbackModels();

      assert.ok(probedProfileIds.includes("jp.anthropic.claude-opus-4-7"));
      assert.ok(models.some((model) => model.modelId === "anthropic.claude-opus-4-7"));
      assert.ok(client.getFallbackInferenceProfileIds().has("jp.anthropic.claude-opus-4-7"));
    });

    test("does not probe commercial US Claude 4.7 geo profiles in GovCloud", async () => {
      const client = new BedrockAPIClient("us-gov-west-1");
      const state = internals(client);
      const probedProfileIds: string[] = [];

      state.bedrockRuntimeClient = {
        send: async (command) => {
          const modelId = getCommandModelId(command);
          if (modelId) {
            probedProfileIds.push(modelId);
          }
          if (modelId === "us-gov-west.anthropic.claude-opus-4-7") {
            return {};
          }
          throw runtimeValidationError();
        },
      };
      state.bedrockClient = {
        send: async () => ({
          authorizationStatus: "NOT_AUTHORIZED",
          regionAvailability: "UNAVAILABLE",
        }),
      };

      const models = await state.detectAnthropicFallbackModels();

      assert.equal(probedProfileIds.includes("us.anthropic.claude-opus-4-7"), false);
      assert.ok(probedProfileIds.includes("us-gov-west.anthropic.claude-opus-4-7"));
      assert.ok(models.some((model) => model.modelId === "anthropic.claude-opus-4-7"));
      assert.ok(
        client.getFallbackInferenceProfileIds().has("us-gov-west.anthropic.claude-opus-4-7"),
      );
    });
  });
});
