# Testing Guide

This guide will help you test the amazon-bedrock-copilot-chat extension.

## Prerequisites

Before testing, ensure you have:

1. **Visual Studio Code** version 1.104.0 or higher
2. **GitHub Copilot** subscription and extension installed
3. **AWS Credentials** configured in one of:
   - `~/.aws/credentials`
   - `~/.aws/config`
   - Environment variables
4. **AWS IAM Permissions** for:
   - `bedrock:ListFoundationModels`
   - `bedrock:ListInferenceProfiles`
   - `bedrock:InvokeModel`
   - `bedrock:InvokeModelWithResponseStream`

## Setting Up AWS Credentials

If you don't have AWS credentials configured yet:

1. **Install AWS CLI** (optional but recommended):
   ```bash
   # macOS
   brew install awscli
   
   # Windows
   # Download from https://aws.amazon.com/cli/
   
   # Linux
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   ```

2. **Configure credentials**:
   ```bash
   aws configure --profile bedrock-dev
   # Enter your AWS Access Key ID
   # Enter your AWS Secret Access Key
   # Enter your default region (e.g., us-east-1)
   # Enter default output format (json)
   ```

   Or manually create `~/.aws/credentials`:
   ```ini
   [default]
   aws_access_key_id = YOUR_ACCESS_KEY
   aws_secret_access_key = YOUR_SECRET_KEY
   
   [bedrock-dev]
   aws_access_key_id = YOUR_ACCESS_KEY
   aws_secret_access_key = YOUR_SECRET_KEY
   ```

   And `~/.aws/config`:
   ```ini
   [default]
   region = us-east-1
   
   [profile bedrock-dev]
   region = us-east-1
   ```

## Running the Extension in Development Mode

1. **Open the project in VSCode**:
   ```bash
   cd amazon-bedrock-copilot-chat
   code .
   ```

2. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

3. **Compile the extension**:
   ```bash
   npm run compile
   ```

4. **Launch Extension Development Host**:
   - Press `F5` or
   - Go to Run and Debug (Ctrl+Shift+D / Cmd+Shift+D)
   - Select "Run Extension" and click the green play button

   This will:
   - Compile the TypeScript code
   - Open a new VSCode window with the extension loaded
   - The extension will be available but not yet configured

## Configuring the Extension

In the Extension Development Host window:

1. **Open Command Palette**:
   - Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)

2. **Run "Manage AWS Bedrock Provider"**:
   - Type "Manage AWS Bedrock Provider"
   - Press Enter

3. **Set AWS Profile**:
   - Select "Set AWS Profile"
   - Choose a profile from the list or "Default Credentials"
   - Confirm the selection

4. **Set Region** (if needed):
   - Run "Manage AWS Bedrock Provider" again
   - Select "Set Region"
   - Choose your preferred AWS region (e.g., us-east-1)

## Testing Chat Functionality

1. **Open GitHub Copilot Chat**:
   - Click the Copilot icon in the Activity Bar, or
   - Press `Ctrl+Alt+I` (Windows/Linux) or `Cmd+Alt+I` (macOS)

2. **Select a Bedrock Model**:
   - Click on the model selector (usually shows "@copilot" by default)
   - Look for models labeled "AWS Bedrock"
   - Select a model (e.g., "Claude 3.5 Sonnet")

3. **Test Basic Chat**:
   ```
   Hello! Can you help me write a Python function?
   ```

4. **Test Tool Calling** (if supported by the model):
   ```
   @workspace What files are in my project?
   ```

5. **Test Vision** (for vision-capable models):
   - Attach an image to your message
   - Ask a question about the image

## Checking Logs

If you encounter issues:

1. **Open Output Panel**:
   - View > Output (Ctrl+Shift+U / Cmd+Shift+U)

2. **Select "Bedrock Chat" from the dropdown**:
   - This shows logs from the extension
   - Look for error messages or warnings

3. **Check Developer Console**:
   - Help > Toggle Developer Tools
   - Check the Console tab for any errors

## Common Test Scenarios

### Test 1: Profile Switching
1. Configure profile A
2. Send a chat message
3. Switch to profile B
4. Send another chat message
5. Verify both profiles work correctly

### Test 2: Region Switching
1. Set region to us-east-1
2. Check available models
3. Switch to eu-west-1
4. Verify models list updates (may differ by region)

### Test 3: Model Comparison
1. Send the same prompt to different models
2. Compare response quality and speed
3. Test different model families (Claude, Llama, Mistral)

### Test 4: Error Handling
1. Clear AWS credentials temporarily
2. Try to use the extension
3. Verify error messages are helpful
4. Restore credentials and verify recovery

### Test 5: Stream Processing
1. Ask for a long response (e.g., "Write a detailed blog post about AI")
2. Verify streaming works (text appears progressively)
3. Test cancellation (click stop button mid-stream)

## Debugging

If you need to debug the extension:

1. **Set Breakpoints**:
   - Open source files in the main VSCode window
   - Click in the gutter to set breakpoints

2. **Inspect Variables**:
   - When breakpoint is hit, check the Debug panel
   - Inspect variables, call stack, etc.

3. **Step Through Code**:
   - Use F10 (step over), F11 (step into), Shift+F11 (step out)

## Performance Testing

1. **Measure Response Time**:
   - Note the time between sending a message and first token
   - Compare different models and regions

2. **Test Token Limits**:
   - Send very long messages
   - Verify token limit enforcement

3. **Test Concurrent Requests**:
   - Open multiple chat windows
   - Send messages simultaneously

## Security Testing

1. **Verify Credential Handling**:
   - Check that credentials are never logged
   - Verify secure storage of profile selection

2. **Test Permission Errors**:
   - Use credentials with limited permissions
   - Verify error messages don't leak sensitive info

## Reporting Issues

When reporting issues, include:

1. **Extension version** (from package.json)
2. **VSCode version** (Help > About)
3. **AWS Region** being used
4. **Model ID** that failed
5. **Error message** from logs
6. **Steps to reproduce**

## Success Criteria

The extension is working correctly if:

- ✅ AWS profiles are listed correctly
- ✅ Selected profile is persisted between sessions
- ✅ Bedrock models appear in the model selector
- ✅ Chat messages receive responses
- ✅ Streaming works smoothly
- ✅ Tool calling works (when supported)
- ✅ Error messages are clear and helpful
- ✅ Logs provide debugging information

## Next Steps

After successful testing:

1. Package the extension: `vsce package`
2. Install locally: `code --install-extension amazon-bedrock-copilot-chat-0.0.1.vsix`
3. Consider publishing to VS Marketplace
4. Share feedback and improvements
