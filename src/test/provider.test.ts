import { ModelModality } from "@aws-sdk/client-bedrock";
import type { ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import * as assert from "node:assert";
import * as vscode from "vscode";
import { convertMessages, stripThinkingContent } from "../converters/messages";
import { convertTools } from "../converters/tools";
import { logger } from "../logger";
import { BedrockChatModelProvider } from "../provider";
import type { BedrockModelSummary } from "../types";

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
} as unknown as vscode.Memento;

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
  modelLimits: { maxOutputTokens: number },
  maxTokensForRequest: number,
  thinkingEnabled: boolean,
) => {
  const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
  return (provider as any).calculateThinkingConfig(
    modelProfile,
    modelLimits,
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
  return (provider as any).buildRequestInput(
    {
      capabilities: {},
      family: "bedrock",
      id: modelId,
      maxInputTokens: 200_000,
      maxOutputTokens: 64_000,
      name: modelId,
      version: "1.0.0",
    } as unknown as vscode.LanguageModelChatInformation,
    { messages: [], system: [] },
    options,
    undefined,
    extendedThinkingEnabled,
    4096,
    [],
    undefined,
  ) as ConverseStreamCommandInput;
};

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
        } as unknown as vscode.LanguageModelChatInformation,
        "hello world",
        new vscode.CancellationTokenSource().token,
      );
      assert.equal(typeof est, "number");
      assert.ok(est > 0);
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

      const result = stripThinkingContent(messages as any);

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
        } as vscode.LanguageModelChatRequestOptions,
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
        } as vscode.LanguageModelChatRequestOptions,
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
        } as vscode.LanguageModelChatRequestOptions,
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
        } as vscode.LanguageModelChatRequestOptions,
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

    test("no profiles available: uses base model", () => {
      const provider = new BedrockChatModelProvider(mockSecretStorage, mockGlobalState);
      const models = [createTestModel("anthropic.claude-3-5-sonnet-20241022-v2:0")];
      const availableProfiles = new Set<string>();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const candidates = (provider as any).buildModelCandidates(
        models,
        availableProfiles,
        "us-west-2",
        false,
      );

      assert.equal(candidates.length, 1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      const result = callCalcThinkingConfig(
        thinkingProfile,
        { maxOutputTokens: 64_000 },
        64_000,
        true,
      );
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("small explicit max_tokens disables thinking when budget < 1024", () => {
      // max_tokens = 500 → visibleReserve = max(100, 125) = 125
      // maxTokensForRequest - visibleReserve = 500 - 125 = 375
      // budgetTokens = min(16000, 16000, 375) = 375 → < 1024 → thinking disabled
      const result = callCalcThinkingConfig(
        thinkingProfile,
        { maxOutputTokens: 64_000 },
        500,
        true,
      );
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
      const result = callCalcThinkingConfig(thinkingProfile, { maxOutputTokens: 64_000 }, 50, true);
      assert.equal(result.budgetTokens, 0);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("thinking disabled when model does not support it", () => {
      const result = callCalcThinkingConfig(
        nonThinkingProfile,
        { maxOutputTokens: 64_000 },
        64_000,
        true,
      );
      assert.equal(result.extendedThinkingEnabled, false);
      // budgetTokens is still computed but thinking is disabled
      assert.equal(result.budgetTokens, 16_000);
    });

    test("thinking disabled when setting is off", () => {
      const result = callCalcThinkingConfig(
        thinkingProfile,
        { maxOutputTokens: 64_000 },
        64_000,
        false,
      );
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("reserve leaves room for visible output with moderate max_tokens", () => {
      // max_tokens = 2000 → visibleReserve = max(100, 500) = 500
      // maxTokensForRequest - visibleReserve = 2000 - 500 = 1500
      // budgetTokens = min(16000, 16000, 1500) = 1500
      // Remaining for visible output = 2000 - 1500 = 500 ≥ visibleReserve
      const result = callCalcThinkingConfig(
        thinkingProfile,
        { maxOutputTokens: 64_000 },
        2000,
        true,
      );
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
      const result = callCalcThinkingConfig(thinkingProfile, { maxOutputTokens: 4096 }, 4096, true);
      assert.equal(result.budgetTokens, 1024);
      assert.equal(result.extendedThinkingEnabled, true);
    });

    test("very small model output disables thinking (budget below 1024 threshold)", () => {
      // Model with maxOutputTokens = 2000
      // maxBudgetFromOutput = floor(2000 * 0.25) = 500
      // budgetTokens = min(16000, 500, ...) = at most 500 → < 1024
      const result = callCalcThinkingConfig(thinkingProfile, { maxOutputTokens: 2000 }, 2000, true);
      assert.ok(result.budgetTokens < 1024);
      assert.equal(result.extendedThinkingEnabled, false);
    });

    test("budget math when maxTokensForRequest falls back to maxOutputTokens (no explicit max_tokens)", () => {
      // Simulates the case where VSCode doesn't provide max_tokens
      // and maxTokensForRequest falls back to modelLimits.maxOutputTokens
      const maxOutput = 128_000; // Claude Opus 4.6
      const result = callCalcThinkingConfig(
        thinkingProfile,
        { maxOutputTokens: maxOutput },
        maxOutput,
        true,
      );
      // baseBudget = 16000, maxBudgetFromOutput = 32000, visibleReserve = 32000
      // maxTokensForRequest - visibleReserve = 128000 - 32000 = 96000
      // budgetTokens = min(16000, 32000, 96000) = 16000
      assert.equal(result.budgetTokens, 16_000);
      assert.equal(result.extendedThinkingEnabled, true);
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
});
