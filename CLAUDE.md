# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VSCode extension that integrates AWS Bedrock foundation models (Claude, Llama, Mistral, etc.) into GitHub Copilot Chat using AWS named profiles for authentication. Built on VSCode's `LanguageModelChatProvider` API.

## Essential Commands

### Development

```bash
bun install                        # Install dependencies (also downloads VSCode API definitions)
bun run check-types                # Run TypeScript type checking (no emit)
bunx eslint --fix FILENAME.ts      # Run ESLint
bunx prettier --write FILENAME.ts  # Format code with Prettier
```

### Testing

```bash
# Press F5 in VSCode to launch Extension Development Host
# Or use Run and Debug panel -> "Run Extension"

bun run test             # Run tests (requires compilation first)
```

## Architecture Overview

### Core Flow

1. **Extension activation** (extension.ts) → Registers `BedrockChatModelProvider` with VSCode
2. **Model listing** → `BedrockAPIClient` fetches available models via AWS SDK
3. **Chat requests** → Messages converted to Bedrock format → Streamed responses via `ConverseStream` API
4. **Stream processing** → `StreamProcessor` handles content blocks and tool calls

### Key Components

**Provider Layer** (src/provider.ts)

- `BedrockChatModelProvider`: Main VSCode integration implementing `LanguageModelChatProvider`
- `provideLanguageModelChatInformation()`: Lists available Bedrock models
- `provideLanguageModelChatResponse()`: Handles chat requests with streaming
- Token estimation using char_count/4 approximation

**AWS Integration** (src/bedrock-client.ts)

- `BedrockAPIClient`: Wraps AWS SDK Bedrock clients
- Uses `fromIni()` credential provider when profile specified
- Falls back to default AWS credential chain when no profile
- Handles both foundation models and cross-region inference profiles

**Message Conversion** (src/converters/)

- `messages.ts`: VSCode messages → Bedrock Converse API format
- `tools.ts`: VSCode tools → Bedrock tool configuration
- `schema.ts`: Tool schemas → JSON Schema format
- Handles text, images, tool calls, and tool results

**Stream Processing** (src/stream-processor.ts)

- Processes Bedrock `ConverseStream` events
- `contentBlockStart` → Initiates tool calls
- `contentBlockDelta` → Streams text or tool inputs
- `contentBlockStop` → Finalizes tool calls
- Uses `ToolBuffer` to accumulate streaming JSON tool parameters

**Configuration** (src/commands/manage-settings.ts, src/aws-profiles.ts)

- `manageSettings()`: Interactive UI for profile/region selection
- `listAwsProfiles()`: Parses ~/.aws/credentials and ~/.aws/config files
- Settings persisted in VSCode `globalState` (Memento)

**Logging** (src/logger.ts)

- Uses `LogOutputChannel` for structured logging with severity levels
- Passes structured data directly to VSCode (objects remain objects, not stringified)
- Integrates with VSCode's "Export Logs..." feature for log export
- Log levels (from most to least verbose):
  - `trace()`: Very verbose stream processing details (deltas, indices)
  - `debug()`: Debugging information (tool calls, message conversions)
  - `info()`: Normal operational flow (requests, completions)
  - `warn()`: Non-critical issues (progress report failures)
  - `error()`: Error conditions requiring attention
- Automatically manages log files for debugging
- Legacy `log()` method deprecated (forwards to `info()`)

**Setting Log Level for Debugging (0.x versions)**

To see debug and trace logs:

1. Open "Bedrock Chat" output channel
2. Click the dropdown menu (⚙️ icon) on the right side of the output panel
3. Select "Set Log Level..." → "Debug" or "Trace"

Alternatively, add to your VSCode settings:

```json
{
  "bedrock.logLevel": "Debug" // or "Trace" for maximum verbosity
}
```

Note: At 1.0.0 release, default will be "Info" level.

### Model Capabilities (src/profiles.ts)

Different Bedrock models have varying capabilities:

- **Tool choice modes**: Some models support `any`/`auto`/`tool`, others only support absence vs presence
- **Tool result formats**: Models differ in how they expect tool results (JSON vs text)
- Check model-specific profiles when debugging tool calling issues

## Important Patterns

### AWS Credential Resolution

```typescript
// If profile specified: use fromIni({ profile })
// If no profile: use default credential chain (env vars, IAM roles, etc.)
private getCredentials() {
  if (this.profileName) {
    return fromIni({ profile: this.profileName });
  }
  return undefined; // Falls back to default chain
}
```

### Cross-Region Inference Profiles

Models can be accessed via cross-region inference profiles (format: `{region-prefix}.{model-id}`):

