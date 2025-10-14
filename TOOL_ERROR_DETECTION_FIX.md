# Tool Error Detection Fix

## Problem Analysis

The log file revealed that the OpenAI OSS 128 model was repeatedly making the same tool calling errors (using invalid terminal IDs like "0", "1", "2", etc.) despite receiving clear error messages. The issue was that these errors weren't being properly signaled to the model.

## Root Cause

1. **VSCode API Limitation**: The `LanguageModelToolResultPart` class in VSCode's API doesn't have an `isError` property, only `callId` and `content`.

2. **Invalid Error Detection**: Our code was checking for `"isError" in part && part.isError` which would always be false since the property doesn't exist in the VSCode API.

3. **Model Confusion**: The Bedrock API expects tool errors to have `status: "error"`, but we were never setting this, so the model treated error messages as successful responses.

## Solution Implemented

### 1. Content-Based Error Detection

Since VSCode doesn't provide error flags, we now detect errors by examining the tool result content:

```typescript
// Since VSCode API doesn't provide isError property, detect errors from content
const lowerContent = textContent.toLowerCase();
const isLikelyError =
  lowerContent.startsWith("error") ||
  lowerContent.startsWith("error while calling tool:") ||
  lowerContent.includes("error while calling tool:") ||
  lowerContent.includes("invalid terminal id") ||
  lowerContent.includes("please check your input");

const status = isLikelyError ? "error" : undefined;
```

### 2. Enhanced Logging

Added comprehensive logging to expose the full structure of VSCode tool results:

```typescript
logger.debug("[Message Converter] Processing VSCode tool result:", {
  allProperties: Object.keys(part),
  callId: part.callId,
  contentType: typeof part.content,
  hasIsError: "isError" in part, // Always false
  isError: "isError" in part ? (part as Record<string, unknown>).isError : undefined,
  textLength: textContent.length,
  textPreview: textContent.substring(0, 200),
});

logger.debug("[Message Converter] Error status decision:", {
  contentPreview: textContent.substring(0, 100),
  detectedFromContent: isLikelyError,
  hasIsErrorProperty: "isError" in part,
  isErrorValue: "isError" in part ? (part as Record<string, unknown>).isError : undefined,
  resultingStatus: status,
});
```

### 3. Proper Error Status in Bedrock API

Tool results now properly include the error status when errors are detected:

```typescript
content.push({
  toolResult: {
    content: [contentBlock],
    toolUseId: part.callId,
    ...(status ? { status } : {}), // Adds status: "error" when detected
  },
});
```

## Impact

With these changes:

- Models will receive proper error signals when tool calls fail
- The model should stop repeating the same invalid tool calls
- Better debugging visibility into tool result processing
- More robust handling of tool errors regardless of VSCode API limitations

## Files Changed

- `src/converters/messages.ts`: Added content-based error detection and enhanced logging
- `TOOL_RESULT_DEBUG.md`: Fixed markdown linting issue

## Testing

To verify the fix works:

1. Enable debug logging in the Bedrock Chat output channel
2. Make a request that causes tool errors
3. Check that the logs show:
   - `detectedFromContent: true` for error messages
   - `resultingStatus: "error"` being set
   - Tool results with `status: "error"` in the Bedrock request
4. Verify the model adjusts its behavior based on the error feedback
