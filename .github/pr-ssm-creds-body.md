This PR fixes region selection failing with "Could not load credentials from any providers" when a user has set non-default auth.

Changes

- Reuse previously provided credentials (profile or access keys) to call SSM when fetching Bedrock regions
- Fallback to the default credential provider chain if none are configured
- Thread credentials into the region selection flow

Details

- `getBedrockRegionsFromSSM` optionally accepts `{ globalState, secrets }` and resolves credentials
- `resolveSsmCredentials` prioritizes:
  1. Selected method: Access Keys, then Profile
  2. Any stored Access Keys or Profile
  3. Default provider chain
- Still queries SSM in `us-east-1`
- If SSM still can’t be called, we gracefully prompt for manual region

Testing

- Set auth method to **Profile** and choose a profile → Region list loads
- Set auth method to **Access Keys** with valid keys → Region list loads
- With only **API Key** configured and no other creds → Manual prompt appears

No API surface changes beyond optional parameters; existing callers continue to work.
