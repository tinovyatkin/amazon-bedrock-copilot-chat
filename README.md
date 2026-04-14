# Amazon Bedrock Provider for GitHub Copilot Chat (Locally Adapted)

> **Note**: This is an adapted version of the public [Amazon Bedrock Provider for GitHub Copilot Chat](https://github.com/tinovyatkin/amazon-bedrock-copilot-chat) extension, optimized to work with minimal IAM permissions for restricted corporate environments.

A VSCode extension that brings Amazon Bedrock models into GitHub Copilot Chat using VSCode's official [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) and the AWS SDK.

> **Important**: Models provided through the Language Model Chat Provider API are currently only available to users on **individual GitHub Copilot plans**. Organization plans are not yet supported.

## Prerequisites

- Visual Studio Code version 1.104.0 or higher
- GitHub Copilot extension
- AWS credentials (AWS Profile, API Key, or Access Keys)
- Access to Amazon Bedrock in your AWS account

## Installation

### Option 1: Install from Local Build

To build and install the extension locally:

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Build the extension**:

   ```bash
   npm run compile
   ```

3. **Package the extension** (creates a `.vsix` file):

   ```bash
   npm run vsce:package
   ```

   This creates `dist/extension.vsix`

4. **Install in VSCode**:

   **Using Command Palette**:
   - Open VSCode
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "Extensions: Install from VSIX..."
   - Select the `dist/extension.vsix` file

   **Using Command Line**:

   ```bash
   code --install-extension dist/extension.vsix
   ```

5. **Reload VSCode** to activate the extension

6. **Configure AWS credentials**:
   - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
   - Run "Manage Amazon Bedrock Provider" command to select your AWS profile and region

### Option 2: Install from Pre-built VSIX

If you don't want to build from source, you can install from a pre-built `.vsix` file:

1. **Obtain the VSIX file**: Contact a colleague who has already built the extension and get the `extension.vsix` file from them

2. **Install in VSCode**:

   **Using Command Palette**:
   - Open VSCode
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "Extensions: Install from VSIX..."
   - Select the `.vsix` file

   **Using Command Line**:

   ```bash
   code --install-extension /path/to/extension.vsix
   ```

3. **Reload VSCode** to activate the extension

4. **Configure AWS credentials**:
   - See [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
   - Run "Manage Amazon Bedrock Provider" command to select your AWS profile and region

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

### Extension Settings

You can customize the extension's behavior through VSCode settings:

**To access settings**:

- **Method 1**: Go to **Extensions** view (`Ctrl+Shift+X`), find "Amazon Bedrock Provider (Private Fork)", right-click and select **Extension Settings**
- **Method 2**: Go to **File → Preferences → Settings** (or `Ctrl+,`), then search for "bedrock"

**Available settings**:

1. **Context Window Size** (`bedrock.context1M.enabled`)
   - **Default**: Enabled
   - **Description**: Enable 1M token context window for Claude Sonnet 4.x and Opus 4.6 models
   - **Values**: `true` (1M context) or `false` (200K context)
   - **Note**: Enabling 1M context increases API costs but allows much larger conversations

2. **Thinking Effort** (`bedrock.thinking.effort`)
   - **Default**: `high`
   - **Description**: Controls how eager Claude is about spending tokens when thinking
   - **Values**:
     - `high` - Maximum capability (best quality, most tokens)
     - `medium` - Balanced approach (good quality, moderate tokens)
     - `low` - Most efficient (faster, fewer tokens, some capability reduction)
   - **Applies to**: Claude Opus 4.5, Opus 4.6, and Sonnet 4.6

3. **Extended Thinking** (`bedrock.thinking.enabled`)
   - **Default**: Enabled
   - **Description**: Enable extended thinking for supported Claude models
   - **Note**: When enabled, models reason through complex tasks before responding

These settings apply globally to all chat sessions using compatible models.

## Usage

Once configured, Bedrock models will appear in GitHub Copilot Chat's model selector. Simply:

1. Open GitHub Copilot Chat
2. Click on the model selector
3. Choose a Bedrock model (they will be labeled with "Amazon Bedrock")
4. Start chatting!

### Fallback Model Discovery

**Note**: The `nimbu-bedrock` IAM role does not provide certain optional AWS Bedrock permissions (`bedrock:ListFoundationModels`, `bedrock:GetInferenceProfile`, `bedrock:ListInferenceProfiles`). When these permissions are denied, the extension automatically uses a fallback discovery method:

1. **Model Detection**: Instead of querying AWS for all available models, the extension probes known Anthropic Claude inference profiles (global and regional) to determine which models are accessible with your current credentials.

2. **Access Validation**: For each known model profile, the extension makes a minimal test request to verify accessibility. Only models that successfully respond are added to the model list.

3. **Visual Indicator**: Models discovered through this fallback method will have the label `(Detected via inference profile)` appended to their names in the model selector.

4. **Supported Models**: The fallback currently detects the following Anthropic models when accessible:
   - Claude Opus 4.6
   - Claude Sonnet 4.6
   - Claude Sonnet 4.5
   - Claude Opus 4.5
   - Claude Haiku 4.5

This approach ensures the extension remains functional with minimal IAM permissions while still providing access to the latest Claude models through inference profiles.

## Troubleshooting

### Authentication errors

1. Verify your AWS credentials are valid and not expired
2. Check that your IAM user/role has the necessary Bedrock permissions:

   **Option 1: Use AWS Managed Policy (Recommended)**

   Attach the [`AmazonBedrockLimitedAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonBedrockLimitedAccess.html) managed policy to your IAM user or role. This policy includes all required permissions for using this extension.

   **Option 2: Minimal Policy (Required Permissions Only)**

   For environments with strict IAM policies, the extension works with only these permissions:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
         "Resource": "*"
       }
     ]
   }
   ```

   **Option 3: Enhanced Policy (Better Model Discovery)**

   For better user experience with automatic model discovery:
   - `bedrock:InvokeModel` - **Required** - Invoke models
   - `bedrock:InvokeModelWithResponseStream` - **Required** - Stream model responses
   - `bedrock:ListFoundationModels` - _Optional_ - List available models (fallback to Anthropic models if denied)
   - `bedrock:GetFoundationModelAvailability` - _Optional_ - Check model access status
   - `bedrock:ListInferenceProfiles` - _Optional_ - List cross-region inference profiles (fallback to known profiles if denied)
   - `bedrock:GetInferenceProfile` - _Optional_ - Resolve inference profile IDs (automatically normalized if denied)

## License

MIT
