import * as assert from "assert";
import * as vscode from "vscode";
import { BedrockChatModelProvider } from "../provider";
import { validateRequest } from "../validation";
import { convertTools } from "../converters/tools";
import { convertMessages } from "../converters/messages";




suite("HuggingFace Chat Provider Extension", () => {
	suite("provider", () => {
		test("prepareLanguageModelChatInformation returns array (no key -> empty)", async () => {
			const provider = new BedrockChatModelProvider({
				get: async () => undefined,
                keys: () => [],
                update: async () => {}
			}, "GitHubCopilotChat/test VSCode/test");

			const infos = await provider.prepareLanguageModelChatInformation(
				{ silent: true },
				new vscode.CancellationTokenSource().token
			);
			assert.ok(Array.isArray(infos));
		});

		test("provideTokenCount counts simple string", async () => {
			const provider = new BedrockChatModelProvider({
				get: async () => undefined,
				keys: () => [],
                update: async () => {}
			} , "GitHubCopilotChat/test VSCode/test");

			const est = await provider.provideTokenCount(
				{
					capabilities: {},
					family: "huggingface",
					id: "m",
					maxInputTokens: 1000,
					maxOutputTokens: 1000,
					name: "m",
					version: "1.0.0",
				} as unknown as vscode.LanguageModelChatInformation,
				"hello world",
				new vscode.CancellationTokenSource().token
			);
			assert.equal(typeof est, "number");
			assert.ok(est > 0);
		});
	});

	suite.skip("utils/convertMessages", () => {
		test("maps user/assistant text", () => {
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
			const out = convertMessages(messages, 'modelId');
			assert.deepEqual(out, [
				{ content: "hi", role: "user" },
				{ content: "hello", role: "assistant" },
			]);
		});


		test("handles mixed text + tool calls in one assistant message", () => {
			const toolCall = new vscode.LanguageModelToolCallPart("call1", "search", { q: "hello" });
			const msg: vscode.LanguageModelChatMessage = {
				content: [
					new vscode.LanguageModelTextPart("before "),
					toolCall,
					new vscode.LanguageModelTextPart(" after"),
				],
				name: undefined,
				role: vscode.LanguageModelChatMessageRole.Assistant,
			};
			const out = convertMessages([msg], 'modelId');
			assert.equal(out.messages.length, 1);
			assert.equal(out.messages[0].role, "assistant");
			assert.ok(out.messages[0].content?.[0]?.text?.includes("before"));
			assert.ok(out.messages[0].content?.[0]?.text?.includes("after"));
		});
	});

	suite.skip("utils/tools", () => {
		test("convertTools returns function tool definitions", () => {
			const out = convertTools({
                toolMode: vscode.LanguageModelChatToolMode.Auto,
				tools: [
					{
						description: "Does something",
						inputSchema: { additionalProperties: false, properties: { x: { type: "number" } }, type: "object" },
						name: "do_something",
					},
				],
			} satisfies vscode.LanguageModelChatRequestOptions, 'modelId');

			assert.ok(out);
			assert.equal(out.toolChoice, "auto");
			assert.ok(Array.isArray(out.tools) && out.tools[0].toolSpec?.name === "function");
			assert.equal(out.tools[0].toolSpec?.name, "do_something");
		});

		test("convertTools respects ToolMode.Required for single tool", () => {
			const out = convertTools({
				toolMode: vscode.LanguageModelChatToolMode.Required,
				tools: [
					{
						description: "Only tool",
						inputSchema: {},
						name: "only_tool",
					},
				],
			} satisfies vscode.LanguageModelChatRequestOptions, "modelId");
			assert.deepEqual(out?.toolChoice, { function: { name: "only_tool" }, type: "function" });
		});


	});

	suite.skip("utils/validation", () => {
		test("validateRequest enforces tool result pairing", () => {
			const callId = "xyz";
			const toolCall = new vscode.LanguageModelToolCallPart(callId, "toolA", { q: 1 });
			const toolRes = new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart("ok")]);
			const valid: vscode.LanguageModelChatMessage[] = [
				{ content: [toolCall], name: undefined, role: vscode.LanguageModelChatMessageRole.Assistant },
				{ content: [toolRes], name: undefined, role: vscode.LanguageModelChatMessageRole.User },
			];
			assert.doesNotThrow(() => validateRequest(valid));

			const invalid: vscode.LanguageModelChatMessage[] = [
				{ content: [toolCall], name: undefined, role: vscode.LanguageModelChatMessageRole.Assistant },
				{ content: [new vscode.LanguageModelTextPart("missing")], name: undefined, role: vscode.LanguageModelChatMessageRole.User },
			];
			assert.throws(() => validateRequest(invalid));
		});
	});


});