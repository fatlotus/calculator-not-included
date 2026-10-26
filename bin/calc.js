#!/usr/bin/env node

/**
 * Command-line interface for Oxygen Not Included Resource Calculator.
 *
 * Takes a base64 encoded protocol buffer (or preset ID, URL, or stdin)
 * and outputs a text version of the web UI table, including machine inputs/outputs
 * and the resulting NET balance of the system.
 *
 * Usage:
 *   calc <base64_or_url>
 *   calc --preset <preset_id>
 *   echo "<base64>" | calc
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntityCatalog } from "../src/data_loader.js";
import { PRESETS, getPresetById } from "../src/presets.js";
import { decodeStateFromParam } from "../src/url_state.js";
import { renderStateToText, computeStateData } from "../src/text_renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`
Calculator Not Included — Command Line Interface

Usage:
  calc <base64_state_or_url> [options]
  calc --preset <preset_id> [options]
  echo "<base64_state>" | calc [options]

Arguments:
  <base64_state_or_url>     Base64 encoded Protocol Buffer state, ?s= parameter, or full URL

Options:
  -p, --preset <id>         Load a built-in preset by its identifier
  -l, --presets, --list     List all available presets
  -r, --rate <s|c>          Override rate mode: 's' for per second, 'c' for per cycle
      --json                Output result as structured JSON instead of formatted text table
      --no-header           Omit the preset title and description header
  -h, --help                Show this help message
  -v, --version             Show version number

Examples:
  calc EgQIIBABEg4IRhmamZmZmZm5PyDNARINCCMZeekmMQiszD8gPxILCEEZ7FG4HoXr8T8SBggeEAhAGQ
  calc "https://fatlotus.github.io/calculator-not-included/?s=EgQIIBAB..."
  calc --preset hydra_spom
  calc --preset coal_skimmer_loop --rate c
  calc --presets
`);
}

function printPresets() {
  console.log("\nAvailable Presets:\n");
  for (const p of PRESETS) {
    console.log(`  ${p.id.padEnd(30)} ${p.name}`);
    console.log(`  ${"".padEnd(30)} ${p.description}\n`);
  }
}

async function readAllStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  let presetArg = null;
  let rateOverride = null;
  let jsonOutput = false;
  let showHeader = true;
  let positionalArg = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "-v" || arg === "--version") {
      const pkgPath = path.resolve(__dirname, "../package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      console.log(`calc v${pkg.version}`);
      process.exit(0);
    } else if (arg === "-l" || arg === "--presets" || arg === "--list") {
      printPresets();
      process.exit(0);
    } else if (arg === "-p" || arg === "--preset") {
      presetArg = args[++i];
    } else if (arg === "-r" || arg === "--rate") {
      rateOverride = args[++i];
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--no-header") {
      showHeader = false;
    } else if (!arg.startsWith("-")) {
      positionalArg = arg;
    }
  }

  let state = null;
  let presetObj = null;

  if (presetArg) {
    presetObj = getPresetById(presetArg);
    if (!presetObj || presetObj.id !== presetArg) {
      // Check if exact match failed
      const exact = PRESETS.find((p) => p.id === presetArg);
      if (!exact) {
        console.error(`Error: Unknown preset "${presetArg}". Use --presets to list available presets.`);
        process.exit(1);
      }
      presetObj = exact;
    }
    state = JSON.parse(JSON.stringify(presetObj));
  } else if (positionalArg) {
    state = decodeStateFromParam(positionalArg);
  } else {
    // Attempt reading from stdin
    const stdinContent = await readAllStdin();
    if (stdinContent) {
      state = decodeStateFromParam(stdinContent);
    }
  }

  if (!state) {
    printHelp();
    process.exit(1);
  }

  if (rateOverride) {
    const r = rateOverride.toLowerCase();
    if (r === "c" || r === "cycle") {
      state.rateMode = "c";
      state.unit = "c";
    } else if (r === "s" || r === "sec" || r === "second") {
      state.rateMode = "s";
      state.unit = "s";
    }
  }

  const catalog = buildEntityCatalog();

  if (jsonOutput) {
    const data = computeStateData(state, catalog);
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }

  const output = renderStateToText(state, {
    catalog,
    title: presetObj?.name,
    description: presetObj?.description,
    showPresetInfo: showHeader,
  });

  console.log(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
