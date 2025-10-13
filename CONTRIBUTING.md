# Contributing to amazon-bedrock-copilot-chat

Thank you for your interest in contributing to this project!

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/tinovyatkin/amazon-bedrock-copilot-chat.git
   cd amazon-bedrock-copilot-chat
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Compile the TypeScript code**

   ```bash
   npm run compile
   ```

4. **Run in development mode**
   - Open the project in VSCode
   - Press F5 to launch the Extension Development Host
   - This will open a new VSCode window with the extension loaded

## Project Structure

```text
src/
├── aws-profiles.ts          # AWS profile listing utilities
├── bedrock-client.ts        # Bedrock API client with AWS SDK
├── commands/
│   └── manage-settings.ts   # Settings management command
├── converters/
│   ├── messages.ts          # Message format conversion
│   ├── schema.ts            # Tool schema conversion
│   └── tools.ts             # Tool configuration conversion
├── extension.ts             # Extension entry point
├── logger.ts                # Logging utility
├── profiles.ts              # Model capability profiles
├── provider.ts              # Language model chat provider
├── stream-processor.ts      # Stream event processor
├── tool-buffer.ts           # Tool call buffering
├── types.ts                 # TypeScript type definitions
├── validation.ts            # Request validation
└── vscode.d.ts              # VSCode API type extensions
```

## Code Style

- Use tabs for indentation (configured in `.prettierrc`)
- Run `npm run format` to auto-format code
- Run `npm run lint` to check for linting errors
- Follow existing code patterns and conventions

## Building

```bash
# Compile TypeScript
npm run compile

# Watch mode (recompiles on changes)
npm run watch

# Lint code
npm run lint

# Format code
npm run format
```

## Testing

Currently, the extension requires manual testing in VSCode:

1. Ensure you have AWS credentials configured
2. Launch the Extension Development Host (F5)
3. Run the "Manage AWS Bedrock Provider" command
4. Configure your AWS profile and region
5. Open GitHub Copilot Chat
6. Select a Bedrock model
7. Test chat functionality

## AWS Profile Authentication

The extension uses the AWS SDK's `fromIni()` credential provider to load credentials from:

- `~/.aws/credentials`
- `~/.aws/config`

When no profile is selected, it falls back to the default AWS credentials chain.

## Key Implementation Details

### Message Conversion

Messages are converted from VSCode's format to Bedrock's Converse API format in `converters/messages.ts`. This handles:

- Text content
- Tool calls
- Tool results
- System messages

### Model Profiles

Different Bedrock models have different capabilities. The `profiles.ts` file maintains model-specific settings:

- Tool choice support
- Tool result format (text vs JSON)

### Streaming

Bedrock responses are streamed using the Converse Stream API. The `stream-processor.ts` handles:

- Content blocks
- Tool use events
- Token buffering

## Adding New Features

1. Create a feature branch
2. Implement your changes
3. Test thoroughly
4. Submit a pull request with:
   - Clear description of the changes
   - Any new dependencies explained
   - Testing steps

## Common Issues

### TypeScript Compilation Errors

- Run `npm run compile` to see detailed errors
- Ensure all type definitions are correct
- Check that VSCode API types match the expected interface

### Extension Not Loading

- Check the Extension Development Host console for errors
- Verify `package.json` contributes section is correct
- Ensure the extension activation event is properly defined

### AWS Authentication Errors

- Verify AWS credentials are correctly configured
- Check IAM permissions for Bedrock access
- Ensure the selected region has Bedrock enabled

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [GitHub Copilot Chat API](https://code.visualstudio.com/api/extension-guides/chat)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
