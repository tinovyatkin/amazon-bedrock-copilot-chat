# Changelog

All notable changes to the "amazon-bedrock-copilot-chat" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.17] - 2025-10-17

### Added

- **Accurate Token Counting**: Implemented AWS Bedrock CountTokens API for precise, model-specific token counting
  - Uses official AWS API that matches actual inference tokenization and costs
  - Automatically converts VSCode messages to Bedrock Converse format for counting
  - Gracefully falls back to character-based estimation when API is unavailable
  - CountTokens API calls are free (no charges incurred)
  - Supported for Claude 3.5/3.7/4 models in all major regions

- **Global Inference Profile Support**: Models with global inference profiles now appear in model list
  - Automatically detects and prefers global inference profiles (e.g., `global.anthropic.claude-sonnet-4-5-...`)
  - Falls back to regional inference profiles, then base model IDs
  - Global profiles provide best availability by routing across all AWS regions
  - Tooltips distinguish between "Global Inference Profile" and "Regional Inference Profile"

### Improved

- **Request Validation**: Pre-flight token counting now uses CountTokens API for accurate validation
  - Unified `countRequestTokens()` method counts messages + system prompts + tools together
  - Validates against `maxInputTokens` before sending request to prevent API errors
  - Provides accurate token counts in error messages when limit exceeded
  - Removed separate estimation methods in favor of unified API-based counting

- **Cancellation Support**: Enhanced request cancellation handling across all AWS SDK operations
  - Added AbortSignal support to `startConversationStream()` for streaming requests
  - Added AbortSignal support to `countTokens()` for token counting requests
  - Proper cleanup with AbortController disposal in finally blocks
  - Prevents resource leaks when operations are cancelled by user

### Fixed

- **Content Filtering Error Visibility**: Users now always see an error when responses are filtered
  - Previously, if content was partially generated before filtering, no error was shown
  - This left users confused seeing partial text then silence
  - Now throws clear error for both mid-generation and pre-generation filtering
  - Error messages distinguish between partial vs complete filtering
  - Uses official AWS SDK `StopReason` enum instead of string literals for type safety
  - **Important distinction**: `CONTENT_FILTERED` includes Anthropic Claude's built-in safety filtering (AI Safety Level 3 in Claude 4.5), not just AWS Bedrock Guardrails
  - Added handling for `GUARDRAIL_INTERVENED` (explicit AWS Bedrock Guardrails) vs `CONTENT_FILTERED` (model's built-in filtering)
  - Added handling for `MODEL_CONTEXT_WINDOW_EXCEEDED` stop reason

- **Inference Profile Support**: CountTokens API now works correctly with all inference profile types
  - CountTokens API doesn't accept inference profile IDs directly (e.g., `us.anthropic.claude-...`)
  - Uses GetInferenceProfile API to resolve profile IDs to base model IDs
  - Supports both regional (`us.`, `eu.`, `ap.`) and global (`global.`) inference profiles
  - Caches profile → model ID mappings to minimize API calls
  - Pattern-based detection distinguishes inference profiles from regular model IDs
  - Enhanced error logging at trace level shows full error details for debugging
  - Cache automatically cleared when region/profile settings change

### Technical Details

Per AWS documentation at https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html:

- Token counting is model-specific using each model's tokenization strategy
- Returns exact token count that would be charged for the same input in inference
- Helps estimate costs before sending inference requests
- Currently supported for Anthropic Claude 3.5 Haiku, 3.5 Sonnet (v1/v2), 3.7 Sonnet, Opus 4, and Sonnet 4 models
- Available in US East/West, Asia Pacific, Europe, and South America regions

**Inference Profile Resolution**: CountTokens API does not accept cross-region inference profile IDs
directly. The implementation uses GetInferenceProfile API to retrieve the underlying base model ID
from the profile's ARN, then passes that to CountTokens. Results are cached in-memory to minimize
API calls.

## [0.1.16] - 2025-10-16

### Added

- **Guardrail Detection**: Comprehensive monitoring of AWS Bedrock Guardrails during streaming
  - Detects account-level and organization-level guardrail policies
  - Recursive policy detection for blocked content (action:BLOCKED + detected:true)
  - Detailed logging with actionable guidance when content is blocked
  - Helps diagnose why certain models (e.g., Sonnet 4.5) may be blocked

### Fixed

- **Stop Reason Correction**: Fixed incorrect stop reasons when models use tools
  - Some Bedrock models incorrectly report `end_turn` instead of `tool_use`
  - Now tracks tool usage and corrects stop reason for accurate flow control

- **Context Window Overflow**: Better error detection and messaging
  - Detects specific Bedrock API error patterns for context window overflow
  - Provides actionable guidance (reduce history, remove tool results, adjust parameters)
  - Uses `util.inspect` for safe error stringification

### Improved

- **Model Compatibility**: Enhanced support for different Bedrock models
  - Tool result `status` field now only included for models that support it (Claude models)
  - Deepseek models: Filter out `reasoningContent` blocks in multi-turn conversations
  - Prevents validation errors with non-Claude models

### Technical Details

All changes implemented following [strands-agents](https://github.com/strands-agents/sdk-python) best practices:

- Stop reason correction pattern from strands-agents streaming implementation
- Guardrail detection using recursive policy checking algorithm
- Model-specific capability profiles for tool result status
- Context window overflow detection with known error message patterns

## [0.1.15] - 2025-10-15

### Fixed

- Message conversion now skips empty text parts to prevent Bedrock validation errors
  - Filters out empty/whitespace-only text content blocks before API submission
  - Prevents `ValidationException: The text field in the ContentBlock object is blank` errors
  - Applied to user, assistant, and system messages

## [0.1.13] - 2025-10-15

### Fixed

- Extended thinking now works with tool use (function calling)
  - Capture signature deltas from reasoning content stream
  - Skip tool_choice setting when thinking enabled (API constraint)
  - Only store and reinject thinking blocks with valid signatures
  - Prevents validation errors while maintaining thinking continuity
- Comprehensive trace logging for debugging message structures
- Stack traces included in error logs for better troubleshooting

### Technical Details

This release resolves the incompatibility between extended thinking and tool use through three key fixes:

1. **Signature Delta Capture**: Signatures are streamed incrementally via `signature_delta` fields. We now accumulate them during stream processing, just like thinking text.

2. **Tool Choice Constraint**: The API rejects `tool_choice` settings (auto/any) when extended thinking is enabled. We now skip setting tool_choice entirely when thinking is active.

3. **Signature Filtering**: Only thinking blocks with valid signatures can be reinjected in subsequent requests. Blocks without signatures are discarded with debug logging.

These changes enable extended thinking to work seamlessly with tool calling, providing both deep reasoning and function calling capabilities simultaneously.

## [0.0.1] - 2024-10-12

### Added

- Initial release
- AWS named profile support for authentication
- Support for all Bedrock foundation models with streaming and text output
- Settings management command for AWS profile and region selection
- Integration with GitHub Copilot Chat
- Support for tool/function calling
- Support for vision models (image input)
- Cross-region inference profile support
- Comprehensive error handling and logging

### Features

- AWS profile selection from `~/.aws/credentials` and `~/.aws/config`
- Default credentials chain support (when no profile selected)
- Region selection across 14 AWS regions
- Streaming responses for real-time feedback
- Model-specific capability detection (tool choice, tool result format)
- Token count estimation

### Developer Notes

- Based on bedrock-vscode-chat by Aristide
- Uses AWS SDK v3 with `@aws-sdk/credential-providers`
- TypeScript with strict mode enabled
- ESLint and Prettier configured for code quality
