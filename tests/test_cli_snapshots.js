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

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PRESETS } from "../src/presets.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import { encodeStateToParam } from "../src/url_state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = path.resolve(__dirname, "snapshots");
const CLI_PATH = path.resolve(__dirname, "../bin/calc.js");
const shouldUpdate = process.argv.includes("--update") || process.env.UPDATE_SNAPSHOTS === "1";

if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

const catalog = buildEntityCatalog();

describe("CLI Snapshot Verification", () => {
  for (const preset of PRESETS) {
    it(`matches snapshot for preset "${preset.id}" (${preset.name})`, () => {
      const encoded = encodeStateToParam(preset, catalog.elementMap);
      assert.ok(encoded && encoded.length > 0, `Preset ${preset.id} must serialize to a non-empty base64 string`);

      const stdout = execFileSync(process.execPath, [CLI_PATH, encoded], {
        encoding: "utf8",
        env: process.env,
      }).trim();

      const snapshotFile = path.join(SNAPSHOTS_DIR, `${preset.id}.txt`);

      if (shouldUpdate || !fs.existsSync(snapshotFile)) {
        fs.writeFileSync(snapshotFile, stdout + "\n", "utf8");
      } else {
        const expected = fs.readFileSync(snapshotFile, "utf8").trim();
        assert.strictEqual(
          stdout,
          expected,
          `CLI output for preset "${preset.id}" does not match snapshot file tests/snapshots/${preset.id}.txt`
        );
      }
    });
  }
});

describe("CLI Invocation Modes & Flags", () => {
  it("produces identical output when loaded via --preset flag vs base64 protocol buffer", () => {
    // Test representative presets (SPOM, complex loop, boiler)
    const testPresetIds = ["hydra_spom", "coal_skimmer_loop", "petroleum_boiler"];
    for (const presetId of testPresetIds) {
      const stdout = execFileSync(process.execPath, [CLI_PATH, "--preset", presetId], {
        encoding: "utf8",
      }).trim();
      const snapshotFile = path.join(SNAPSHOTS_DIR, `${presetId}.txt`);
      const expected = fs.readFileSync(snapshotFile, "utf8").trim();
      assert.strictEqual(
        stdout,
        expected,
        `CLI --preset ${presetId} must match the snapshot`
      );
    }
  });

  it("reads base64 protocol buffer from standard input (pipe)", () => {
    const testPreset = PRESETS[0]; // hydra_spom
    const encoded = encodeStateToParam(testPreset, catalog.elementMap);

    const proc = spawnSync(process.execPath, [CLI_PATH], {
      input: encoded + "\n",
      encoding: "utf8",
    });

    assert.strictEqual(proc.status, 0, "CLI should succeed when reading from stdin");
    const expected = fs.readFileSync(path.join(SNAPSHOTS_DIR, `${testPreset.id}.txt`), "utf8").trim();
    assert.strictEqual(proc.stdout.trim(), expected, "Piped stdin output must match snapshot");
  });

  it("extracts state parameter from full web URL with fragments", () => {
    const testPreset = PRESETS[1]; // coal_skimmer_loop
    const encoded = encodeStateToParam(testPreset, catalog.elementMap);
    const fullUrl = `https://fatlotus.github.io/calculator-not-included/?s=${encoded}#share`;

    const stdout = execFileSync(process.execPath, [CLI_PATH, fullUrl], {
      encoding: "utf8",
    }).trim();

    const expected = fs.readFileSync(path.join(SNAPSHOTS_DIR, `${testPreset.id}.txt`), "utf8").trim();
    assert.strictEqual(stdout, expected, "Full web URL with ?s= parameter must extract and match snapshot");
  });

  it("supports JSON output format (--json)", () => {
    const testPreset = PRESETS[0];
    const encoded = encodeStateToParam(testPreset, catalog.elementMap);

    const stdout = execFileSync(process.execPath, [CLI_PATH, encoded, "--json"], {
      encoding: "utf8",
    }).trim();

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.rateMode, "s");
    assert.ok(Array.isArray(parsed.rowsData));
    assert.strictEqual(parsed.rowsData.length, testPreset.rows.length);
    assert.ok(parsed.netData);
    assert.ok(Number.isFinite(parsed.netData.net.netPower));
    assert.ok(parsed.preset?.id === testPreset.id);
  });

  it("supports per-cycle rate mode override (--rate c)", () => {
    const testPreset = PRESETS[0];
    const encoded = encodeStateToParam(testPreset, catalog.elementMap);

    const stdoutCycle = execFileSync(process.execPath, [CLI_PATH, encoded, "--rate", "c"], {
      encoding: "utf8",
    }).trim();

    assert.ok(stdoutCycle.includes("Rate Mode: per cycle (600s)"));
    assert.ok(stdoutCycle.includes("/cycle"));
  });

  it("displays help and preset listings (--help, --presets)", () => {
    const helpOut = execFileSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
    });
    assert.ok(helpOut.includes("Calculator Not Included"));
    assert.ok(helpOut.includes("Usage:"));

    const listOut = execFileSync(process.execPath, [CLI_PATH, "--presets"], {
      encoding: "utf8",
    });
    for (const p of PRESETS) {
      assert.ok(listOut.includes(p.id), `Presets list should contain ${p.id}`);
    }
  });
});
