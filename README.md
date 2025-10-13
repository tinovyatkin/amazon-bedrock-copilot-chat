# amazon-bedrock-copilot-chat

A VSCode extension to use Amazon Bedrock in Copilot Chat using AWS named profiles.

## Features

- **Native AWS Bedrock Integration**: Access Claude, Opus, DeepSeek, OpenAI OSS, and other models directly in GitHub Copilot Chat
- **AWS Profile Support**: Uses AWS named profiles from your `~/.aws/credentials` and `~/.aws/config` files
- **Streaming Support**: Real-time streaming responses for faster feedback
- **Function Calling**: Full support for tool/function calling capabilities
- **Vision Support**: Work with models that support image inputs
- **Cross-Region Inference**: Automatic support for cross-region inference profiles

## Prerequisites

- Visual Studio Code version 1.104.0 or higher
- GitHub Copilot subscription
- AWS credentials configured in `~/.aws/credentials` or `~/.aws/config`
- Access to Amazon Bedrock in your AWS account

## Installation

1. Install the extension from the VSCode marketplace
2. Configure your AWS credentials if you haven't already:
    - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) for details
3. Run the "Manage AWS Bedrock Provider" command to select your AWS profile and region

## Configuration

### Setting up AWS Profiles

This extension uses AWS named profiles from your AWS configuration files. You can:

1. Use the default AWS credentials chain (no profile selected)
2. Select a specific named profile from your AWS configuration

To configure:

1. Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`)
2. Run "Manage AWS Bedrock Provider"
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
3. Choose a Bedrock model (they will be labeled with "AWS Bedrock")
4. Start chatting!

## Supported Models

The extension supports all Bedrock foundation models that offer:

- Streaming responses
- Text output
- Converse API compatibility

This includes models from:

- Anthropic (Claude)
- Meta (Llama)
- Mistral AI
- Amazon (Nova)
- Cohere
- AI21 Labs

## Troubleshooting

### Models not showing up

1. Verify your AWS credentials are correctly configured
2. Check that you've selected the correct AWS profile and region
3. Ensure your AWS account has access to Bedrock in the selected region
4. Check the "Bedrock Chat" output channel for error messages

### Authentication errors

1. Verify your AWS credentials are valid and not expired
2. Check that your IAM user/role has the necessary Bedrock permissions:
    - `bedrock:ListFoundationModels`
    - `bedrock:InvokeModel`
    - `bedrock:InvokeModelWithResponseStream`

## Credits

This extension is based on [huggingface-vscode-chat](https://github.com/huggingface/huggingface-vscode-chat) and [vscode-copilot-chat PR#1046](https://github.com/microsoft/vscode-copilot-chat/pull/1046).

AWS profile handling inspired by [AWS Toolkit for Visual Studio Code](https://github.com/aws/aws-toolkit-vscode).

## License

MIT
