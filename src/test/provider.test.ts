import { ModelModality } from "@aws-sdk/client-bedrock";
import type { ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import * as assert from "node:assert";
import * as vscode from "vscode";
import { convertMessages, stripThinkingContent } from "../converters/messages";
import { convertTools } from "../converters/tools";
import { logger } from "../logger";
import { getModelProfile, normalizeModelId } from "../profiles";
import { BedrockChatModelProvider } from "../provider";
import type { BedrockModelSummary, ModelsDevMap } from "../types";

interface ProviderInternals {
  applyReasoningEffort: (
    requestInput: { additionalModelRequestFields?: Record<string, unknown> },
    modelId: string,
    baseModelId: string,
    reasoningEffort: "high" | "low" | "medium" | "minimal",
  ) => void;
  buildBetaHeaders: (
    modelProfile: ReturnType<typeof getModelProfile>,
    modelId: string,
    extendedThinkingEnabled: boolean,
    context1MEnabled: boolean,
    thinkingEffortEnabled: boolean,
  ) => string[];
  buildConfigurationSchema: (
    modelId: string,
    modelProfile: ReturnType<typeof getModelProfile>,
    modelsDevMap?: ModelsDevMap,
  ) => undefined | { properties?: Record<string, Record<string, unknown>> };
  buildPricingFields: (
    modelId: string,
    modelsDevMap: ModelsDevMap,
  ) => {
    cacheCost?: number;
    inputCost?: number;
    outputCost?: number;
    priceCategory?: string;
    pricing?: string;
  };
  formatDetail: (modelId: string, maxInput: number, maxOutput: number, vision: boolean) => string;
  formatTooltip: (args: {
    maxInput: number;
    maxOutput: number;
    modelId: string;
    providerName: string;
    route: string;
    vision: boolean;
  }) => string;
  resolveModelLimits: (
    modelId: string,
    context1MEnabled: boolean,
    modelsDevMap: ModelsDevMap,
  ) => { maxInputTokens: number; maxOutputTokens: number };
}

function providerInternals(provider: BedrockChatModelProvider): ProviderInternals {
  return provider as unknown as ProviderInternals;
}

// Mock implementations extracted to avoid function nesting depth issues
const mockSecretStorage = {
  delete: async () => {},
  get: async () => undefined as string | undefined,
  keys: async () => [],
  onDidChange: () => ({ dispose: () => {} }),
  store: async () => {},
} as vscode.SecretStorage;

const mockGlobalState: vscode.Memento = {
  get: async () => {},
  keys: () => [],
  update: async () => {},
};

// Helper to cast non-standard content blocks that may appear from models with extended thinking
const nonStandardBlock = (b: unknown) => b as any;

// Helper to create a test model for buildModelCandidates and findAlternativeProfile tests
const createTestModel = (modelId: string): BedrockModelSummary => ({
  inputModalities: [ModelModality.TEXT],
  modelArn: `arn:aws:bedrock:us-west-2::foundation-model/${modelId}`,
  modelId,
  modelName: modelId,
  outputModalities: [ModelModality.TEXT],
  providerName: "Anthropic",
  responseStreamingSupported: true,
});

// Helper to create a mock provider with controlled base model accessibility
const createMockClientProvider = (baseModelAccessible: boolean) => {
  const mockClient = {
    isModelAccessible: async () => baseModelAccessible,
  };
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

  (provider as any).client = mockClient;
  return provider;
};

// Helper to call the private calculateThinkingConfig method
const callCalcThinkingConfig = (
  modelProfile: { supportsThinking: boolean },
  maxOutputTokens: number,
  maxTokensForRequest: number,
  thinkingEnabled: boolean,
) => {
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  return (provider as any).calculateThinkingConfig(
    modelProfile,
    maxOutputTokens,
    maxTokensForRequest,
    thinkingEnabled,
  ) as { budgetTokens: number; extendedThinkingEnabled: boolean };
};

const callBuildRequestInput = (
  modelId: string,
  options: vscode.LanguageModelChatRequestOptions = {},
  extendedThinkingEnabled = false,
) => {
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  const modelProfile = getModelProfile(modelId);
  return (provider as any).buildRequestInput(
    {
      capabilities: {},
      family: "bedrock",
      id: modelId,
      maxInputTokens: 200_000,
      maxOutputTokens: 64_000,
      name: modelId,
      version: "1.0.0",
    },
    modelId,
    { messages: [], system: [] },
    options,
    undefined,
    extendedThinkingEnabled,
    4096,
    [],
    undefined,
    modelProfile.temperatureDeprecated,
    modelProfile.requiresAdaptiveThinking,
    undefined,
  ) as ConverseStreamCommandInput;
};

const callBuildConfigurationSchema = (modelId: string, modelsDevMap: ModelsDevMap = new Map()) => {
  const provider = providerInternals(
    new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
  );
  return provider.buildConfigurationSchema(modelId, getModelProfile(modelId), modelsDevMap);
};

const callResolveModelLimits = (
  modelId: string,
  context1MEnabled: boolean,
  modelsDevMap: ModelsDevMap,
) =>
  providerInternals(
    new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
  ).resolveModelLimits(modelId, context1MEnabled, modelsDevMap);

const makeDevMapEntry = (modelId: string, context: number, output: number): ModelsDevMap =>
  new Map([[modelId, { limit: { context, output } }]]);

/** Build a ModelsDevMap with USD pricing cost data for testing buildPricingFields */
const makeDevMapWithCost = (
  entries: [string, { cacheRead?: number; input: number; output: number }][],
): ModelsDevMap =>
  new Map(
    entries.map(([id, p]) => [
      id,
      {
        cost: { cache_read: p.cacheRead, input: p.input, output: p.output },
        limit: { context: 200_000, output: 4096 },
      },
    ]),
  );

const callBuildPricingFields = (modelId: string, modelsDevMap: ModelsDevMap) =>
  providerInternals(
    new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
  ).buildPricingFields(modelId, modelsDevMap);

suite("Amazon Bedrock Chat Provider Extension", () => {
  suite("provider", () => {
    test("prepareLanguageModelChatInformation returns array (no key -> empty)", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const infos = await provider.prepareLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token,
      );
      assert.ok(Array.isArray(infos));
    });

    test("provideTokenCount counts simple string", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);

      const est = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "m",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          name: "m",
          version: "1.0.0",
        },
        "hello world",
        new vscode.CancellationTokenSource().token,
      );
      assert.equal(typeof est, "number");
      assert.ok(est > 0);
    });

    test("provideTokenCount string estimation: ceil(length/4)", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const model = {
        capabilities: {},
        family: "bedrock",
        id: "m",
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        name: "m",
        version: "1.0.0",
      };
      const token = new vscode.CancellationTokenSource().token;
      // "abcd" = 4 chars → 1 token
      assert.equal(await provider.provideTokenCount(model, "abcd", token), 1);
      // "abcde" = 5 chars → ceil(5/4) = 2
      assert.equal(await provider.provideTokenCount(model, "abcde", token), 2);
    });

    test("provideTokenCount falls back to estimation when CountTokens API returns undefined", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      // Inject a mock client where countTokens returns undefined (API unavailable)
      (provider as unknown as { client: unknown }).client = {
        // eslint-disable-next-line unicorn/no-useless-undefined -- returning undefined is the point: simulates CountTokens API being unavailable
        countTokens: async () => undefined,
        resolveModelId: async (id: string) => id,
      };
      const text = vscode.LanguageModelChatMessage.User("hello world");
      const result = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "anthropic.claude-sonnet-4-6",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          name: "m",
          version: "1.0.0",
        },
        text,
        new vscode.CancellationTokenSource().token,
      );
      assert.equal(typeof result, "number");
      assert.ok(result > 0, "should return a positive estimate");
    });

    test("provideTokenCount uses CountTokens API result when available", async () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      // Inject a mock client where countTokens returns a known value
      (provider as unknown as { client: unknown }).client = {
        countTokens: async () => 42,
        resolveModelId: async (id: string) => id,
      };
      const text = vscode.LanguageModelChatMessage.User("hello");
      const result = await provider.provideTokenCount(
        {
          capabilities: {},
          family: "bedrock",
          id: "anthropic.claude-sonnet-4-6",
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          name: "m",
          version: "1.0.0",
        },
        text,
        new vscode.CancellationTokenSource().token,
      );
      assert.equal(result, 42);
    });

    test("does not add legacy opt-in beta headers for Opus 4.7", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-7-20260420-v1:0";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        true,
        true,
        true,
      );

      assert.equal(betaHeaders.includes("context-1m-2025-08-07"), false);
      assert.equal(betaHeaders.includes("interleaved-thinking-2025-05-14"), false);
      assert.equal(betaHeaders.includes("effort-2025-11-24"), true);
    });

    test("adds interleaved thinking beta header for Opus 4.6", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-6-v1";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        true,
        false,
        false,
      );

      assert.equal(betaHeaders.includes("interleaved-thinking-2025-05-14"), true);
    });

    test("adds 1M context beta header for models that require opt-in", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "global.anthropic.claude-opus-4-6-v1";

      const betaHeaders = provider.buildBetaHeaders(
        getModelProfile(modelId),
        modelId,
        false,
        true,
        false,
      );

      assert.deepStrictEqual(betaHeaders, ["context-1m-2025-08-07"]);
    });

    test("keeps minimal reasoning effort for routed OpenAI models", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput: { additionalModelRequestFields?: Record<string, unknown> } = {};

      provider.applyReasoningEffort(
        requestInput,
        "global.openai.gpt-oss-120b-1:0",
        "openai.gpt-oss-120b-1:0",
        "minimal",
      );

      assert.equal(requestInput.additionalModelRequestFields?.reasoning_effort, "minimal");
    });

    test("downgrades minimal reasoning effort for non-OpenAI models", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const requestInput: { additionalModelRequestFields?: Record<string, unknown> } = {};

      provider.applyReasoningEffort(
        requestInput,
        "global.qwen.qwen3-coder-480b-a35b-v1:0",
        "qwen.qwen3-coder-480b-a35b-v1:0",
        "minimal",
      );

      assert.equal(requestInput.additionalModelRequestFields?.reasoning_effort, "low");
    });

    test("labels non-adaptive effort-capable Claude models as budget thinking", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "anthropic.claude-opus-4-6-v1";

      const detail = provider.formatDetail(modelId, 872_000, 128_000, false);
      const tooltip = provider.formatTooltip({
        maxInput: 872_000,
        maxOutput: 128_000,
        modelId,
        providerName: "Anthropic",
        route: "Direct foundation model",
        vision: false,
      });

      assert.match(detail, /budget thinking/);
      assert.doesNotMatch(detail, /adaptive/);
      assert.match(tooltip, /enabled\+budget_tokens/);
      assert.doesNotMatch(tooltip, /adaptive/);
    });

    test("formats context display from maxInput+maxOutput total", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      const modelId = "minimax.minimax-m2.5";
      // maxInput = 196608 - 98304 = 98304 (input budget), maxOutput = 98304
      // total context = 98304 + 98304 = 196608 ≈ 197K
      const inputBudget = 196_608 - 98_304; // 98304

      const detail = provider.formatDetail(modelId, inputBudget, 98_304, false);
      const tooltip = provider.formatTooltip({
        maxInput: inputBudget,
        maxOutput: 98_304,
        modelId,
        providerName: "MiniMax",
        route: "Direct foundation model",
        vision: false,
      });

      // detail should show total context (197K) and output (98K)
      assert.match(detail, /^197K ctx · 98K out/);
      // tooltip should show total context 197K, not the inflated 295K
      assert.match(tooltip, /Context: 197K tokens \| Max output: 98K tokens/);
      assert.doesNotMatch(tooltip, /295K tokens/);
    });
  });

  suite("utils/convertMessages", () => {
    test("converts basic user/assistant text messages to Bedrock format", () => {
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("hi")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("hello")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
      ];
      const out = convertMessages(messages, "test.model-id");

      // Check structure
      assert.ok(out.messages);
      assert.ok(Array.isArray(out.messages));
      assert.equal(out.messages.length, 2);

      // Check first message (user)
      assert.equal(out.messages[0].role, "user");
      assert.ok(Array.isArray(out.messages[0].content));
      assert.equal(out.messages[0].content?.length, 1);
      assert.equal(out.messages[0].content?.[0]?.text, "hi");

      // Check second message (assistant)
      assert.equal(out.messages[1].role, "assistant");
      assert.ok(Array.isArray(out.messages[1].content));
      assert.equal(out.messages[1].content?.length, 1);
      assert.equal(out.messages[1].content?.[0]?.text, "hello");
    });

    test("converts assistant message with tool call to Bedrock format", () => {
      const toolCall = new vscode.LanguageModelToolCallPart("call1", "search", { q: "hello" });
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("Let me search for that")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("I'll search for you."), toolCall],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      assert.equal(out.messages.length, 2);
      assert.equal(out.messages[1].role, "assistant");
      assert.equal(out.messages[1].content?.length, 2);

      // Check text content
      assert.equal(out.messages[1].content?.[0]?.text, "I'll search for you.");

      // Check tool call
      const toolUse = out.messages[1].content?.[1]?.toolUse;
      assert.ok(toolUse);
      assert.equal(toolUse.toolUseId, "call1");
      assert.equal(toolUse.name, "search");
      assert.deepStrictEqual(toolUse.input, { q: "hello" });
    });

    test("converts user message with tool result to Bedrock format", () => {
      const toolResult = new vscode.LanguageModelToolResultPart("call1", [
        new vscode.LanguageModelTextPart("Search results: Found 5 items"),
      ]);
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("Search for cats")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelToolCallPart("call1", "search", { q: "cats" })],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.Assistant,
        },
        {
          content: [toolResult],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      assert.equal(out.messages.length, 3);
      assert.equal(out.messages[2].role, "user");

      // Check tool result
      const toolResultBlock = out.messages[2].content?.[0]?.toolResult;
      assert.ok(toolResultBlock);
      assert.equal(toolResultBlock.toolUseId, "call1");
      assert.ok(Array.isArray(toolResultBlock.content));
      assert.equal(toolResultBlock.content?.length, 1);
      // Tool result content is wrapped in a text object
      const resultContent: any = toolResultBlock.content?.[0];
      assert.ok(resultContent.text);
      assert.equal(resultContent.text, "Search results: Found 5 items");
    });

    test("merges consecutive user messages", () => {
      const messages: vscode.LanguageModelChatMessage[] = [
        {
          content: [new vscode.LanguageModelTextPart("First user message")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
        {
          content: [new vscode.LanguageModelTextPart("Second user message")],
          name: undefined,
          role: vscode.LanguageModelChatMessageRole.User,
        },
      ];

      const out = convertMessages(messages, "test.model-id");

      // Should merge consecutive user messages into one
      assert.equal(out.messages.length, 1);
      assert.equal(out.messages[0].role, "user");
      assert.equal(out.messages[0].content?.length, 2);
      assert.equal(out.messages[0].content?.[0]?.text, "First user message");
      assert.equal(out.messages[0].content?.[1]?.text, "Second user message");
    });
  });

  suite("utils/stripThinkingContent", () => {
    test("strips reasoningContent blocks from messages", () => {
      const messages = [
        {
          content: [
            { reasoningContent: { reasoningText: { signature: "sig123", text: "thinking..." } } },
            { text: "Hello" },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 1);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Hello");
    });

    test("strips thinking and redacted_thinking blocks from messages", () => {
      const messages = [
        {
          content: [
            nonStandardBlock({ thinking: "internal thought process" }),
            { text: "Response" },
          ],
          role: "assistant" as const,
        },
        {
          content: [
            nonStandardBlock({ redacted_thinking: "redacted" }),
            { text: "Another response" },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 2);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Response");
      assert.equal(result[1].content?.length, 1);
      assert.equal(result[1].content?.[0]?.text, "Another response");
    });

    test("preserves non-thinking content", () => {
      const messages = [
        {
          content: [{ text: "User message" }],
          role: "user" as const,
        },
        {
          content: [
            { text: "Assistant response" },
            { toolUse: { input: {}, name: "search", toolUseId: "123" } },
          ],
          role: "assistant" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 2);
      assert.equal(result[0].content?.length, 1);
      assert.equal(result[1].content?.length, 2);
    });

    test("removes empty messages after stripping", () => {
      const messages = [
        {
          content: [
            { reasoningContent: { reasoningText: { signature: "sig", text: "only thinking" } } },
          ],
          role: "assistant" as const,
        },
        {
          content: [{ text: "Keep this" }],
          role: "user" as const,
        },
      ];

      const result = stripThinkingContent(messages);

      assert.equal(result.length, 1);
      assert.equal(result[0].role, "user");
      assert.equal(result[0].content?.[0]?.text, "Keep this");
    });

    test("handles messages without content", () => {
      const messages = [
        { content: undefined, role: "user" as const },
        { content: [{ text: "Hello" }], role: "assistant" as const },
      ];

      const result = stripThinkingContent(messages);

      // Message without content is removed (empty content array check)
      assert.equal(result.length, 1);
      assert.equal(result[0].content?.[0]?.text, "Hello");
    });
  });

  suite("utils/tools", () => {
    test("convertTools creates Bedrock tool configuration", () => {
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Auto,
          tools: [
            {
              description: "Does something",
              inputSchema: {
                additionalProperties: false,
                properties: { x: { type: "number" } },
                required: ["x"],
                type: "object",
              },
              name: "do_something",
            },
          ],
        },
        "test.model-id",
      );

      assert.ok(out);
      assert.ok(out.tools);
      assert.ok(Array.isArray(out.tools));
      assert.equal(out.tools.length, 1);

      // Check tool spec
      const toolSpec = out.tools[0].toolSpec;
      assert.ok(toolSpec);
      assert.equal(toolSpec.name, "do_something");
      assert.equal(toolSpec.description, "Does something");
      assert.ok(toolSpec.inputSchema);
      assert.ok(toolSpec.inputSchema.json);

      // Tool choice should not be set for models that don't support it
      assert.equal(out.toolChoice, undefined);
    });

    test("convertTools sets toolChoice for models that support it", () => {
      // Test with Anthropic model (supports tool choice)
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Required,
          tools: [
            {
              description: "Only tool",
              inputSchema: { type: "object" },
              name: "only_tool",
            },
          ],
        },
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.ok(out);
      assert.ok(out.toolChoice);
      assert.deepStrictEqual(out.toolChoice, { any: {} });
    });

    test("convertTools handles Auto tool mode", () => {
      const out = convertTools(
        {
          toolMode: vscode.LanguageModelChatToolMode.Auto,
          tools: [
            {
              description: "Tool",
              inputSchema: { type: "object" },
              name: "my_tool",
            },
          ],
        },
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.ok(out);
      assert.ok(out.toolChoice);
      assert.deepStrictEqual(out.toolChoice, { auto: {} });
    });

    test("convertTools returns undefined when no tools provided", () => {
      const out = convertTools(
        {
          tools: [],
        },
        "test.model-id",
      );

      assert.equal(out, undefined);
    });
  });

  // Note: validation tests skipped - validateBedrockMessages now validates converted messages

  suite("logger", () => {
    test("logger supports all log levels", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "debug" }),
        error: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "error" }),
        info: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "info" }),
        trace: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "trace" }),
        warn: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "warn" }),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Development);

      logger.trace("Trace message");
      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warn message");
      logger.error("Error message");

      assert.equal(logs.length, 5);
      assert.equal(logs[0].level, "trace");
      assert.equal(logs[0].args[0], "Trace message");
      assert.equal(logs[1].level, "debug");
      assert.equal(logs[1].args[0], "Debug message");
      assert.equal(logs[2].level, "info");
      assert.equal(logs[2].args[0], "Info message");
      assert.equal(logs[3].level, "warn");
      assert.equal(logs[3].args[0], "Warn message");
      assert.equal(logs[4].level, "error");
      assert.equal(logs[4].args[0], "Error message");
    });

    test("logger.log (deprecated) uses info level", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "debug" }),
        error: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "error" }),
        info: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "info" }),
        trace: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "trace" }),
        warn: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "warn" }),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Production);
      logger.log("Deprecated log message", { key: "value" });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, "info");
      assert.equal(logs[0].args[0], "Deprecated log message");
      assert.deepStrictEqual(logs[0].args[1], { key: "value" });
    });

    test("logger passes structured data directly", () => {
      const logs: { args: unknown[]; level: string }[] = [];
      const mockChannel = {
        debug: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "debug" }),
        error: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "error" }),
        info: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "info" }),
        trace: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "trace" }),
        warn: (msg: string, ...args: unknown[]) =>
          logs.push({ args: [msg, ...args], level: "warn" }),
      } as unknown as vscode.LogOutputChannel;

      logger.initialize(mockChannel, vscode.ExtensionMode.Development);
      logger.info("Object test", { nested: { key: "value" } });

      assert.equal(logs.length, 1);
      assert.equal(logs[0].args[0], "Object test");
      // Structured data is preserved as an object, not formatted
      assert.deepStrictEqual(logs[0].args[1], { nested: { key: "value" } });
    });
  });

  suite("buildModelCandidates", () => {
    test("preferRegional=false (default): prioritizes global profiles", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=true: prioritizes regional profiles", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        true,
      );

      assert.equal(candidates.length, 1);

      assert.equal(
        candidates[0].modelIdToUse,
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=true, regional unavailable: falls back to global", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        true,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("preferRegional=false, global unavailable: uses regional profile", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set(["us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(
        candidates[0].modelIdToUse,
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      );

      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("uses detected regional profile when prefix differs from region prefix", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-opus-4-7")];
      const availableProfiles = new Set([
        "au.anthropic.claude-opus-4-7",
        "jp.anthropic.claude-opus-4-7",
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "ap",
        false,
        "ap-northeast-1",
      );

      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].modelIdToUse, "jp.anthropic.claude-opus-4-7");
      assert.equal(candidates[0].hasInferenceProfile, true);
    });

    test("no profiles available: uses base model", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);

      assert.equal(candidates[0].modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidates[0].hasInferenceProfile, false);
    });

    test("filters models without streaming support", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [
        {
          ...createTestModel("no-streaming-model"),
          responseStreamingSupported: false,
        },
      ];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 0);
    });

    test("filters models without TEXT output modality", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [
        {
          ...createTestModel("embedding-only-model"),
          outputModalities: ["EMBEDDING"],
        },
      ];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 0);
    });

    test("returns correct candidate structure", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const models = [model];
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const candidate = candidates[0];
      assert.ok(candidate);

      assert.equal(candidate.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");

      assert.equal(candidate.hasInferenceProfile, true);

      assert.deepStrictEqual(candidate.model, model);
    });
  });

  suite("findAlternativeProfile", () => {
    test("preferRegional=false, global fails: falls back to regional profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("global failure falls back to alternate regional profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-opus-4-7");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-opus-4-7",
      };
      const availableProfiles = new Set([
        "au.anthropic.claude-opus-4-7",
        "global.anthropic.claude-opus-4-7",
        "jp.anthropic.claude-opus-4-7",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "ap",
        availableProfiles,
        false,
        abortController.signal,
        "ap-northeast-1",
      );

      assert.equal(result.isAccessible, true);
      assert.equal(result.hasInferenceProfile, true);
      assert.equal(result.modelIdToUse, "jp.anthropic.claude-opus-4-7");
    });

    test("preferRegional=false, regional fails: falls back to global profile", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("preferRegional=true, regional fails: skips global fallback, tries base model", async () => {
      const provider = createMockClientProvider(true);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        true,
        abortController.signal,
      );

      // Should skip global profile and go directly to base model

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, false);

      assert.equal(result.modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("preferRegional=true, global fails: still tries regional fallback", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set([
        "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        true,
        abortController.signal,
      );

      // Should try regional profile even when preferRegional=true

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "us-west-2.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("no alternative profile available: falls back to base model", async () => {
      const provider = createMockClientProvider(true);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, true);

      assert.equal(result.hasInferenceProfile, false);

      assert.equal(result.modelIdToUse, "anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    test("no accessible alternative or base model: returns inaccessible", async () => {
      const provider = createMockClientProvider(false);
      const model = createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0");
      const candidate = {
        hasInferenceProfile: true,
        model,
        modelIdToUse: "global.anthropic.claude-3-5-sonnet-20241022-v2:0",
      };
      const availableProfiles = new Set(["global.anthropic.claude-3-5-sonnet-20241022-v2:0"]);
      const abortController = new AbortController();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- private-method test
      const result = await (provider as any).findAlternativeProfile(
        candidate,
        "us-west-2",
        availableProfiles,
        false,
        abortController.signal,
      );

      assert.equal(result.isAccessible, false);

      assert.equal(result.hasInferenceProfile, true);

      assert.equal(result.modelIdToUse, "global.anthropic.claude-3-5-sonnet-20241022-v2:0");
    });
  });

  suite("calculateThinkingConfig", () => {
    const thinkingProfile = { supportsThinking: true };
    const nonThinkingProfile = { supportsThinking: false };

    test("large model defaults produce 16k budget (base budget is the binding constraint)", () => {
      // Claude Sonnet 4: maxOutputTokens = 64000
      // baseBudget = 16000, maxBudgetFromOutput = 16000, visibleReserve = max(100, 16000) = 16000
      // maxTokensForRequest - visibleReserve = 64000 - 16000 = 48000
      // budgetTokens = min(16000, 16000, 48000) = 16000
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 64_000, true);
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("small explicit max_tokens disables thinking when budget < 1024", () => {
      // max_tokens = 500 → visibleReserve = max(100, 125) = 125
      // maxTokensForRequest - visibleReserve = 500 - 125 = 375
      // budgetTokens = min(16000, 16000, 375) = 375 → < 1024 → thinking disabled
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 500, true);
      assert.ok(
        result.budgetTokens < 1024,
        `Expected budgetTokens < 1024, got ${result.budgetTokens}`,
      );
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("budgetTokens never goes negative when maxTokensForRequest < visibleReserve", () => {
      // max_tokens = 50 → visibleReserve = max(100, 12) = 100
      // maxTokensForRequest - visibleReserve = 50 - 100 = -50
      // budgetTokens = max(0, min(16000, 16000, -50)) = 0
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 50, true);
      assert.equal(result.budgetTokens, 0);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("thinking disabled when model does not support it", () => {
      const result = callCalcThinkingConfig(nonThinkingProfile, 64_000, 64_000, true);
      assert.equal(result.extendedThinkingEnabled, false);
      // budgetTokens is still computed but thinking is disabled
      assert.equal(result.budgetTokens, 16_000);
    });

    test("thinking disabled when setting is off", () => {
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 64_000, false);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("reserve leaves room for visible output with moderate max_tokens", () => {
      // max_tokens = 2000 → visibleReserve = max(100, 500) = 500
      // maxTokensForRequest - visibleReserve = 2000 - 500 = 1500
      // budgetTokens = min(16000, 16000, 1500) = 1500
      // Remaining for visible output = 2000 - 1500 = 500 ≥ visibleReserve
      const result = callCalcThinkingConfig(thinkingProfile, 64_000, 2000, true);
      assert.equal(result.budgetTokens, 1500);
      assert.ok(
        2000 - result.budgetTokens >= 500,
        "Should leave at least visibleReserve tokens for visible output",
      );
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("maxBudgetFromOutput caps budget for small-output models", () => {
      // Model with maxOutputTokens = 4096
      // maxBudgetFromOutput = floor(4096 * 0.25) = 1024
      // visibleReserve = max(100, floor(4096 * 0.25)) = 1024
      // maxTokensForRequest - visibleReserve = 4096 - 1024 = 3072
      // budgetTokens = min(16000, 1024, 3072) = 1024
      const result = callCalcThinkingConfig(thinkingProfile, 4096, 4096, true);
      assert.equal(result.budgetTokens, 1024);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("very small model output disables thinking (budget below 1024 threshold)", () => {
      // Model with maxOutputTokens = 2000
      // maxBudgetFromOutput = floor(2000 * 0.25) = 500
      // budgetTokens = min(16000, 500, ...) = at most 500 → < 1024
      const result = callCalcThinkingConfig(thinkingProfile, 2000, 2000, true);
      assert.ok(result.budgetTokens < 1024);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("budget math when maxTokensForRequest falls back to maxOutputTokens (no explicit max_tokens)", () => {
      // Simulates the case where VSCode doesn't provide max_tokens
      // and maxTokensForRequest falls back to model.maxOutputTokens
      const maxOutput = 128_000; // Claude Opus 4.6
      const result = callCalcThinkingConfig(thinkingProfile, maxOutput, maxOutput, true);
      // baseBudget = 16000, maxBudgetFromOutput = 32000, visibleReserve = 32000
      // maxTokensForRequest - visibleReserve = 128000 - 32000 = 96000
      // budgetTokens = min(16000, 32000, 96000) = 16000
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
    });
  });

  suite("buildConfigurationSchema", () => {
    test("returns undefined for models with no configurable options (Nova Lite)", () => {
      // Nova Lite: 300K context, 8192 output — no thinking, no reasoning, no 1M opt-in
      const schema = callBuildConfigurationSchema("amazon.nova-lite-v1:0");
      assert.equal(schema, undefined);
    });

    test("returns contextSize picker for Opus 4.6 (optional 1M context)", () => {
      // Opus 4.6 default: 200K context window (full, not context-output)
      const schema = callBuildConfigurationSchema("anthropic.claude-opus-4-6-v1");
      assert.ok(schema?.properties?.contextSize, "should have contextSize property");
      const cs = schema.properties.contextSize;
      assert.deepEqual(cs.enum, [200_000, 1_000_000]);
      assert.equal(cs.type, "number");
      assert.equal(cs.group, "tokens");
    });

    test("returns NO contextSize picker for Opus 4.7 (always 1M context)", () => {
      // Opus 4.7: 1M context is always-on — no picker needed
      const schema = callBuildConfigurationSchema("anthropic.claude-opus-4-7-20260420-v1:0");
      assert.equal(
        schema?.properties?.contextSize,
        undefined,
        "Opus 4.7 always uses 1M — no picker needed",
      );
    });

    test("returns thinkingEffort picker for Sonnet 4.6 (supportsThinkingEffort)", () => {
      // Sonnet 4.6 default: 200K context window
      const schema = callBuildConfigurationSchema("anthropic.claude-sonnet-4-6");
      assert.ok(schema?.properties?.thinkingEffort, "should have thinkingEffort property");
      const te = schema.properties.thinkingEffort;
      assert.deepEqual(te.enum, ["low", "medium", "high"]);
      assert.equal(te.group, "navigation");
      assert.equal(te.default, "high");
    });

    test("returns NO thinkingEffort picker for Sonnet 3.7 (thinking but not effort)", () => {
      const schema = callBuildConfigurationSchema("anthropic.claude-3-7-sonnet-20250219-v1:0");
      assert.equal(schema?.properties?.thinkingEffort, undefined);
    });

    test("returns reasoningEffort picker for DeepSeek V3.2 (supportsReasoningEffort)", () => {
      const schema = callBuildConfigurationSchema("deepseek.deepseek-v3-2-20250615");
      assert.ok(schema?.properties?.reasoningEffort, "should have reasoningEffort property");
      const re = schema.properties.reasoningEffort;
      assert.deepEqual(re.enum, ["low", "medium", "high"]);
      assert.equal(re.group, "navigation");
    });

    test("includes minimal effort level for OpenAI gpt-oss", () => {
      const schema = callBuildConfigurationSchema("openai.gpt-oss-20b");
      assert.ok(schema?.properties?.reasoningEffort);
      assert.deepEqual(schema.properties.reasoningEffort.enum, [
        "minimal",
        "low",
        "medium",
        "high",
      ]);
    });

    test("Sonnet 4.6 has no contextSize picker (always-1M) but has thinkingEffort picker", () => {
      // Sonnet 4.6 is always-1M — no optional context extension, so no picker.
      const schema = callBuildConfigurationSchema("anthropic.claude-sonnet-4-6");
      assert.equal(schema?.properties?.contextSize, undefined, "should NOT have contextSize");
      assert.ok(schema?.properties?.thinkingEffort, "should have thinkingEffort");
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });

    test("Sonnet 4.5 returns contextSize picker and thinkingEffort picker", () => {
      // Sonnet 4.5 has optional 1M via beta header, and supports extended thinking.
      const schema = callBuildConfigurationSchema("anthropic.claude-sonnet-4-5-20250929-v1:0");
      assert.ok(schema?.properties?.contextSize, "should have contextSize");
      // Sonnet 4.5 supports thinking (supportsThinking) but not thinkingEffort
      // (effort control is only on Opus 4.5/4.6/4.8 and Sonnet 4.6)
      assert.equal(schema?.properties?.thinkingEffort, undefined);
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });
  });

  suite("modelConfiguration overrides in provideLanguageModelChatResponse", () => {
    // These tests verify that modelConfiguration values from the VS Code model
    // picker are correctly applied as per-request overrides. We test the
    // buildRequestInput pathway since provideLanguageModelChatResponse requires
    // live AWS credentials for the full path.

    test("modelOptions.max_tokens is respected (existing behaviour)", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-sonnet-4-6", {
        modelOptions: { max_tokens: 8192 },
      });
      assert.equal(requestInput.inferenceConfig?.maxTokens, 8192);
    });

    test("buildBetaHeaders uses context1MEnabled=true when contextSize=1M is selected", () => {
      const provider = providerInternals(
        new BedrockChatModelProvider(mockSecretStorage, mockGlobalState),
      );
      // Use Sonnet 4.5 — it has optional 1M (requires beta header) unlike Sonnet 4.6 (always-1M).
      const modelId = "anthropic.claude-sonnet-4-5-20250929-v1:0";
      const profile = getModelProfile(modelId);

      // With context1MEnabled = false (default) — no 1M beta header
      const headersDefault = provider.buildBetaHeaders(profile, modelId, false, false, false);
      assert.equal(headersDefault.includes("context-1m-2025-08-07"), false);

      // With context1MEnabled = true (as set when contextSize picker selects 1M)
      const headersWith1M = provider.buildBetaHeaders(profile, modelId, false, true, false);
      assert.equal(headersWith1M.includes("context-1m-2025-08-07"), true);
    });
  });

  suite("buildRequestInput", () => {
    test("omits temperature for Claude Opus 4.7", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-7-v1:0", {
        modelOptions: { temperature: 0.2 },
      });

      assert.equal(requestInput.inferenceConfig?.temperature, undefined);
      assert.equal(requestInput.inferenceConfig?.maxTokens, 64_000);
    });

    test("omits temperature for Claude Opus 4.7 extended thinking requests", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-7-v1:0", {}, true);

      assert.equal(requestInput.inferenceConfig?.temperature, undefined);
    });

    test("preserves temperature for models that still support it", () => {
      const requestInput = callBuildRequestInput("global.anthropic.claude-opus-4-6-v1:0", {
        modelOptions: { temperature: 0.2 },
      });

      assert.equal(requestInput.inferenceConfig?.temperature, 0.2);
    });
  });

  suite("resolveModelLimits", () => {
    test("uses models.dev limits when available — Sonnet 4.6 is always-1M", () => {
      // models.dev says Sonnet 4.6 has 1M context / 64K output (always-on, no beta header).
      // context1M.enabled flag has no effect — 1M is the default.
      const map = makeDevMapEntry("anthropic.claude-sonnet-4-6", 1_000_000, 64_000);
      const withoutExtended = callResolveModelLimits("anthropic.claude-sonnet-4-6", false, map);
      assert.equal(withoutExtended.maxOutputTokens, 64_000);
      assert.equal(withoutExtended.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K

      const withExtended = callResolveModelLimits("anthropic.claude-sonnet-4-6", true, map);
      assert.equal(withExtended.maxOutputTokens, 64_000);
      assert.equal(withExtended.maxInputTokens, 1_000_000 - 64_000); // same — always 1M
    });

    test("uses models.dev limits — Sonnet 4.5 is optional-1M (capped at 200K when disabled)", () => {
      // Sonnet 4.5 has optional 1M via beta header.
      const map = makeDevMapEntry("anthropic.claude-sonnet-4-5-20250929-v1:0", 1_000_000, 64_000);
      const withoutExtended = callResolveModelLimits(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        false,
        map,
      );
      assert.equal(withoutExtended.maxOutputTokens, 64_000);
      assert.equal(withoutExtended.maxInputTokens, 200_000 - 64_000); // capped at 200K

      const withExtended = callResolveModelLimits(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        true,
        map,
      );
      assert.equal(withExtended.maxOutputTokens, 64_000);
      assert.equal(withExtended.maxInputTokens, 1_000_000 - 64_000); // 1M when enabled
    });

    test("uses models.dev limits for always-1M models (Opus 4.7)", () => {
      // Opus 4.7 doesn't require beta header — 1M is always-on.
      // maxInputTokens = 1M - 128K (input budget; picker shows 1M total).
      const map = makeDevMapEntry("anthropic.claude-opus-4-7", 1_000_000, 128_000);
      const result = callResolveModelLimits("anthropic.claude-opus-4-7", false, map);
      assert.equal(result.maxOutputTokens, 128_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 128_000); // input budget = 1M - 128K
    });

    test("uses models.dev limits for non-Claude models (Nova Pro)", () => {
      // Nova Pro: 300K context window, 8192 output.
      const map = makeDevMapEntry("amazon.nova-pro-v1:0", 300_000, 8192);
      const result = callResolveModelLimits("amazon.nova-pro-v1:0", false, map);
      assert.equal(result.maxOutputTokens, 8192);
      assert.equal(result.maxInputTokens, 300_000 - 8192); // input budget = 300K - 8K
    });

    test("falls back to getModelTokenLimits for unknown models", () => {
      const result = callResolveModelLimits("anthropic.claude-sonnet-4-6", false, new Map());
      // Hardcoded fallback: Sonnet 4.6 → always-1M, 64K output
      assert.equal(result.maxOutputTokens, 64_000);
      assert.equal(result.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K
    });

    test("strips regional prefix when looking up models.dev entry", () => {
      // models.dev has bare ID; model ID has regional prefix
      const map = makeDevMapEntry("anthropic.claude-sonnet-4-6", 1_000_000, 64_000);
      const result = callResolveModelLimits("us.anthropic.claude-sonnet-4-6", true, map);
      assert.equal(result.maxInputTokens, 1_000_000 - 64_000); // always 1M - 64K
    });
  });

  suite("buildConfigurationSchema with models.dev data", () => {
    test("reasoningEffort picker appears for new non-Anthropic reasoning model via models.dev", () => {
      // Simulate a brand-new model not in profiles.ts but present in models.dev
      const devMap: ModelsDevMap = new Map([
        [
          "newprovider.new-reasoning-model",
          { limit: { context: 100_000, output: 8000 }, reasoning: true },
        ],
      ]);
      const schema = callBuildConfigurationSchema("newprovider.new-reasoning-model", devMap);
      assert.ok(schema?.properties?.reasoningEffort);
    });

    test("reasoningEffort picker does NOT appear for Anthropic models via models.dev reasoning flag", () => {
      // Anthropic models use thinkingEffort, not reasoningEffort
      const devMap: ModelsDevMap = new Map([
        [
          "anthropic.claude-sonnet-4-6",
          { limit: { context: 1_000_000, output: 64_000 }, reasoning: true },
        ],
      ]);
      const schema = callBuildConfigurationSchema("anthropic.claude-sonnet-4-6", devMap);
      assert.equal(schema?.properties?.reasoningEffort, undefined);
    });
  });

  suite("normalizeModelId", () => {
    test("strips 2-char ISO region prefix", () => {
      assert.equal(
        normalizeModelId("us.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
      assert.equal(normalizeModelId("eu.anthropic.claude-opus-4-7"), "anthropic.claude-opus-4-7");
      assert.equal(
        normalizeModelId("ap.anthropic.claude-haiku-4-5-20251001-v1:0"),
        "anthropic.claude-haiku-4-5-20251001-v1:0",
      );
    });

    test("strips global prefix", () => {
      assert.equal(
        normalizeModelId("global.anthropic.claude-opus-4-6-v1"),
        "anthropic.claude-opus-4-6-v1",
      );
    });

    test("strips GovCloud prefixes (us-gov-east, us-gov-west)", () => {
      assert.equal(
        normalizeModelId("us-gov-east.anthropic.claude-sonnet-4-5-20250929-v1:0"),
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
      );
      assert.equal(
        normalizeModelId("us-gov-west.anthropic.claude-haiku-4-5-20251001-v1:0"),
        "anthropic.claude-haiku-4-5-20251001-v1:0",
      );
    });

    test("strips China region prefixes (cn-north, cn-northwest)", () => {
      assert.equal(
        normalizeModelId("cn-north.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
      assert.equal(
        normalizeModelId("cn-northwest.anthropic.claude-opus-4-7"),
        "anthropic.claude-opus-4-7",
      );
    });

    test("strips apac alias prefix", () => {
      assert.equal(
        normalizeModelId("apac.anthropic.claude-sonnet-4-6"),
        "anthropic.claude-sonnet-4-6",
      );
    });

    test("leaves bare model IDs unchanged", () => {
      assert.equal(normalizeModelId("anthropic.claude-sonnet-4-6"), "anthropic.claude-sonnet-4-6");
      assert.equal(normalizeModelId("amazon.nova-pro-v1:0"), "amazon.nova-pro-v1:0");
    });

    test("leaves short IDs with only two segments unchanged", () => {
      assert.equal(normalizeModelId("amazon.titan"), "amazon.titan");
    });
  });

  suite("buildPricingFields", () => {
    test("returns empty object when model not in map", () => {
      assert.deepEqual(callBuildPricingFields("anthropic.claude-sonnet-4-6", new Map()), {});
    });

    test("returns empty object when cost field missing", () => {
      const map = makeDevMapEntry("anthropic.claude-sonnet-4-6", 200_000, 4096);
      assert.deepEqual(callBuildPricingFields("anthropic.claude-sonnet-4-6", map), {});
    });

    test("converts USD to credits (×100) for exact model ID match", () => {
      // $3.00/1M input, $15.00/1M output in USD → 300/1500 credits
      const map = makeDevMapWithCost([
        ["anthropic.claude-sonnet-4-6", { cacheRead: 0.3, input: 3, output: 15 }],
      ]);
      const result = callBuildPricingFields("anthropic.claude-sonnet-4-6", map);
      assert.equal(result.inputCost, 300);
      assert.equal(result.outputCost, 1500);
      assert.equal(result.cacheCost, 30);
      assert.equal(result.pricing, "$3.00 in · $15.00 out / 1M tokens");
      assert.equal(result.priceCategory, "high"); // avg = (3+15)/2 = 9
    });

    test("falls back via normalizeModelId scan when exact match missing", () => {
      // stored under us. prefix, looked up with eu. prefix
      const map = makeDevMapWithCost([
        ["us.anthropic.claude-sonnet-4-6", { input: 3, output: 15 }],
      ]);
      assert.equal(callBuildPricingFields("eu.anthropic.claude-sonnet-4-6", map)?.inputCost, 300);
    });

    test("priceCategory low for cheap models (avg ≤$0.50/1M)", () => {
      // Nova Micro: $0.035 in / $0.14 out → avg=$0.0875 → low
      const map = makeDevMapWithCost([["amazon.nova-micro-v1:0", { input: 0.035, output: 0.14 }]]);
      assert.equal(callBuildPricingFields("amazon.nova-micro-v1:0", map).priceCategory, "low");
    });

    test("priceCategory medium for mid-range models (avg ≤$5/1M)", () => {
      // $1/1M in, $3/1M out → avg=$2 → medium
      const map = makeDevMapWithCost([["amazon.nova-pro-v1:0", { input: 1, output: 3 }]]);
      assert.equal(callBuildPricingFields("amazon.nova-pro-v1:0", map).priceCategory, "medium");
    });

    test("priceCategory very_high for expensive models (avg >$20/1M)", () => {
      // Opus: $15 in / $75 out → avg=$45 → very_high
      const map = makeDevMapWithCost([["anthropic.claude-opus-4", { input: 15, output: 75 }]]);
      assert.equal(
        callBuildPricingFields("anthropic.claude-opus-4", map).priceCategory,
        "very_high",
      );
    });

    test("formats small USD prices with 4 decimal places", () => {
      // $0.035/1M → "$0.0350" (4dp for sub-$0.10 prices)
      const map = makeDevMapWithCost([["amazon.nova-micro-v1:0", { input: 0.035, output: 0.14 }]]);
      const result = callBuildPricingFields("amazon.nova-micro-v1:0", map);
      assert.ok(
        result.pricing?.includes("$0.0350"),
        `Expected '$0.0350' in pricing, got: ${result.pricing}`,
      );
    });

    test("omits cacheCost when not in pricing data", () => {
      const map = makeDevMapWithCost([["deepseek.r1", { input: 1.35, output: 5.4 }]]);
      assert.equal(callBuildPricingFields("deepseek.r1", map).cacheCost, undefined);
    });
  });
});
