/**
 * End-to-end Snapshot Tests for Calculator Not Included CLI.
 *
 * Verifies that the command line version of the calculator accurately decodes
 * base64 protocol buffers, resolves system balances, and outputs the exact
 * text version of the web UI table for every preset in the calculator.
 *
 * Run with:
 *   node tests/test_cli_snapshots.js
 *   node tests/test_cli_snapshots.js --update  # to update snapshots
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PRESETS, getPresetById } from "../src/presets.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import { encodeStateToParam } from "../src/url_state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.resolve(__dirname, "snapshots");
const CLI_PATH = path.resolve(__dirname, "../bin/calc.js");

const shouldUpdate = process.argv.includes("--update") || process.env.UPDATE_SNAPSHOTS === "1";

console.log("=== Running End-to-End CLI Snapshot Tests ===");

if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

const catalog = buildEntityCatalog();

// 1. Snapshot Tests for Every Built-in Preset
for (const preset of PRESETS) {
  const encoded = encodeStateToParam(preset, catalog.elementMap);
  assert.ok(encoded && encoded.length > 0, `Preset ${preset.id} must serialize to a non-empty base64 string`);

  // Execute CLI passing the base64 protocol buffer string
  const stdout = execFileSync(process.execPath, [CLI_PATH, encoded], {
    encoding: "utf8",
    env: process.env,
  }).trim();

  const snapshotFile = path.join(SNAPSHOTS_DIR, `${preset.id}.txt`);

  if (shouldUpdate || !fs.existsSync(snapshotFile)) {
    fs.writeFileSync(snapshotFile, stdout + "\n", "utf8");
    console.log(`✓ [SNAPSHOT CREATED/UPDATED] ${preset.id}.txt`);
  } else {
    const expected = fs.readFileSync(snapshotFile, "utf8").trim();
    if (stdout !== expected) {
      console.error(`\n❌ Snapshot mismatch for preset "${preset.id}"!`);
      console.error(`--- Expected (${snapshotFile}) ---`);
      console.error(expected);
      console.error(`\n--- Actual CLI Output ---`);
      console.error(stdout);
      assert.strictEqual(
        stdout,
        expected,
        `CLI output for preset "${preset.id}" does not match snapshot file tests/snapshots/${preset.id}.txt`
      );
    }
    console.log(`✓ Preset snapshot verified: ${preset.id} (${preset.name})`);
  }
}

// 2. CLI --preset Flag Parity
{
  for (const preset of PRESETS) {
    const stdout = execFileSync(process.execPath, [CLI_PATH, "--preset", preset.id], {
      encoding: "utf8",
    }).trim();
    const snapshotFile = path.join(SNAPSHOTS_DIR, `${preset.id}.txt`);
    const expected = fs.readFileSync(snapshotFile, "utf8").trim();
    assert.strictEqual(
      stdout,
      expected,
      `CLI --preset ${preset.id} must match the base64 protocol buffer snapshot`
    );
  }
  console.log("✓ All presets match identically whether loaded via --preset or base64 protocol buffer");
}

// 3. Stdin Pipe Input Verification
{
  const testPreset = PRESETS[0]; // hydra_spom
  const encoded = encodeStateToParam(testPreset, catalog.elementMap);

  const proc = spawnSync(process.execPath, [CLI_PATH], {
    input: encoded + "\n",
    encoding: "utf8",
  });

  assert.strictEqual(proc.status, 0, "CLI should succeed when reading from stdin");
  const expected = fs.readFileSync(path.join(SNAPSHOTS_DIR, `${testPreset.id}.txt`), "utf8").trim();
  assert.strictEqual(proc.stdout.trim(), expected, "Piped stdin output must match snapshot");
  console.log("✓ Stdin pipe input verified");
}

// 4. Full Web URL Parameter Extraction
{
  const testPreset = PRESETS[1]; // coal_skimmer_loop
  const encoded = encodeStateToParam(testPreset, catalog.elementMap);
  const fullUrl = `https://fatlotus.github.io/calculator-not-included/?s=${encoded}#share`;

  const stdout = execFileSync(process.execPath, [CLI_PATH, fullUrl], {
    encoding: "utf8",
  }).trim();

  const expected = fs.readFileSync(path.join(SNAPSHOTS_DIR, `${testPreset.id}.txt`), "utf8").trim();
  assert.strictEqual(stdout, expected, "Full web URL with ?s= parameter must extract and match snapshot");
  console.log("✓ Web URL parameter extraction verified");
}

// 5. JSON Output Mode
{
  const testPreset = PRESETS[0];
  const encoded = encodeStateToParam(testPreset, catalog.elementMap);

  const stdout = execFileSync(process.execPath, [CLI_PATH, encoded, "--json"], {
    encoding: "utf8",
  }).trim();

  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.rateMode, "s", "JSON output should have rateMode 's'");
  assert.ok(Array.isArray(parsed.rowsData), "JSON output should have rowsData array");
  assert.strictEqual(parsed.rowsData.length, testPreset.rows.length, "JSON rowsData length should match preset");
  assert.ok(parsed.netData, "JSON output should contain netData");
  assert.ok(Number.isFinite(parsed.netData.net.netPower), "JSON net should contain finite netPower");
  assert.ok(parsed.preset?.id === testPreset.id, "JSON output should identify matching preset");
  console.log("✓ JSON output format verified");
}

// 6. Rate Mode Override
{
  const testPreset = PRESETS[0];
  const encoded = encodeStateToParam(testPreset, catalog.elementMap);

  const stdoutCycle = execFileSync(process.execPath, [CLI_PATH, encoded, "--rate", "c"], {
    encoding: "utf8",
  }).trim();

  assert.ok(stdoutCycle.includes("Rate Mode: per cycle (600s)"), "Output should show cycle rate mode");
  assert.ok(stdoutCycle.includes("/cycle"), "Output should contain per-cycle units");
  console.log("✓ Rate mode override (--rate c) verified");
}

// 7. CLI Help and Preset Listing Flags
{
  const helpOut = execFileSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
  });
  assert.ok(helpOut.includes("Calculator Not Included"), "Help output should contain app name");
  assert.ok(helpOut.includes("Usage:"), "Help output should contain Usage");

  const listOut = execFileSync(process.execPath, [CLI_PATH, "--presets"], {
    encoding: "utf8",
  });
  for (const p of PRESETS) {
    assert.ok(listOut.includes(p.id), `Presets list should contain ${p.id}`);
  }
  console.log("✓ CLI help and preset listing flags verified");
}

console.log("\n ALL END-TO-END SNAPSHOT TESTS PASSED SUCCESSFULLY! \n");
