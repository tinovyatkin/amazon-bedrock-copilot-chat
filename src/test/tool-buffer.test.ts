import * as assert from "node:assert";
import * as vscode from "vscode";

import { logger } from "../logger";
import { ToolBuffer } from "../tool-buffer";

// Shared mock channel factory used across suites
function makeMockChannel() {
  const logs: { args: unknown[]; level: string }[] = [];
  const channel = {
    debug: (msg: string, ...args: unknown[]) => logs.push({ args: [msg, ...args], level: "debug" }),
    error: (msg: string, ...args: unknown[]) => logs.push({ args: [msg, ...args], level: "error" }),
    info: (msg: string, ...args: unknown[]) => logs.push({ args: [msg, ...args], level: "info" }),
    trace: (msg: string, ...args: unknown[]) => logs.push({ args: [msg, ...args], level: "trace" }),
    warn: (msg: string, ...args: unknown[]) => logs.push({ args: [msg, ...args], level: "warn" }),
  } as unknown as vscode.LogOutputChannel;
  return { channel, logs };
}

suite("ToolBuffer", () => {
  suite("startTool / appendInput / finalizeTool – happy path", () => {
    test("finalizeTool returns parsed tool call for valid JSON", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"key":');
      buf.appendInput(0, '"value"}');

      const result = buf.finalizeTool(0);

      assert.ok(result, "Expected a tool call to be returned");
      assert.equal(result.id, "call-1");
      assert.equal(result.name, "my_tool");
      assert.deepStrictEqual(result.input, { key: "value" });
    });

    test("finalizeTool returns undefined when tool was never started", () => {
      const buf = new ToolBuffer();
      const result = buf.finalizeTool(99);
      assert.equal(result, undefined);
    });

    test("finalizeTool returns undefined when inputBuffer is empty string", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      // inputBuffer is "" — JSON.parse("") throws, so finalize should return undefined
      const result = buf.finalizeTool(0);
      assert.equal(result, undefined);
    });

    test("finalizeTool clears internal state on success", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"a":1}');
      buf.finalizeTool(0);

      // A second call must return undefined — state was cleared
      const second = buf.finalizeTool(0);
      assert.equal(second, undefined);
    });

    test("multiple tools at different indices are independent", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "id-0", "tool_a");
      buf.startTool(1, "id-1", "tool_b");
      buf.appendInput(0, '{"x":1}');
      buf.appendInput(1, '{"y":2}');

      const r0 = buf.finalizeTool(0);
      const r1 = buf.finalizeTool(1);

      assert.ok(r0);
      assert.equal(r0.name, "tool_a");
      assert.deepStrictEqual(r0.input, { x: 1 });
      assert.ok(r1);
      assert.equal(r1.name, "tool_b");
      assert.deepStrictEqual(r1.input, { y: 2 });
    });
  });

  suite("finalizeTool – JSON parse failure cleanup", () => {
    test("returns undefined on invalid JSON", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, "{bad json}");

      const result = buf.finalizeTool(0);
      assert.equal(result, undefined);
    });

    test("clears internal buffers after parse failure so state is not stale", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, "{bad json}");
      buf.finalizeTool(0);

      // After failure the slot must be clean — a second finalize returns undefined
      const second = buf.finalizeTool(0);
      assert.equal(second, undefined);

      // Re-using the same index with fresh data must work correctly
      buf.startTool(0, "call-2", "my_tool");
      buf.appendInput(0, '{"ok":true}');
      const fresh = buf.finalizeTool(0);
      assert.ok(fresh);
      assert.deepStrictEqual(fresh.input, { ok: true });
    });

    test("parse failure emits warn log with tool name, id, and input length — no raw content", () => {
      const { channel, logs } = makeMockChannel();
      logger.initialize(channel, vscode.ExtensionMode.Production);

      const sensitiveInput = '{"token":"super-secret","file":"' + "A".repeat(300) + '"}';
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, sensitiveInput.slice(0, 10)); // truncate to make it invalid JSON

      buf.finalizeTool(0);

      const warnLogs = logs.filter((l) => l.level === "warn");
      assert.equal(warnLogs.length, 1, "Expected exactly one warn log entry");

      const msg = warnLogs[0].args[0] as string;
      assert.ok(msg.includes("my_tool"), "warn should include tool name");
      assert.ok(msg.includes("call-1"), "warn should include tool id");
      assert.ok(msg.includes("Input length:"), "warn should include input length");
      // Must NOT contain the raw token value
      assert.ok(!msg.includes("super-secret"), "warn must not expose raw input content");
    });

    test("parse failure emits trace log with truncated, newline-sanitized preview", () => {
      const { channel, logs } = makeMockChannel();
      logger.initialize(channel, vscode.ExtensionMode.Development);

      // Build input that is longer than 200 chars and contains newlines
      const inputWithNewlines = '{"a":\n"b",\n' + "x".repeat(250);
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, inputWithNewlines);

      buf.finalizeTool(0);

      const traceLogs = logs.filter((l) => l.level === "trace");
      assert.equal(traceLogs.length, 1, "Expected exactly one trace log entry");

      const traceMsg = traceLogs[0].args[0] as string;
      // Newlines must be escaped in the preview
      assert.ok(!traceMsg.includes("\n"), "trace preview must not contain raw newlines");
      // The escaped newline sequence should appear instead
      assert.ok(traceMsg.includes(String.raw`\n`), "trace preview should contain escaped newlines");
      // The full message should reference the tool name and id
      assert.ok(traceMsg.includes("my_tool"), "trace should include tool name");
      assert.ok(traceMsg.includes("call-1"), "trace should include tool id");
      // The preview portion is capped at 200 chars of the original input —
      // the full message is longer (it contains the prefix), but the preview
      // itself should not exceed 200 source chars (even after \\n expansion each
      // \n becomes 2 chars, so allow some slack).
      assert.ok(traceMsg.length < 300, "total trace message should be reasonably short");
    });
  });

  suite("tryGetValidTool", () => {
    test("returns undefined while JSON is still incomplete", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"key":');

      const result = buf.tryGetValidTool(0);
      assert.equal(result, undefined);
    });

    test("returns parsed tool once JSON is complete without removing from buffer", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"key":"val"}');

      const result = buf.tryGetValidTool(0);
      assert.ok(result);
      assert.deepStrictEqual(result.input, { key: "val" });

      // Buffer must still be intact — finalizeTool should also succeed
      const finalized = buf.finalizeTool(0);
      assert.ok(finalized);
      assert.deepStrictEqual(finalized.input, { key: "val" });
    });

    test("returns undefined when tool does not exist", () => {
      const buf = new ToolBuffer();
      const result = buf.tryGetValidTool(42);
      assert.equal(result, undefined);
    });
  });

  suite("isEmitted / markEmitted", () => {
    test("isEmitted returns false before markEmitted", () => {
      const buf = new ToolBuffer();
      assert.equal(buf.isEmitted(0), false);
    });

    test("isEmitted returns true after markEmitted", () => {
      const buf = new ToolBuffer();
      buf.markEmitted(0);
      assert.equal(buf.isEmitted(0), true);
    });

    test("markEmitted does not affect other indices", () => {
      const buf = new ToolBuffer();
      buf.markEmitted(1);
      assert.equal(buf.isEmitted(0), false);
      assert.equal(buf.isEmitted(2), false);
    });
  });

  suite("clear", () => {
    test("clear removes all tools, buffers, and emitted state", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"a":1}');
      buf.markEmitted(0);

      buf.clear();

      assert.equal(buf.finalizeTool(0), undefined, "tools map should be empty after clear");
      assert.equal(buf.isEmitted(0), false, "emittedIndices should be empty after clear");
    });

    test("buffer is reusable after clear", () => {
      const buf = new ToolBuffer();
      buf.startTool(0, "call-1", "my_tool");
      buf.appendInput(0, '{"a":1}');
      buf.clear();

      buf.startTool(0, "call-2", "new_tool");
      buf.appendInput(0, '{"b":2}');
      const result = buf.finalizeTool(0);

      assert.ok(result);
      assert.equal(result.name, "new_tool");
      assert.deepStrictEqual(result.input, { b: 2 });
    });
  });
});
