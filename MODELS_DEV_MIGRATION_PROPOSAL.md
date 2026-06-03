# Proposal: Full Migration to models.dev

## Current State (Hybrid Approach)

After commit `c610e7c`, we have a **hybrid architecture**:

### What models.dev provides (used):

- `limit.context` / `limit.output` → token limits for 91+ Bedrock models
- `temperature: false` → identifies temperatureDeprecated models
- `reasoning: true` → auto-shows reasoningEffort picker for non-Anthropic models
- `modalities.input` → replaces Bedrock API inputModalities for vision detection

### What profiles.ts still hardcodes (Bedrock-specific):

- `supportsThinkingEffort` / `requiresAdaptiveThinking` (Claude thinking API shape)
- `requiresInterleavedThinkingHeader` (Claude 4 beta header requirement)
- `supportsPromptCaching` / `supportsCachingWithToolResults`
- `supportsToolChoice` / `supportsToolResultStatus`
- `toolResultFormat` (json vs text)

## Proposal: Complete models.dev Migration

### Architecture Options

#### Option A: Live Fetch Only

**Implementation:**

- Remove all hardcoded limits from `profiles.ts`
- Fetch models.dev at startup (current 5s timeout)
- Fall back to minimal safe defaults if fetch fails

**Pros:**

- Always up-to-date with latest model releases
- Zero maintenance for token limits
- Smallest extension bundle size

**Cons:**

- Startup latency (currently ~200-500ms for fetch)
- Offline/network failure requires fallbacks
- models.dev downtime breaks new model detection

#### Option B: Cached JSON with Refresh

**Implementation:**

- Ship a bundled `models-dev-cache.json` snapshot in the extension
- Fetch live models.dev at startup in background
- Use cached version if fetch fails or times out
- Periodic refresh (e.g., check once per day)

**Pros:**

- Instant startup (no blocking fetch)
- Offline support with bundled cache
- Still gets updates from live API when available

**Cons:**

- Requires periodic cache updates (manual or automated)
- Slightly larger bundle size (~50KB JSON)
- Cache can become stale between extension releases

#### Option C: Hybrid with models.dev Primary (Current + Cleanup)

**Implementation:**

- Keep current live fetch approach
- Move ALL behavioral flags to models.dev (work with maintainer to add fields)
- Keep only Bedrock API quirks in profiles.ts (e.g., header requirements)

**Pros:**

- Gradual migration path
- Can contribute missing fields upstream to models.dev
- Maintains separation of concerns (API quirks vs capabilities)

**Cons:**

- Requires coordination with models.dev maintainer
- Still maintains two sources of truth during transition

### Recommended Approach: **Option B (Cached JSON with Refresh)**

**Rationale:**

1. **User Experience:** No startup latency, works offline
2. **Maintenance:** Automated cache updates via CI/CD (fetch models.dev weekly, commit if changed)
3. **Reliability:** Graceful degradation if models.dev is down
4. **Freshness:** Still benefits from live API when available

**Implementation Plan:**

1. **Add bundled cache:**

   ```bash
   # scripts/update-models-cache.sh
   curl -s https://models.dev/api.json > src/models-dev-cache.json
   ```

2. **Update bedrock-client.ts:**

   ```typescript
   import modelsDevCache from './models-dev-cache.json';

   async fetchModelsDevData(): Promise<ModelsDevMap> {
     try {
       // Try live fetch first (non-blocking, background)
       const live = await this.fetchModelsDevLive();
       return live;
     } catch {
       // Fall back to bundled cache
       return this.parseModelsDevData(modelsDevCache);
     }
   }
   ```

3. **Add CI workflow:**

   ```yaml
   # .github/workflows/update-models-cache.yml
   name: Update models.dev cache
   on:
     schedule:
       - cron: "0 0 * * 0" # Weekly on Sunday
     workflow_dispatch:

   jobs:
     update:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: ./scripts/update-models-cache.sh
         - uses: peter-evans/create-pull-request@v6
           with:
             title: "chore: update models.dev cache"
             body: "Automated weekly update of bundled models.dev cache"
   ```

4. **Gradually migrate profiles.ts:**
   - Phase 1: Remove `getModelTokenLimits()` entirely (already done via `resolveModelLimits`)
   - Phase 2: Propose adding missing fields to models.dev:
     - `thinking.effort: boolean` → replaces `supportsThinkingEffort`
     - `thinking.adaptive: boolean` → replaces `requiresAdaptiveThinking`
     - `caching.supported: boolean` → replaces `supportsPromptCaching`
     - `tools.choice: boolean` → replaces `supportsToolChoice`
   - Phase 3: Keep only truly Bedrock-specific quirks in profiles.ts:
     - `requiresInterleavedThinkingHeader` (AWS beta header requirement)
     - `supportsCachingWithToolResults` (AWS-specific limitation)
     - `toolResultFormat` (AWS API convention)

## Migration Benefits

### Immediate:

- ✅ No more hardcoded token limits to maintain
- ✅ New models auto-detected with correct capabilities
- ✅ Consistent with Kilo Code's model registry

### Long-term:

- ✅ Community-maintained model metadata (contribute upstream)
- ✅ Cross-tool consistency (any tool using models.dev gets same data)
- ✅ Reduced extension maintenance burden

## Open Questions

1. **Upstream Contribution:** Should we propose adding Bedrock-specific fields to models.dev schema?
   - Pros: Benefits entire ecosystem (other Bedrock tools can use it)
   - Cons: Requires buy-in from models.dev maintainer

2. **Cache Update Frequency:** Weekly? Daily? On-demand?
   - Recommendation: Weekly automated, plus manual trigger for urgent updates

3. **Fallback Strategy:** What happens if both live fetch AND cache are unavailable?
   - Recommendation: Ultra-minimal defaults (128K context, 4K output) with warning toast

## Next Steps

1. Implement Option B (cached JSON with refresh)
2. Open issue on models.dev repo proposing Bedrock-specific fields
3. Gradually deprecate profiles.ts hardcoded capabilities as models.dev adoption grows
4. Document the migration path in CONTRIBUTING.md for future maintainers
