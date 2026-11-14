/**
 * Tier 1: Feature Coverage E2E Tests (Features 1–10).
 * Minimum requirement: >= 5 tests per feature (>= 50 tests total).
 * Uses exclusively public entry points and Interface Contracts from PROJECT.md.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildEntityCatalog, searchEntities } from "../../src/data_loader.js";
import { ONI_DATASET } from "../../src/dataset.js";
import {
  evaluateRow,
  resolveTableTemperatures,
  calculateRowMatchTargets,
  calculateSystemNet,
  formatStreamLine,
  SECONDS_PER_CYCLE,
} from "../../src/calculator.js";
import {
  encodeStateToProtobuf,
  decodeStateFromProtobuf,
  encodeStateToParam,
  decodeStateFromParam,
} from "../../src/url_state.js";
import {
  ENTITY_IDS,
  RECIPE_IDS,
  ENTITY_TO_ENUM,
  ENUM_TO_ENTITY,
  RECIPE_TO_ENUM,
  ENUM_TO_RECIPE,
  PROTO_SCHEMA,
} from "../../src/proto_catalog.js";
import { renderTableRowHtml } from "../../src/components/table_row.js";
import {
  REPO_ROOT,
  EMISSION_RECIPES,
  EMISSION_RECIPE_ENUM_NAMES,
  getCatalog,
  makeRow,
  makeEmissionRow,
  assertClose,
  requireEmissionEntity,
  requireEmissionRecipe,
  runCli,
} from "./helpers.js";

describe("Tier 1: Feature 1 — Emission Meta-Machine Entity", () => {
  it("exists in catalog.entityMap and ONI_DATASET.buildings with canonical metadata", () => {
    const catalog = getCatalog();
    const entity = requireEmissionEntity(catalog);
    assert.equal(entity.id, "emission");
    assert.equal(entity.name, "Emission");
    assert.equal(entity.category, "Machine");
    assert.equal(entity.subcategory, "Meta");

    const rawBuilding = ONI_DATASET.buildings.find((b) => b.id === "emission");
    assert.ok(rawBuilding, "Expected 'emission' in ONI_DATASET.buildings");
    assert.equal(rawBuilding.name, "Emission");
  });

  it("has zero power, zero heat, and at least the 7 canonical recipes", () => {
    const entity = requireEmissionEntity();
    assert.equal(Number(entity.power || 0), 0, "Expected emission power === 0");
    assert.equal(Number(entity.heat || 0), 0, "Expected emission heat === 0");
    assert.ok(Array.isArray(entity.recipes), "Expected emission.recipes to be an array");
    assert.ok(
      entity.recipes.length >= 7,
      `Expected >= 7 recipes on emission, got ${entity.recipes.length}`
    );
  });

  it("has a valid icon file under images/icons/ that does not end with _icon.png", () => {
    const entity = requireEmissionEntity();
    assert.equal(typeof entity.icon, "string", "Expected emission.icon to be a string");
    assert.ok(
      entity.icon.startsWith("images/icons/"),
      `Expected emission.icon to start with 'images/icons/', got '${entity.icon}'`
    );
    assert.ok(
      !entity.icon.endsWith("_icon.png"),
      `Expected emission.icon not to end with '_icon.png', got '${entity.icon}'`
    );
    const fullPath = path.resolve(REPO_ROOT, entity.icon);
    assert.ok(
      fs.existsSync(fullPath),
      `Expected emission icon file to exist on disk at ${fullPath}`
    );
  });

  it("is searchable via 'Emission', 'Off-gas', and 'Sublimation'", () => {
    const { entities } = getCatalog();
    for (const q of ["Emission", "Off-gas", "Sublimation"]) {
      const results = searchEntities(entities, q, "All");
      assert.ok(
        results.some((e) => e.id === "emission"),
        `Expected searchEntities('${q}') to include 'emission'`
      );
    }
  });

  it("is searchable via emission source element names", () => {
    const { entities } = getCatalog();
    for (const q of ["Polluted Water", "Polluted Dirt", "Bleach Stone", "Oxylite", "Rot Pile"]) {
      const results = searchEntities(entities, q, "All");
      assert.ok(
        results.some((e) => e.id === "emission"),
        `Expected searchEntities('${q}') to include 'emission'`
      );
    }
  });

  it("is included when searching within categoryFilter 'Machine'", () => {
    const { entities } = getCatalog();
    const results = searchEntities(entities, "Emission", "Machine");
    assert.ok(
      results.some((e) => e.id === "emission"),
      "Expected searchEntities('Emission', 'Machine') to include 'emission'"
    );
  });
});

for (const spec of EMISSION_RECIPES) {
  describe(`Tier 1: Feature ${spec.feature} — ${spec.id} (${spec.input} -> ${spec.output})`, () => {
    it(`defines recipe '${spec.id}' on 'emission' entity`, () => {
      const recipe = requireEmissionRecipe(spec.id);
      assert.equal(recipe.id, spec.id);
      assert.ok(
        typeof recipe.name === "string" && recipe.name.length > 0,
        `Expected non-empty name for recipe '${spec.id}'`
      );
    });

    it(`has input 1 g/s '${spec.input}' (state: 'free', temp: null)`, () => {
      const recipe = requireEmissionRecipe(spec.id);
      assert.ok(
        Array.isArray(recipe.inputs) && recipe.inputs.length === 1,
        `Expected exactly 1 input for '${spec.id}', got ${recipe.inputs?.length}`
      );
      const inp = recipe.inputs[0];
      assert.equal(inp.resource, spec.input);
      assertClose(inp.rate, 1, 1e-6, `${spec.id} input rate`);
      assert.equal(inp.unit, "g/s");
      assert.equal(inp.state, "free");
      assert.equal(inp.temp, null);
    });

    it(`has output 1 g/s '${spec.output}' (state: 'free', temp: null)`, () => {
      const recipe = requireEmissionRecipe(spec.id);
      assert.ok(
        Array.isArray(recipe.outputs) && recipe.outputs.length === 1,
        `Expected exactly 1 output for '${spec.id}', got ${recipe.outputs?.length}`
      );
      const out = recipe.outputs[0];
      assert.equal(out.resource, spec.output);
      assertClose(out.rate, 1, 1e-6, `${spec.id} output rate`);
      assert.equal(out.unit, "g/s");
      assert.equal(out.state, "free");
      assert.equal(out.temp, null);
    });

    it(`evaluates 1x row with exact 1 g/s mass conservation and 0 power / 0 heat`, () => {
      const { entityMap, elementMap } = getCatalog();
      requireEmissionRecipe(spec.id);
      const ev = evaluateRow(makeEmissionRow(spec.id, 1), entityMap, elementMap);
      assert.ok(ev.entity, "Expected evaluated entity to be non-null");
      assert.equal(ev.inputs.length, 1);
      assert.equal(ev.outputs.length, 1);
      assert.equal(ev.inputs[0].resource, spec.input);
      assert.equal(ev.outputs[0].resource, spec.output);
      assertClose(ev.inputs[0].rate, 1, 1e-6);
      assertClose(ev.outputs[0].rate, 1, 1e-6);
      assertClose(ev.power, 0, 1e-6);
      assertClose(ev.heat, 0, 1e-6);
    });

    it(`preserves T_out = T_in thermal pass-through for '${spec.id}'`, () => {
      const { entityMap, elementMap } = getCatalog();
      requireEmissionRecipe(spec.id);
      const testTemp = 42.5;
      const ev = evaluateRow(
        makeEmissionRow(spec.id, 1, { inputTemp: testTemp }),
        entityMap,
        elementMap
      );
      assert.ok(ev.entity, "Expected evaluated entity to be non-null");
      assertClose(ev.inputs[0].tempC, testTemp, 1e-4, `${spec.id} input tempC`);
      assertClose(ev.outputs[0].tempC, testTemp, 1e-4, `${spec.id} output tempC`);
    });
  });
}

describe("Tier 1: Feature 9 — Protobuf URL Serialization", () => {
  it("registers 'emission' in ENTITY_IDS and bidirectional entity maps", () => {
    assert.ok(
      ENTITY_IDS.includes("emission"),
      "Expected ENTITY_IDS to include 'emission'"
    );
    const enumVal = ENTITY_TO_ENUM.get("emission");
    assert.ok(
      typeof enumVal === "number" && enumVal > 0,
      `Expected ENTITY_TO_ENUM.get('emission') to be a positive enum integer, got ${enumVal}`
    );
    assert.equal(ENUM_TO_ENTITY[enumVal], "emission");
  });

  it("registers all 7 'emit_*' IDs in RECIPE_IDS and bidirectional recipe maps", () => {
    for (const spec of EMISSION_RECIPES) {
      assert.ok(
        RECIPE_IDS.includes(spec.id),
        `Expected RECIPE_IDS to include '${spec.id}'`
      );
      const enumVal = RECIPE_TO_ENUM.get(spec.id);
      assert.ok(
        typeof enumVal === "number" && enumVal > 0,
        `Expected RECIPE_TO_ENUM.get('${spec.id}') to be a positive integer, got ${enumVal}`
      );
      assert.equal(ENUM_TO_RECIPE[enumVal], spec.id);
    }
  });

  it("includes emission enums in PROTO_SCHEMA and maintains zero string fields", () => {
    assert.ok(
      PROTO_SCHEMA.includes("ENTITY_EMISSION"),
      "Expected PROTO_SCHEMA to include ENTITY_EMISSION"
    );
    for (const enumName of EMISSION_RECIPE_ENUM_NAMES) {
      assert.ok(
        PROTO_SCHEMA.includes(enumName),
        `Expected PROTO_SCHEMA to include ${enumName}`
      );
    }
    assert.ok(
      !/\bstring\b/.test(PROTO_SCHEMA),
      "Expected zero string fields in PROTO_SCHEMA"
    );
  });

  it("preserves existing enum IDs (append-only contract)", () => {
    assert.equal(ENTITY_TO_ENUM.get("algae_distiller"), 1);
    assert.equal(ENTITY_TO_ENUM.get("absorb_heat"), 156);
    assert.equal(ENTITY_TO_ENUM.get("shower"), 161);
    assert.ok(
      ENTITY_TO_ENUM.get("emission") > 161,
      `Expected emission enum > 161, got ${ENTITY_TO_ENUM.get("emission")}`
    );

    assert.equal(RECIPE_TO_ENUM.get("active_avg"), 1);
    assert.equal(RECIPE_TO_ENUM.get("zinc_gas"), 207);
    for (const spec of EMISSION_RECIPES) {
      const val = RECIPE_TO_ENUM.get(spec.id);
      assert.ok(
        val > 207,
        `Expected ${spec.id} enum > 207, got ${val}`
      );
    }
  });

  it("round-trips an emission row through encodeStateToProtobuf / decodeStateFromProtobuf", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const state = {
      rateMode: "s",
      rows: [makeEmissionRow("emit_bleach_stone", 25, { inputTemp: 33.5 })],
    };
    const bytes = encodeStateToProtobuf(state, elementMap);
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
    const decoded = decodeStateFromProtobuf(bytes);
    assert.equal(decoded.rows.length, 1);
    assert.equal(decoded.rows[0].entityId, "emission");
    assert.equal(decoded.rows[0].recipeId, "emit_bleach_stone");
    assertClose(decoded.rows[0].qty, 25, 1e-4);
    assertClose(decoded.rows[0].inputTemp, 33.5, 1e-4);
  });

  it("round-trips all 7 emission recipes through encodeStateToParam / decodeStateFromParam", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const state = {
      rateMode: "c",
      rows: EMISSION_RECIPES.map((r, idx) => makeEmissionRow(r.id, (idx + 1) * 10)),
    };
    const param = encodeStateToParam(state, elementMap);
    assert.ok(param.length > 0);
    assert.ok(!/[+/=]/.test(param), "Expected URL-safe base64 without +, /, or =");
    const decoded = decodeStateFromParam(param);
    assert.equal(decoded.rateMode, "c");
    assert.equal(decoded.rows.length, EMISSION_RECIPES.length);
    for (let i = 0; i < EMISSION_RECIPES.length; i++) {
      assert.equal(decoded.rows[i].entityId, "emission");
      assert.equal(decoded.rows[i].recipeId, EMISSION_RECIPES[i].id);
      assertClose(decoded.rows[i].qty, (i + 1) * 10, 1e-4);
    }
  });
});

describe("Tier 1: Feature 10 — Rate Scaling, Temperature Pass-Through & Match Integration", () => {
  it("scales 1x to 1 g/s and 600 g/cycle in /cycle mode", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");
    const ev1 = evaluateRow(makeEmissionRow("emit_polluted_dirt", 1), entityMap, elementMap);
    assertClose(ev1.outputs[0].rate, 1, 1e-6);
    assertClose(ev1.outputs[0].rate * SECONDS_PER_CYCLE, 600, 1e-6);

    const lineSec = formatStreamLine(ev1.outputs[0], true, "s", elementMap);
    const lineCyc = formatStreamLine(ev1.outputs[0], true, "c", elementMap);
    assert.ok(lineSec.includes("1 g/s"), `Expected '1 g/s' in '${lineSec}'`);
    assert.ok(lineCyc.includes("600 g/cycle"), `Expected '600 g/cycle' in '${lineCyc}'`);

    const ev100 = evaluateRow(makeEmissionRow("emit_polluted_dirt", 100), entityMap, elementMap);
    assertClose(ev100.inputs[0].rate, 100, 1e-6);
    assertClose(ev100.outputs[0].rate, 100, 1e-6);
  });

  it("propagates upstream temperature through emission to downstream consumer in resolveTableTemperatures", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");
    // Water Sieve outputs Polluted Dirt @ 20°C (or netInputTemp); let's use netInputTemps for Polluted Dirt = 55°C
    const rows = [
      makeEmissionRow("emit_polluted_dirt", 100),
      makeRow("deodorizer", 1),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
      netInputTemps: { "Polluted Dirt||free": 55, "Sand||free": 55 },
    });
    assertClose(evaluated[0].inputs[0].tempC, 55, 1e-4, "Emission input temp");
    assertClose(evaluated[0].outputs[0].tempC, 55, 1e-4, "Emission output temp");
    assertClose(evaluated[1].inputs[0].tempC, 55, 1e-4, "Deodorizer Polluted Oxygen temp");
    assertClose(evaluated[1].outputs[0].tempC, 55, 1e-4, "Deodorizer Oxygen temp");
  });

  it("computes upstream [match] target for emission consuming Water Sieve Polluted Dirt", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");
    const rows = [
      makeRow("water_sieve", 1), // outputs 200 g/s Polluted Dirt
      makeEmissionRow("emit_polluted_dirt", 10),
    ];
    const matches = calculateRowMatchTargets(1, rows, entityMap, { elementMap });
    const m = matches["in:Polluted Dirt||free"];
    assert.ok(m, "Expected match target for 'in:Polluted Dirt||free'");
    assertClose(m.targetQty, 200, 1e-4);
    assert.equal(m.isMatched, false);
  });

  it("computes downstream [match] target for emission feeding Deodorizer", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_slime");
    const rows = [
      makeEmissionRow("emit_slime", 10),
      makeRow("deodorizer", 1), // demands 100 g/s Polluted Oxygen
    ];
    const matches = calculateRowMatchTargets(0, rows, entityMap, { elementMap });
    const m = matches["out:Polluted Oxygen||free"];
    assert.ok(m, "Expected match target for 'out:Polluted Oxygen||free'");
    assertClose(m.targetQty, 100, 1e-4);
    assert.equal(m.isMatched, false);
  });

  it("participates cleanly in loop resolution and calculateSystemNet", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_water");
    // Algae Terrarium outputs 290.33 g/s Polluted Water (free) @ 30°C+; emission consumes 290.33 g/s
    const rows = [
      makeRow("algae_terrarium", 1),
      makeEmissionRow("emit_polluted_water", 290.33),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });
    const pWaterNet = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Polluted Water"
    );
    assert.equal(pWaterNet, undefined, "Expected Polluted Water to cancel completely in NET");
    const po2Out = net.netOutputs.find((s) => s.resource === "Polluted Oxygen");
    assert.ok(po2Out, "Expected Polluted Oxygen in NET outputs");
    assertClose(po2Out.rate, 290.33, 1e-3);
  });

  it("renders table row HTML via renderTableRowHtml without errors", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_oxylite");
    const rows = [makeEmissionRow("emit_oxylite", 50)];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const matches = calculateRowMatchTargets(0, rows, entityMap, { elementMap, evaluatedRows: evaluated });
    const html = renderTableRowHtml(rows[0], evaluated[0], elementMap, "s", 0, matches, 1, []);
    assert.ok(html.includes("Emission"), "Expected 'Emission' in rendered row HTML");
    assert.ok(html.includes("Oxylite"), "Expected 'Oxylite' in rendered row HTML");
    assert.ok(html.includes("Oxygen"), "Expected 'Oxygen' in rendered row HTML");
  });

  it("renders emission state via CLI bin/calc.js in text, --json, and --rate c modes", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const param = encodeStateToParam(
      { rateMode: "s", rows: [makeEmissionRow("emit_bleach_stone", 5)] },
      elementMap
    );

    const textRes = runCli([param]);
    assert.equal(textRes.status, 0, `CLI failed: ${textRes.stderr}`);
    assert.ok(textRes.stdout.includes("Emission"), "Expected 'Emission' in CLI text output");
    assert.ok(textRes.stdout.includes("Chlorine"), "Expected 'Chlorine' in CLI text output");

    const jsonRes = runCli([param, "--json"]);
    assert.equal(jsonRes.status, 0, `CLI --json failed: ${jsonRes.stderr}`);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.rowsData.length, 1);
    assert.ok(parsed.netData.net.netOutputs.some((o) => o.resource === "Chlorine"));

    const cycRes = runCli([param, "--rate", "c"]);
    assert.equal(cycRes.status, 0, `CLI --rate c failed: ${cycRes.stderr}`);
    assert.ok(cycRes.stdout.includes("3 Kg/cycle"), `Expected '3 Kg/cycle' in CLI --rate c output:\n${cycRes.stdout}`);
  });
});
