/**
 * models.dev registry loader.
 *
 * Loads the bundled `models-dev-cache.json` snapshot and exposes it as a
 * `ModelsDevMap` keyed by Bedrock model ID. Keeping this separate from
 * `bedrock-client.ts` makes the boundary clear: the Bedrock API client talks
 * to AWS; this module talks to the local model-metadata registry.
 *
 * To refresh the cache: run `scripts/update-models-cache.sh` and commit the
 * updated `src/models-dev-cache.json`.
 */

import { logger } from "./logger";
import modelsDevCache from "./models-dev-cache.json";
import type { ModelsDevEntry, ModelsDevMap } from "./types";

/**
 * Load the bundled models.dev cache.
 *
 * Returns a `ModelsDevMap` built from `src/models-dev-cache.json`. The cache
 * is committed to the repo so the extension works offline and every update is
 * an explicit, auditable change.
 *
 * To refresh: run `scripts/update-models-cache.sh` and commit the result.
 */
export function loadModelsDevData(): ModelsDevMap {
  const result = parseModelsDevData(modelsDevCache as Record<string, unknown>);
  logger.debug(`[models.dev] Loaded ${result.size} models from bundled cache`);
  return result;
}

/**
 * Parse a raw models.dev JSON object into a ModelsDevMap for the
 * `amazon-bedrock` provider. Entries without valid `limit.context` /
 * `limit.output` numbers are silently skipped.
 */
function parseModelsDevData(data: Record<string, unknown>): ModelsDevMap {
  const result: ModelsDevMap = new Map();
  const bedrockProvider = data["amazon-bedrock"] as
    | undefined
    | { models?: Record<string, ModelsDevEntry> };

  if (!bedrockProvider?.models) {
    logger.warn("[models.dev] Cache missing amazon-bedrock provider section");
    return result;
  }

  for (const [modelId, model] of Object.entries(bedrockProvider.models)) {
    if (typeof model.limit?.context === "number" && typeof model.limit.output === "number") {
      result.set(modelId, model);
    }
  }
  return result;
}
