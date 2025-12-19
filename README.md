# Amazon Bedrock Provider for GitHub Copilot Chat

A VSCode extension that brings Amazon Bedrock models into GitHub Copilot Chat using VSCode's official [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) and the AWS SDK.

**This is not a hack or workaround** - it's built on two official APIs:

- VSCode's **Language Model Chat Provider API** for integrating custom models into Copilot Chat
- **AWS SDK for JavaScript** for connecting to Amazon Bedrock

> **Important**: Models provided through the Language Model Chat Provider API are currently only available to users on **individual GitHub Copilot plans**. Organization plans are not yet supported.

## Features

- **Native Amazon Bedrock Integration**: Access Claude, OpenAI OSS, DeepSeek, and other models directly in GitHub Copilot Chat
- **Flexible Authentication**: Support for AWS Profiles, API Keys (bearer tokens), or Access Keys - all stored securely
- **Streaming Support**: Real-time streaming responses for faster feedback
- **Function Calling**: Full support for tool/function calling capabilities
- **Cross-Region Inference**: Automatic support for cross-region inference profiles
- **Extended Thinking**: Automatic support for extended thinking in Claude Opus 4+, Sonnet 4+, and Sonnet 3.7 for enhanced reasoning on complex tasks. Also respects GitHub Copilot's `github.copilot.chat.anthropic.thinking.enabled` and `github.copilot.chat.anthropic.thinking.maxTokens` settings
- **Thinking Effort Control**: For Claude Opus 4.5, configure thinking effort level (high/medium/low) via `bedrock.thinking.effort` setting to balance quality vs. token usage. Defaults to "high" for maximum capability
- **1M Context Window**: Optional 1M token context window for Claude Sonnet 4.x models (can be disabled in settings to reduce costs)
- **Prompt Caching**: Automatic caching of system prompts, tool definitions, and conversation history for faster responses and reduced costs (Claude and Nova models)
- **Vision Support**: Work with models that support image inputs

## Prerequisites

- Visual Studio Code version 1.104.0 or higher
- GitHub Copilot extension
- AWS credentials (AWS Profile, API Key, or Access Keys)
- Access to Amazon Bedrock in your AWS account

## Installation

1. Install the extension from the VSCode marketplace
2. Configure your AWS credentials if you haven't already:
   - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) for details
3. Run the "Manage Amazon Bedrock Provider" command to select your AWS profile and region

## Configuration

### Authentication Methods

This extension supports three authentication methods:

1. **AWS Profile** (recommended) - Uses named profiles from `~/.aws/credentials` and `~/.aws/config`
2. **API Key** - Uses [Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) (stored securely in VSCode SecretStorage)
3. **Access Keys** - Uses AWS access key ID and secret (stored securely in VSCode SecretStorage)

To configure:

1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Run "Manage Amazon Bedrock Provider"
3. Choose "Set Authentication Method" to select your preferred method
4. Follow the prompts to enter credentials
5. Choose "Set Region" to select your preferred AWS region

### Available Regions

See [Model support by AWS Region in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html) for the latest list of supported regions for Amazon Bedrock.

## Usage

Once configured, Bedrock models will appear in GitHub Copilot Chat's model selector. Simply:

1. Open GitHub Copilot Chat
2. Click on the model selector
3. Choose a Bedrock model (they will be labeled with "Amazon Bedrock")
4. Start chatting!

## Supported Models

The extension automatically filters and displays only models that:

- Support **tool calling** (function calling), which is essential for GitHub Copilot Chat features like `@workspace`, `@terminal`, and other integrations
- Are **enabled** in your Amazon Bedrock console (models must be authorized and available in your selected region)

### Models Automatically Excluded

The extension automatically filters models to show only text generation models (using `byOutputModality: "TEXT"` in the Bedrock API). This excludes:

- Embedding models
- Image generation models
- **Deprecated models** (models with `LEGACY` lifecycle status)

Models are sorted with newest inference profiles first (by creation/update date), making it easier to find recently released models.

**Note**: Some text models that appear in the list may have limited or no tool calling support (e.g., legacy Amazon Titan Text, AI21 Jurassic 2, Meta Llama 2 and 3.0). These will fail gracefully if tool calls are attempted.

## Troubleshooting

### Models not showing up

1. Verify your AWS credentials are correctly configured
2. Check that you've selected the correct AWS profile and region
3. **Enable models in the Amazon Bedrock console**: Go to the [Bedrock Model Access page](https://console.aws.amazon.com/bedrock/home#/modelaccess) and request access to the models you want to use
4. Ensure your AWS account has access to Bedrock in the selected region
5. Check the "Amazon Bedrock Models" output channel for error messages

### Authentication errors

1. Verify your AWS credentials are valid and not expired
2. Check that your IAM user/role has the necessary Bedrock permissions:

   **Option 1: Use AWS Managed Policy (Recommended)**

   Attach the [`AmazonBedrockLimitedAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonBedrockLimitedAccess.html) managed policy to your IAM user or role. This policy includes all required permissions for using this extension.

   **Option 2: Custom Policy with Specific Permissions**

   If you prefer granular control, ensure your policy includes:
   - `bedrock:ListFoundationModels` - List available models (_optional but recommended - extension will fallback to check Anthropic models only_)
   - `bedrock:GetFoundationModelAvailability` - Check model access status (_optional but recommended_)
   - `bedrock:ListInferenceProfiles` - List cross-region inference profiles
   - `bedrock:InvokeModel` - Invoke models
   - `bedrock:InvokeModelWithResponseStream` - Stream model responses

## License

MIT