- Automatically detected via `ListInferenceProfilesCommand`
- Provides better availability and latency
- Example: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`

### Message Validation

- First message must be USER role
- Messages must alternate USER/ASSISTANT
- Tool call/result messages must match ASSISTANT/USER pattern
- See `validation.ts` for detailed rules

### Token Estimation

Uses simple approximation: `tokens ≈ char_count / 4`

- Applied to both message content and tool configurations
- Validates against model's `maxInputTokens` before request

## File Organization

```text
src/
├── extension.ts              # Entry point, activation
├── provider.ts               # Main LanguageModelChatProvider
├── bedrock-client.ts         # AWS SDK wrapper
├── stream-processor.ts       # Stream event handler
├── tool-buffer.ts            # JSON accumulator for streaming tools
├── profiles.ts               # Model capability profiles
├── aws-profiles.ts           # AWS config file parsing
├── logger.ts                 # Centralized logging
├── validation.ts             # Request validation
├── types.ts                  # TypeScript interfaces
├── commands/
│   └── manage-settings.ts    # Settings UI
└── converters/
    ├── messages.ts           # Message format conversion
    ├── tools.ts              # Tool format conversion
    └── schema.ts             # JSON Schema conversion
```

## Configuration Files

- **package.json**: VSCode contribution point `languageModelChatProviders` with vendor `"bedrock"`
- **tsconfig.json**: Strict mode, ES2024 target, Node16 modules
- **eslint.config.mjs**: TypeScript ESLint + stylistic plugin

## Common Issues

**Models not appearing**: Check AWS credentials, region, and IAM permissions (`bedrock:ListFoundationModels`)

**Tool calling failures**: Different models have different tool capabilities - check `profiles.ts` for model-specific configuration

**Token limit errors**: Token estimation is approximate - actual token count may differ from estimate

**Stream processing errors**: Check that model supports streaming (`responseStreamingSupported: true`)

## Testing Approach

1. **Unit tests**: Limited coverage, see `src/test/provider.test.ts`
2. **Integration testing**: Run extension in Development Host (F5)
3. **Manual verification**: Use "Bedrock Chat" output channel for logs
4. **AWS testing**: Requires valid AWS credentials and Bedrock access

See TESTING.md and IMPLEMENTATION.md for detailed testing procedures.

## VSCode API Requirements

- Minimum VSCode version: 1.104.0
- Uses proposed/experimental APIs (downloaded via `bun run download-api`)
- API definitions in vscode.d.ts (auto-generated)

## Dependencies

**Runtime**:

- `@aws-sdk/client-bedrock`: Model listing
- `@aws-sdk/client-bedrock-runtime`: Converse API
- `@aws-sdk/credential-providers`: AWS profile support
- `ini`: Parse AWS config files

**Development**:

- `typescript`: 5.9+, strict mode
- `eslint`: Code quality with typescript-eslint
- `prettier`: Code formatting
- `@vscode/test-*`: Testing infrastructure

## Development Workflow

1. Make code changes
2. `bun run compile` or use watch mode
3. Press F5 to launch Extension Development Host
4. Test in Copilot Chat
5. Check "Bedrock Chat" output channel for logs
6. Run `bun run check-types`, `bun run lint`, and `bun run format` before committing

## 📑 MANDATORY: Handling GitHub PR Review Comment(s)

1. When given an URL - parse the incoming URL

```text
https://github.com/tinovyatkin/amazon-bedrock-copilot-chat/pull/<PR_NUMBER>#discussion_r<COMMENT_ID>
```

- `<PR_NUMBER>` → digits between `/pull/` and `#`.
- `<COMMENT_ID>` → digits after `discussion_r`.

2. Fetch the comment body

```bash
gh api repos/tinovyatkin/amazon-bedrock-copilot-chat/pulls/comments/<COMMENT_ID> \
  --jq '
"id:         \(.id)
pr_number:   \(.pull_request_url | split("/") | last)
author:      \(.user.login)
created_at:  \(.created_at)
file:        \( .path )
line:        \( .start_line )
--- BEGIN_BODY ---
\(.body)
--- END_BODY ---"'
```

The text between BEGIN_BODY/END_BODY is what you must act on.

3. Apply every suggestion immediately

- Treat even "nitpick" remarks as mandatory.
- Do not leave TODOs, placeholders, or defer fixes.

4. Commit & push

5. Reply directly to that comment

- DO NOT create a new review
- DO NOT add a top level issue comment
- REPLY DIRECTLY AND SPECIFICALLY to the original comment:

```bash
gh api repos/tinovyatkin/amazon-bedrock-copilot-chat/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies \
  -X POST -f body='✅ Addressed in <hash>. Thanks!'
```

_Replace `<hash>` with the short commit SHA._

**Follow these five steps exactly to process a GitHub review comment.**
