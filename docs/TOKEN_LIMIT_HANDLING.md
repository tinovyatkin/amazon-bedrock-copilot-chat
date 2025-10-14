# Token Limit and Context Management

## Problem Analysis

When a Bedrock model hits the `max_tokens` limit while generating only internal reasoning content (which is not emitted to users), the following occurred:

1. **Stream completed successfully** with `stopReason: "max_tokens"`
2. **No content was emitted** to the user (`hasEmittedContent: false`)
3. **Generic error shown**: VSCode displayed "Sorry, no response was returned"
4. **Root cause was hidden** from the user

## VSCode API Limitations

### No Finish Reason Reporting

The `LanguageModelChatProvider.provideLanguageModelChatResponse` method returns `Thenable<void>`, providing no way to pass metadata or finish reasons back to VSCode. Communication with the framework is limited to:

- **Progress reporting**: `Progress<LanguageModelResponsePart>` callback
- **Response parts**: Only `LanguageModelTextPart`, `LanguageModelToolCallPart`, `LanguageModelToolResultPart`
- **Error throwing**: The only way to signal problems is via exceptions

### No Automatic Context Pruning

VSCode does **NOT** perform automatic context pruning for `LanguageModelChatProvider` implementations. Context management features like automatic message pruning are only available at the `ChatParticipant` level, not at the model provider level.

**What we DO have:**

- `maxInputTokens` and `maxOutputTokens` in `LanguageModelChatInformation`
- Pre-request validation (we check token limits before sending)
- Manual token counting via `provideTokenCount`

**What we DON'T have:**

- Automatic context window management
- Finish reason metadata in responses
- Automatic retry with pruned context

## Solution Implemented

### Detecting No-Content Scenarios

The `StreamProcessor` now:

1. **Tracks stop reason** from `messageStop` event
2. **Validates content emission** after stream completes
3. **Throws descriptive errors** when appropriate:

```typescript
if (!hasEmittedContent) {
  if (stopReason === "max_tokens") {
    throw new Error(
      "The model reached its maximum token limit while generating internal reasoning. " +
        "Try reducing the conversation history or adjusting model parameters.",
    );
  } else if (stopReason === "content_filtered") {
    throw new Error(
      "The response was filtered due to content policy. Please rephrase your request.",
    );
  } else if (!token.isCancellationRequested) {
    throw new Error(
      `No response content was generated. ${stopReason ? `Stop reason: ${stopReason}` : "Please try rephrasing your request."}`,
    );
  }
}
```

### Why This Works

- **User-facing errors**: VSCode will display the error message in the chat UI
- **Clear guidance**: Users understand what went wrong and how to fix it
- **No silent failures**: Instead of a generic error, users get actionable feedback

## Current Token Management

### Pre-Request Validation

In `provider.ts:292-301`, we validate token limits before making requests:

```typescript
const inputTokenCount = this.estimateMessagesTokens(messages);
const toolTokenCount = this.estimateToolTokens(toolConfig);
const tokenLimit = Math.max(1, model.maxInputTokens);
if (inputTokenCount + toolTokenCount > tokenLimit) {
  throw new Error("Message exceeds token limit.");
}
```

### Token Estimation

Simple approximation: `tokens ≈ characters / 4`

This is applied to:

- Message content (text parts)
- Tool configurations (JSON schema)

### Output Token Configuration

Request configuration in `provider.ts:304-310`:

```typescript
maxTokens: Math.min(
  typeof options.modelOptions?.max_tokens === "number" ? options.modelOptions.max_tokens : 4096,
  model.maxOutputTokens,
);
```

## Recommendations

### For Users

When hitting token limits:

1. **Reduce conversation history**: Start a new chat or clear context
2. **Adjust max_tokens**: Lower the output token limit in model options
3. **Simplify requests**: Break complex tasks into smaller parts

### For Future Improvements

Potential enhancements (not currently implemented):

1. **Automatic context pruning**: Implement message summarization or oldest-message removal
2. **Better token estimation**: Use model-specific tokenizers instead of char/4
3. **Progressive reduction**: Automatically retry with reduced context on token errors
4. **Context window monitoring**: Warn users when approaching limits

## Related Issues

- Internal reasoning tokens count toward limits but aren't shown to users
- Reasoning-heavy prompts can exhaust output tokens without visible progress
- VSCode's native models may have different context management strategies
