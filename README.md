# Amazon Bedrock Provider for GitHub Copilot Chat

A VSCode extension that brings Amazon Bedrock models into GitHub Copilot Chat using VSCode's official [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) and the AWS SDK.

**This is not a hack or workaround** - it's built on two official APIs:

- VSCode's **Language Model Chat Provider API** for integrating custom models into Copilot Chat
- **AWS SDK for JavaScript** for connecting to Amazon Bedrock

> **Important**: Models provided through the Language Model Chat Provider API are currently only available to users on **individual GitHub Copilot plans**. Organization plans are not yet supported.

## Features

- **Native Amazon Bedrock Integration**: Access Claude, OpenAI OSS, DeepSeek, and other models directly in GitHub Copilot Chat
- **AWS Profile Support**: Uses AWS named profiles from your `~/.aws/credentials` and `~/.aws/config` files
- **Streaming Support**: Real-time streaming responses for faster feedback
- **Function Calling**: Full support for tool/function calling capabilities
- **Cross-Region Inference**: Automatic support for cross-region inference profiles
- **Extended Thinking**: Automatic support for extended thinking in Claude Opus 4+, Sonnet 4+, and Sonnet 3.7 for enhanced reasoning on complex tasks
- **1M Context Window**: Optional 1M token context window for Claude Sonnet 4.x models (can be disabled in settings to reduce costs)
- **Prompt Caching**: Automatic caching of system prompts, tool definitions, and conversation history for faster responses and reduced costs (Claude and Nova models)
- **Vision Support**: Work with models that support image inputs

## Prerequisites

- Visual Studio Code version 1.104.0 or higher
- GitHub Copilot extension
- AWS credentials configured in `~/.aws/credentials` or `~/.aws/config`
- Access to Amazon Bedrock in your AWS account

## Installation

1. Install the extension from the VSCode marketplace
2. Configure your AWS credentials if you haven't already:
   - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) for details
3. Run the "Manage Amazon Bedrock Provider" command to select your AWS profile and region

## Configuration

### Setting up AWS Profiles

This extension uses AWS named profiles from your AWS configuration files. You can:

1. Use the default AWS credentials chain (no profile selected)
2. Select a specific named profile from your AWS configuration

To configure:

1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Run "Manage Amazon Bedrock Provider"
3. Choose "Set AWS Profile" to select from your available profiles
4. Choose "Set Region" to select your preferred AWS region

### Available Regions

- US East (N. Virginia) - us-east-1
- US East (Ohio) - us-east-2
- US West (Oregon) - us-west-2
- Asia Pacific (Mumbai) - ap-south-1
- Asia Pacific (Tokyo) - ap-northeast-1
- Asia Pacific (Seoul) - ap-northeast-2
- Asia Pacific (Singapore) - ap-southeast-1
- Asia Pacific (Sydney) - ap-southeast-2
- Canada (Central) - ca-central-1
- Europe (Frankfurt) - eu-central-1
- Europe (Ireland) - eu-west-1
- Europe (London) - eu-west-2
- Europe (Paris) - eu-west-3
- South America (São Paulo) - sa-east-1

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

### Supported Model Families

**Anthropic Claude:**

- Claude Sonnet 4.5 and Claude Sonnet 4
- Claude Opus 4.1 and Claude Opus 4
- Claude 3.7 Sonnet
- Claude 3.5 Sonnet and Claude 3.5 Haiku (legacy)
- Claude 3 family: Opus, Sonnet, Haiku (legacy)

**OpenAI OSS:**

- gpt-oss-120b (120B parameters, near o4-mini performance)
- gpt-oss-20b (20B parameters, optimized for edge deployment)

**Amazon Nova:**

- Nova Premier, Nova Pro, Nova Lite, Nova Micro

**Meta Llama:**

- Llama 3.1 and later (8B, 70B, 405B variants)
- Llama 3.2 (11B, 90B)
- Llama 4 (Scout, Maverick)

**Mistral AI:**

- Mistral Large and Mistral Large 2
- Mistral Small
- Pixtral Large

**Cohere:**

- Command R and Command R+

**AI21 Labs:**

- Jamba 1.5 Large and Jamba 1.5 Mini

**Writer:**

- Palmyra X4 and Palmyra X5

**DeepSeek:**

- DeepSeek models (via Amazon Bedrock when available)

### Models Automatically Excluded

The extension automatically filters models to show only text generation models (using `byOutputModality: "TEXT"` in the Bedrock API). This excludes embedding models and image generation models.

**Note**: Some text models that appear in the list may have limited or no tool calling support (e.g., legacy Amazon Titan Text, AI21 Jurassic 2, Meta Llama 2 and 3.0). These will fail gracefully if tool calls are attempted.

## Troubleshooting

### Models not showing up

1. Verify your AWS credentials are correctly configured
2. Check that you've selected the correct AWS profile and region
3. **Enable models in the Amazon Bedrock console**: Go to the [Bedrock Model Access page](https://console.aws.amazon.com/bedrock/home#/modelaccess) and request access to the models you want to use
4. Ensure your AWS account has access to Bedrock in the selected region
5. Check the "Bedrock Chat" output channel for error messages

### Authentication errors

1. Verify your AWS credentials are valid and not expired
2. Check that your IAM user/role has the necessary Bedrock permissions:

   **Option 1: Use AWS Managed Policy (Recommended)**

   Attach the [`AmazonBedrockLimitedAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonBedrockLimitedAccess.html) managed policy to your IAM user or role. This policy includes all required permissions for using this extension.

   **Option 2: Custom Policy with Specific Permissions**

   If you prefer granular control, ensure your policy includes:
   - `bedrock:ListFoundationModels` - List available models
   - `bedrock:GetFoundationModelAvailability` - Check model access status
   - `bedrock:ListInferenceProfiles` - List cross-region inference profiles
   - `bedrock:InvokeModel` - Invoke models
   - `bedrock:InvokeModelWithResponseStream` - Stream model responses

## Credits

This extension is based on [huggingface-vscode-chat](https://github.com/huggingface/huggingface-vscode-chat) and [vscode-copilot-chat PR#1046](https://github.com/microsoft/vscode-copilot-chat/pull/1046).

## License

MIT
