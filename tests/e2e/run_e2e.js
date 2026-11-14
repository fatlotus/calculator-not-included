#!/usr/bin/env node

/**
 * Sequential E2E Test Runner for Emission Support (Tiers 1–5).
 * Runs all 5 tier test files via `node --test` and exits 0 only if all pass.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const TIER_FILES = [
  "tests/e2e/tier1_features.test.js",
  "tests/e2e/tier2_boundaries.test.js",
  "tests/e2e/tier3_combinations.test.js",
  "tests/e2e/tier4_scenarios.test.js",
  "tests/e2e/tier5_adversarial.test.js",
];

let allPassed = true;

for (const file of TIER_FILES) {
  console.log(`\n=== Running ${file} ===`);
  const res = spawnSync(process.execPath, ["--test", file], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    allPassed = false;
    console.error(`FAILED: ${file} (exit code ${res.status})`);
  }
}

if (!allPassed) {
  console.error("\nOne or more E2E test tiers failed.");
  process.exit(1);
}

console.log("\nAll E2E test tiers (Tiers 1-5) passed.");
process.exit(0);
