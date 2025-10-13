# Changelog

All notable changes to the "amazon-bedrock-copilot-chat" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
