#!/usr/bin/env bun
/**
 * Benchmark: provideTokenCount latency
 *
 * Measures how long provideTokenCount takes per call on the current branch.
 * Run on both main and feat/bedrock-pricing-v2 to compare.
 *
 * Usage:
 *   bun scripts/benchmark-token-count.ts [--profile <aws-profile>] [--region <region>] [--model <id>] [--runs <n>]
 *
 * Example:
 *   bun scripts/benchmark-token-count.ts --profile d2i_stg --region eu-central-1 --runs 10
 */

import { BedrockRuntimeClient, CountTokensCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";

// Parse CLI args
const args = process.argv.slice(2);
const get = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const PROFILE = get("--profile", "d2i_stg");
const REGION = get("--region", "eu-central-1");
const MODEL_ID = get("--model", "eu.anthropic.claude-sonnet-4-6");
const RUNS = parseInt(get("--runs", "10"), 10);

// Sample messages of varying sizes
const MESSAGES = [
  { role: "user" as const, content: [{ text: "Hello, how are you?" }] },
  {
    role: "user" as const,
    content: [
      {
        text: "Please help me write a TypeScript function that sorts an array of objects by a nested property. The function should be generic and handle undefined values gracefully.",
      },
    ],
  },
  {
    role: "user" as const,
    content: [
      {
        text: "Analyze this code:\n```typescript\nfunction processData(items: unknown[]) {\n  return items.map(item => {\n    if (typeof item === 'object' && item !== null) {\n      return JSON.stringify(item);\n    }\n    return String(item);\n  });\n}\n```\nWhat are the potential issues and how would you improve it?",
      },
    ],
  },
];

// Character-based estimation (what forceEstimateTokens uses)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function benchmarkCountTokensAPI(): Promise<{
  avg: number;
  min: number;
  max: number;
  samples: number[];
}> {
  const client = new BedrockRuntimeClient({
    credentials: fromIni({ profile: PROFILE }),
    region: REGION,
  });

  const samples: number[] = [];

  console.log(`\nBenchmarking CountTokens API (${RUNS} runs × ${MESSAGES.length} messages)...`);
  console.log(`  Profile: ${PROFILE}, Region: ${REGION}, Model: ${MODEL_ID}\n`);

  for (let run = 0; run < RUNS; run++) {
    for (const msg of MESSAGES) {
      const start = performance.now();
      try {
        await client.send(
          new CountTokensCommand({
            modelId: MODEL_ID,
            messages: [msg],
          }),
        );
      } catch (e) {
        // Some models don't support CountTokens — record as a failed call
        const err = e as Error;
        console.warn(`  CountTokens failed: ${err.message}`);
      }
      const elapsed = performance.now() - start;
      samples.push(elapsed);
      process.stdout.write(
        `  run ${run + 1}/${RUNS}, msg ${MESSAGES.indexOf(msg) + 1}: ${elapsed.toFixed(1)}ms\n`,
      );
    }
  }

  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = samples[0];
  const max = samples[samples.length - 1];
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p90 = samples[Math.floor(samples.length * 0.9)];

  console.log(
    `\n  avg=${avg.toFixed(1)}ms  min=${min.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  p90=${p90.toFixed(1)}ms  max=${max.toFixed(1)}ms`,
  );
  return { avg, min, max, samples };
}

function benchmarkEstimation(): { avg: number; min: number; max: number } {
  const samples: number[] = [];

  console.log(
    `\nBenchmarking character estimation (${RUNS} runs × ${MESSAGES.length} messages)...`,
  );

  for (let run = 0; run < RUNS; run++) {
    for (const msg of MESSAGES) {
      const text = msg.content[0].text;
      const start = performance.now();
      estimateTokens(text);
      const elapsed = performance.now() - start;
      samples.push(elapsed);
    }
  }

  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = samples[0];
  const max = samples[samples.length - 1];
  console.log(
    `  avg=${avg.toFixed(4)}ms  min=${min.toFixed(4)}ms  max=${max.toFixed(4)}ms  (effectively zero)`,
  );
  return { avg, min, max };
}

// Check if we're on main or the perf branch by looking for validateTokenCount
import { readFileSync } from "fs";
const providerSrc = readFileSync(new URL("../src/provider.ts", import.meta.url), "utf8");
const hasPreflightCheck = providerSrc.includes("validateTokenCount");
const hasEarlyToolEmission = readFileSync(
  new URL("../src/stream-processor.ts", import.meta.url),
  "utf8",
).includes("tryEarlyToolEmission");

console.log("=".repeat(60));
console.log("Bedrock Extension Token Count Benchmark");
console.log("=".repeat(60));
console.log(`Branch characteristics:`);
console.log(
  `  Pre-flight CountTokens check (validateTokenCount): ${hasPreflightCheck ? "✅ PRESENT (main)" : "❌ REMOVED (perf branch)"}`,
);
console.log(
  `  Early tool emission (tryEarlyToolEmission):         ${hasEarlyToolEmission ? "✅ PRESENT (main)" : "❌ REMOVED (perf branch)"}`,
);

benchmarkEstimation();
await benchmarkCountTokensAPI();

console.log("\n" + "=".repeat(60));
console.log("Summary");
console.log("=".repeat(60));
console.log(`
On main branch (before this PR):
  - provideTokenCount: ~CountTokens API latency per call (see above)
  - validateTokenCount: same latency AGAIN before every ConverseStream call
  - Total overhead per turn: ~2× CountTokens API latency

On feat/bedrock-pricing-v2 (this PR):
  - provideTokenCount: same CountTokens API latency (or ~0ms with forceEstimateTokens)
  - validateTokenCount: REMOVED — 0ms overhead before ConverseStream
  - Total overhead per turn: ~1× CountTokens API latency (or 0ms if forceEstimateTokens=true)

Savings per turn = 1× CountTokens API call = the avg latency shown above.
`);
