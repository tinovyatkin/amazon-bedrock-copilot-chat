import * as assert from "node:assert";

import { BedrockAPIClient } from "../bedrock-client";

interface BedrockAPIClientInternals {
  bedrockClient: MockSendClient;
  bedrockRuntimeClient: MockSendClient;
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

function internals(client: BedrockAPIClient): BedrockAPIClientInternals {
  return client as unknown as BedrockAPIClientInternals;
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
});
