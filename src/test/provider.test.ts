import * as assert from "node:assert";
import * as vscode from "vscode";
import { convertMessages } from "../converters/messages";
import { convertTools } from "../converters/tools";
import { logger } from "../logger";
import { BedrockChatModelProvider } from "../provider";

// Mock implementations extracted to avoid function nesting depth issues
const mockSecretStorage: vscode.SecretStorage = {
  delete: async () => {},
  get: async () => undefined as string | undefined,
  onDidChange: () => ({ dispose: () => {} }),
  store: async () => {},
};

const mockGlobalState: vscode.Memento = {
  get: async () => {},
  keys: () => [],
  update: async () => {},
} as unknown as vscode.Memento;

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
});
