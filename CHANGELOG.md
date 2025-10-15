# Changelog

All notable changes to the "amazon-bedrock-copilot-chat" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
