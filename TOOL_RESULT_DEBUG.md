# Tool Result Debugging - Changes Made

## Problem Identified

The log analysis revealed that the OpenAI model (`openai.gpt-oss-120b-1:0`) was:

1. Making 25 tool calls in a single response
2. Emitting reasoning content blocks BETWEEN tool calls
3. Those reasoning blocks were being displayed as regular text in the UI
4. This caused all tool calls to batch together at the end instead of streaming naturally

## Fixes Applied

### 1. Added OpenAI Model Profile (`src/profiles.ts`)

```typescript
case "openai":
  return {
    supportsPromptCaching: false,  // OpenAI doesn't support prompt caching via Bedrock
    supportsToolChoice: true,
    toolResultFormat: "text",
  };
```

**Why**: OpenAI models were falling back to default profile, which may have incorrect settings.

### 2. Stopped Emitting Reasoning Content (`src/stream-processor.ts`)

**Before:**

```typescript
progress.report(new vscode.LanguageModelTextPart(reasoningText));
```

**After:**

```typescript
// Reasoning content is logged but NOT emitted to avoid interference
logger.trace("[Stream Processor] Reasoning content delta received (not emitting)");
```

**Why**: Reasoning content interferes with tool call streaming and doesn't match native Copilot behavior. The reasoning was appearing as text between tool calls, causing the UI to display all text first, then batch all tool calls.

### 3. Enhanced Logging for Tool Results

Added detailed logging in three places:

#### a. Message Converter (`src/converters/messages.ts` lines 63-87)

```typescript
logger.debug("[Message Converter] Processing tool result:", {
  callId: part.callId,
  contentType: typeof part.content,
  isArray: Array.isArray(part.content),
  textLength: textContent.length,
  textPreview: textContent.substring(0, 200),
});

logger.debug("[Message Converter] Created Bedrock tool result:", {
  toolUseId: part.callId,
  format: isJson ? "json" : "text",
  status,
  hasContent: contentBlock ? true : false,
});
```

#### b. Provider Message Logging (`src/provider.ts` lines 244-261)

Already enhanced to show tool result details including content preview.

#### c. Bedrock Request Logging (`src/provider.ts` lines 354-359)

```typescript
if (c.toolResult) {
  const preview =
    c.toolResult.content?.[0]?.text?.substring(0, 100) ||
    JSON.stringify(c.toolResult.content?.[0]?.json)?.substring(0, 100) ||
    "[empty]";
  return `toolResult(${c.toolResult.toolUseId},preview:${preview})`;
}
```

## How to Debug Further

1. **Enable Debug/Trace Logging**:
   - Open "Bedrock Chat" output channel
   - Click dropdown (⚙️) → "Set Log Level..." → "Debug" or "Trace"

2. **Look for the Second Request**:
   After tool calls are made, you should see:

   ```log
   [info] [Bedrock Model Provider] === NEW REQUEST ===
   [debug] [Bedrock Model Provider] Message X (User): ["text","toolResult(callId)"]
   [debug] [Message Converter] Processing tool result: { callId, textLength, textPreview }
   [debug] [Message Converter] Created Bedrock tool result: { toolUseId, format, hasContent }
   ```

3. **Check for Empty Tool Results**:
   If you see `textLength: 0` or `preview: "[empty]"`, the tool results are coming back empty.

4. **Verify Tool ID Matching**:
   - Tool call emitted with ID: `tooluse_ABC123`
   - Tool result should have matching `callId: "tooluse_ABC123"`
   - Bedrock message should have `toolUseId: "tooluse_ABC123"`

## Expected Behavior After Fixes

1. **First Request**: User asks question
2. **First Response**: Model makes tool calls (no reasoning text shown)
3. **VSCode Executes Tools**: (not visible in our logs)
4. **Second Request**: Tool results sent back (should see detailed logging)
5. **Second Response**: Model uses results to answer

## What to Test

1. Ask a question that requires tool use
2. Check that tool calls stream immediately (not batched at end)
3. Check the log shows two "NEW REQUEST" entries
4. Check the second request includes tool results with actual content
5. Verify the model's response uses the tool results properly

## Possible Remaining Issues

If tool results still appear empty in the second request:

1. **VSCode not executing tools properly** - Check VSCode's own logs
2. **Tool result format mismatch** - Check if result format should be JSON vs text
3. **Content extraction issue** - Our converter might not be extracting content correctly from LanguageModelToolResultPart

The enhanced logging should help identify which of these is the actual issue.
