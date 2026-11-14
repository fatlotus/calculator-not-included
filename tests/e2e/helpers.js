/**
 * Shared opaque-box E2E test helpers for Emission Support (`tests/e2e/`).
 * Uses exclusively public entry points and Interface Contracts from PROJECT.md.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntityCatalog } from "../../src/data_loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const CLI_PATH = path.resolve(REPO_ROOT, "bin/calc.js");

/**
 * Canonical 7 emission recipes from PROJECT.md § Interface Contracts.
 */
export const EMISSION_RECIPES = [
  {
    feature: 2,
    id: "emit_polluted_water",
    input: "Polluted Water",
    output: "Polluted Oxygen",
    sourcePhase: "Liquid",
  },
  {
    feature: 3,
    id: "emit_polluted_dirt",
    input: "Polluted Dirt",
    output: "Polluted Oxygen",
    sourcePhase: "Solid",
  },
  {
    feature: 4,
    id: "emit_polluted_mud",
    input: "Polluted Mud",
    output: "Polluted Oxygen",
    sourcePhase: "Solid",
  },
  {
    feature: 5,
    id: "emit_slime",
    input: "Slime",
    output: "Polluted Oxygen",
    sourcePhase: "Solid",
  },
  {
    feature: 6,
    id: "emit_bleach_stone",
    input: "Bleach Stone",
    output: "Chlorine",
    sourcePhase: "Solid",
  },
  {
    feature: 7,
    id: "emit_oxylite",
    input: "Oxylite",
    output: "Oxygen",
    sourcePhase: "Solid",
  },
  {
    feature: 8,
    id: "emit_rot_pile",
    input: "Rot Pile",
    output: "Polluted Oxygen",
    sourcePhase: "Solid",
  },
];

export const EMISSION_RECIPE_ENUM_NAMES = [
  "RECIPE_EMIT_POLLUTED_WATER",
  "RECIPE_EMIT_POLLUTED_DIRT",
  "RECIPE_EMIT_POLLUTED_MUD",
  "RECIPE_EMIT_SLIME",
  "RECIPE_EMIT_BLEACH_STONE",
  "RECIPE_EMIT_OXYLITE",
  "RECIPE_EMIT_ROT_PILE",
];

let _cachedCatalog = null;

/**
 * Load and cache the unified entity/element catalog.
 */
export function getCatalog() {
  if (!_cachedCatalog) {
    _cachedCatalog = buildEntityCatalog();
  }
  return _cachedCatalog;
}

/**
 * Build a generic calculator row object.
 */
export function makeRow(entityId, qty = 1, extra = {}) {
  return {
    entityId,
    qty,
    recipeId: null,
    modifiers: [],
    ...extra,
  };
}

/**
 * Build an Emission Meta-Machine row object.
 */
export function makeEmissionRow(recipeId, qty = 1, extra = {}) {
  return {
    entityId: "emission",
    qty,
    recipeId,
    modifiers: [],
    ...extra,
  };
}

/**
 * Assert that `actual` is a finite number within `tol` of `expected`.
 */
export function assertClose(actual, expected, tol = 1e-4, msg = "") {
  assert.equal(
    typeof actual,
    "number",
    `${msg ? msg + ": " : ""}expected number, got ${typeof actual} (${actual})`
  );
  assert.ok(
    Number.isFinite(actual),
    `${msg ? msg + ": " : ""}expected finite number, got ${actual}`
  );
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tol,
    `${msg ? msg + ": " : ""}expected ${expected} ± ${tol}, got ${actual} (diff=${diff})`
  );
}

/**
 * Assert that the `emission` entity exists in the catalog and return it.
 */
export function requireEmissionEntity(catalog = getCatalog()) {
  const entity = catalog.entityMap.get("emission");
  assert.ok(
    entity,
    "Expected 'emission' entity in catalog.entityMap (Feature 1)"
  );
  return entity;
}

/**
 * Assert that a specific emission recipe exists on the `emission` entity and return it.
 */
export function requireEmissionRecipe(recipeId, catalog = getCatalog()) {
  const entity = requireEmissionEntity(catalog);
  assert.ok(
    Array.isArray(entity.recipes),
    "Expected 'emission' entity to have a recipes array"
  );
  const recipe = entity.recipes.find((r) => r.id === recipeId);
  assert.ok(
    recipe,
    `Expected recipe '${recipeId}' on 'emission' entity`
  );
  return recipe;
}

/**
 * Invoke `node bin/calc.js` as a subprocess and return `{ status, stdout, stderr }`.
 */
export function runCli(args = [], stdin = null) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    input: stdin !== null ? stdin : undefined,
    encoding: "utf8",
    timeout: 15000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}
