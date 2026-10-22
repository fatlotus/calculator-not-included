/**
 * Unit test suite for JavaScript modules in src/.
 * Run with: node tests/test_js_modules.js
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  resolveTableTemperatures,
  calculateSystemNet,
  calculateRowMatchTargets,
  getDefaultElementTemp,
  getNetInputTemp,
  formatNumber,
  formatStreamLine,
} from "../src/calculator.js";
import { buildEntityCatalog, searchEntities } from "../src/data_loader.js";
import { PRESETS, getPresetById } from "../src/presets.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
  encodeRow,
  decodeRow,
} from "../src/url_state.js";
import { renderTableRowHtml, renderIcon } from "../src/components/table_row.js";
import { renderNetSummaryRowHtml } from "../src/components/net_summary.js";

console.log("=== Running JavaScript Module Tests ===");

// 0. Dataset Integrity & JSON Files
{
  const expectedFiles = [
    "buildings.json",
    "plants.json",
    "critters.json",
    "duplicants.json",
    "geysers.json",
    "elements.json",
    "dataset.json",
  ];
  const dataDir = path.resolve(__dirname, "../data");

  for (const filename of expectedFiles) {
    const filepath = path.join(dataDir, filename);
    assert.ok(fs.existsSync(filepath), `Expected data file does not exist: ${filepath}`);
    const stat = fs.statSync(filepath);
    assert.ok(stat.size > 0, `Data file is empty (0 bytes): ${filepath}`);

    const raw = fs.readFileSync(filepath, "utf8");
    const parsed = JSON.parse(raw);
    assert.ok(typeof parsed === "object" && parsed !== null, `${filename} root must be list or object`);
  }

  const datasetPath = path.join(dataDir, "dataset.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const expectedCategories = ["buildings", "plants", "critters", "duplicants", "geysers", "elements"];
  for (const cat of expectedCategories) {
    assert.ok(dataset[cat], `Missing category '${cat}' in dataset.json`);
    assert.ok(
      Array.isArray(dataset[cat]) ? dataset[cat].length > 0 : Object.keys(dataset[cat]).length > 0,
      `Category '${cat}' is empty in dataset.json`
    );
  }
  console.log("✓ Dataset Integrity tests passed");
}

// 1. Data Loader & Catalog
{
  const { entities, entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  assert.ok(entities.length > 100, "Entities catalog should contain > 100 entries");
  assert.ok(entityMap.has("electrolyzer"), "entityMap should have electrolyzer");
  assert.ok(entityMap.has("duplicant"), "entityMap should have duplicant");
  assert.ok(entityMap.has("critter_stone_hatch"), "entityMap should have stone hatch");
  assert.ok(entityMap.has("plant_arbor_tree"), "entityMap should have arbor tree");
  assert.ok(elementMap.has("Water"), "elementMap should have Water");
  assert.ok(elementMap.has("Oxygen"), "elementMap should have Oxygen");
  assert.ok(elementMap.has("Power"), "elementMap should have synthetic Power element");
  assert.ok(elementMap.has("Heat"), "elementMap should have synthetic Heat element");

  // Search
  const results = searchEntities(entities, "electrolyzer", "All");
  assert.strictEqual(results[0].id, "electrolyzer");

  const plantResults = searchEntities(entities, "arbor", "Plant");
  assert.strictEqual(plantResults[0].id, "plant_arbor_tree");

  const critterResults = searchEntities(entities, "hatch", "Critter");
  assert.ok(critterResults.length >= 3, "Should match regular, stone, sage hatch");

  // No duplicate entities in catalog
  const entityIds = entities.map((e) => e.id);
  const uniqueIds = new Set(entityIds);
  assert.strictEqual(entityIds.length, uniqueIds.size, "Catalog entities list must contain no duplicate IDs");
  assert.ok(!entityIds.includes("water_pump"), "water_pump clone must not be in entities array");
  assert.ok(!entityIds.includes("geyser_water"), "geyser_water clone must not be in entities array");
  assert.ok(!entityIds.includes("geyser_natural_gas"), "geyser_natural_gas clone must not be in entities array");

  // Canonical names and aliases
  const liquidPump = entityMap.get("liquid_pump");
  assert.ok(liquidPump, "liquid_pump must exist");
  assert.strictEqual(liquidPump.name, "Liquid Pump", "Canonical name must be 'Liquid Pump'");
  assert.ok(liquidPump.aliases && liquidPump.aliases.includes("Water Pump"), "Must have 'Water Pump' alias");

  // Backward compatibility alias lookups via entityMap
  assert.strictEqual(entityMap.get("water_pump"), liquidPump, "entityMap.get('water_pump') must resolve to liquid_pump");
  assert.strictEqual(entityMap.get("geyser_water"), entityMap.get("geyser_water_geyser"), "entityMap.get('geyser_water') must resolve to geyser_water_geyser");
  assert.strictEqual(entityMap.get("geyser_natural_gas"), entityMap.get("geyser_natural_gas_geyser"), "entityMap.get('geyser_natural_gas') must resolve to geyser_natural_gas_geyser");

  // Search by alias and single result for geysers
  const waterPumpSearch = searchEntities(entities, "Water Pump");
  assert.ok(waterPumpSearch.length > 0 && waterPumpSearch[0].id === "liquid_pump", "Searching 'Water Pump' must return Liquid Pump");

  const waterGeyserSearch = searchEntities(entities, "Water Geyser");
  const exactWaterGeysers = waterGeyserSearch.filter((g) => g.name === "Water Geyser");
  assert.strictEqual(exactWaterGeysers.length, 1, "Searching 'Water Geyser' must return exactly 1 Water Geyser");

  const natGasGeyserSearch = searchEntities(entities, "Natural Gas Geyser");
  const exactNatGasGeysers = natGasGeyserSearch.filter((g) => g.name === "Natural Gas Geyser");
  assert.strictEqual(exactNatGasGeysers.length, 1, "Searching 'Natural Gas Geyser' must return exactly 1 Natural Gas Geyser");

  console.log("✓ Data Loader & Catalog tests passed");
}

// 2. Calculator & Math Engine
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

  // Single electrolyzer
  const elRow = evaluateRow({ entityId: "electrolyzer", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(elRow.power, -120);
  assert.strictEqual(elRow.heat, 1.25);
  assert.strictEqual(elRow.inputs[0].rate, 1000);
  assert.strictEqual(elRow.outputs[0].rate, 888);
  assert.strictEqual(elRow.outputs[1].rate, 112);

  // Scaling
  const elRow3 = evaluateRow({ entityId: "electrolyzer", qty: 3 }, entityMap, elementMap);
  assert.strictEqual(elRow3.power, -360);
  assert.strictEqual(elRow3.heat, 3.75);
  assert.strictEqual(elRow3.inputs[0].rate, 3000);

  // Modifiers: Duplicant Diver's Lungs (-25% O2)
  const dupBase = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: [] }, entityMap, elementMap);
  const dupMod = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: ["divers_lungs"] }, entityMap, elementMap);
  assert.strictEqual(dupBase.inputs[0].rate, 100);
  assert.strictEqual(dupMod.inputs[0].rate, 75);

  // Fractional Hydra SPOM Net Calculation
  const hydra = getPresetById("hydra_spom");
  const evaluatedHydra = hydra.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const net = calculateSystemNet(evaluatedHydra, { strictPipeMatching: true });

  assert.strictEqual(net.netPower, 698.24);
  assert.strictEqual(net.netBuildingHeat, 6.38);
  assert.strictEqual(net.netInputs.length, 1);
  assert.strictEqual(net.netInputs[0].resource, "Water");
  assert.strictEqual(net.netInputs[0].rate, 1000);
  assert.strictEqual(net.netInputs[0].state, "free");

  assert.strictEqual(net.netOutputs.length, 2);
  const oxygenOut = net.netOutputs.find((o) => o.resource === "Oxygen");
  assert.strictEqual(oxygenOut.rate, 88);
  assert.strictEqual(oxygenOut.state, "free");
  const laborOut = net.netOutputs.find((o) => o.resource === "Duplicant Labor");
  assert.strictEqual(laborOut.rate, 6);

  // Check match targets for Gas Pump (index 2)
  const matches = calculateRowMatchTargets(2, hydra.rows, entityMap);
  assert.strictEqual(matches["in:Hydrogen||free"].isMatched, true);
  assert.strictEqual(matches["in:Hydrogen||free"].targetQty, 0.224);
  assert.strictEqual(matches["out:Hydrogen||in a pipe"].isMatched, true);

  // --- Thermal Propagation Tests ---
  // A. Hydra SPOM at default 20 °C gives Electrolyzer outputs @ 70 °C
  const resolvedDefault = resolveTableTemperatures(hydra.rows, entityMap, elementMap);
  const elResolved = resolvedDefault[0];
  const o2Out = elResolved.outputs.find((o) => o.resource === "Oxygen");
  const h2Out = elResolved.outputs.find((o) => o.resource === "Hydrogen");
  assert.strictEqual(o2Out.tempC, 70);
  assert.strictEqual(h2Out.tempC, 70);
  assert.strictEqual(o2Out.temp, "@ 70 °C");
  assert.strictEqual(h2Out.temp, "@ 70 °C");
  // Gas Pump output @ 70 °C
  const gpResolved = resolvedDefault[2];
  assert.strictEqual(gpResolved.outputs[0].tempC, 70);
  assert.strictEqual(gpResolved.outputs[0].temp, "@ 70 °C");

  // B. NET input Water set to 95 °C propagates through Water Pump to Electrolyzer -> outputs @ 95 °C
  const resolved95 = resolveTableTemperatures(hydra.rows, entityMap, elementMap, {
    netInputTemps: { "Water||free": 95 },
    strictPipeMatching: true,
  });
  const wpResolved95 = resolved95[1];
  assert.strictEqual(wpResolved95.outputs[0].tempC, 95);
  assert.strictEqual(wpResolved95.outputs[0].temp, "@ 95 °C");
  const elResolved95 = resolved95[0];
  const o2Out95 = elResolved95.outputs.find((o) => o.resource === "Oxygen");
  const h2Out95 = elResolved95.outputs.find((o) => o.resource === "Hydrogen");
  assert.strictEqual(o2Out95.tempC, 95);
  assert.strictEqual(h2Out95.tempC, 95);
  assert.strictEqual(o2Out95.temp, "@ 95 °C");
  assert.strictEqual(h2Out95.temp, "@ 95 °C");

  // C. Two producers at different temperatures average correctly
  const customEntityMap = new Map([
    ["p1", { id: "p1", name: "P1", inputs: [], outputs: [{ resource: "Water", rate: 100, unit: "g/s", state: "in a pipe", temp: "@ 20 °C" }] }],
    ["p2", { id: "p2", name: "P2", inputs: [], outputs: [{ resource: "Water", rate: 300, unit: "g/s", state: "in a pipe", temp: "@ 60 °C" }] }],
    ["c1", { id: "c1", name: "C1", inputs: [{ resource: "Water", rate: 400, unit: "g/s", state: "in a pipe" }], outputs: [] }],
  ]);
  const twoProdsRows = [{ entityId: "p1", qty: 1 }, { entityId: "p2", qty: 1 }, { entityId: "c1", qty: 1 }];
  const resolvedTwoProds = resolveTableTemperatures(twoProdsRows, customEntityMap);
  // (100*20 + 300*60) / 400 = 50 °C
  assert.strictEqual(resolvedTwoProds[2].inputs[0].tempC, 50);

  // D. Helper getDefaultElementTemp tests
  assert.strictEqual(getDefaultElementTemp("Water", elementMap), 20);
  const customElements = new Map([
    ["Steam", { low_temp: 372.5, high_temp: null }],
    ["Ice", { low_temp: null, high_temp: 272.5 }],
    ["MoltenGold", { default_temp: 1100 }],
  ]);
  assert.ok(getDefaultElementTemp("Steam", customElements) > 99.35);
  assert.ok(getDefaultElementTemp("Ice", customElements) < -0.65);
  assert.strictEqual(getDefaultElementTemp("MoltenGold", customElements), 1100);

  // E. Automatic Unit Scaling tests
  assert.strictEqual(
    formatStreamLine({ resource: "Natural Gas", rate: 90, unit: "g/s", state: "free" }, true, "s"),
    "Natural Gas: +90 g/s (free)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Coal", rate: 1000, unit: "g/s", state: "free" }, false, "s"),
    "Coal: -1 Kg/s (free)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Crude Oil", rate: 10000, unit: "g/s", state: "in a pipe" }, false, "s"),
    "Crude Oil: -10 Kg/s (in a pipe)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Water", rate: 1000000, unit: "g/s", state: "in a pipe" }, false, "s"),
    "Water: -1 T/s (in a pipe)"
  );
  // Cycle mode
  assert.strictEqual(
    formatStreamLine({ resource: "Natural Gas", rate: 90, unit: "g/s", state: "free" }, true, "c"),
    "Natural Gas: +54 Kg/cycle (free)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Crude Oil", rate: 10000, unit: "g/s", state: "in a pipe" }, false, "c"),
    "Crude Oil: -6 T/cycle (in a pipe)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Gold", rate: 1, unit: "g/s", state: "free" }, false, "c"),
    "Gold: -600 g/cycle (free)"
  );

  console.log("✓ Calculator & Math Engine tests passed");
}

// 3. URL State Serialization
{
  // Row without feed temp
  const rowStr = encodeRow({
    entityId: "petroleum_generator",
    recipeId: "ethanol",
    qty: 2,
    modifiers: ["mod_a", "mod_b"],
  });
  assert.strictEqual(rowStr, "petroleum_generator:ethanol*2+mod_a,mod_b");

  // Backward compatibility: decode legacy @inputTemp token
  const legacyToken = "petroleum_generator:ethanol*2@25+mod_a,mod_b";
  const decodedRow = decodeRow(legacyToken);
  assert.strictEqual(decodedRow.entityId, "petroleum_generator");
  assert.strictEqual(decodedRow.recipeId, "ethanol");
  assert.strictEqual(decodedRow.qty, 2);
  assert.strictEqual(decodedRow.inputTemp, 25);
  assert.deepStrictEqual(decodedRow.modifiers, ["mod_a", "mod_b"]);

  // Re-encoding must not output @25
  assert.strictEqual(encodeRow(decodedRow), "petroleum_generator:ethanol*2+mod_a,mod_b");

  const state = {
    rateMode: "s",
    strictPipeMatching: true,
    rows: [
      { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "water_pump", qty: 0.1, recipeId: "water", modifiers: [] },
      { entityId: "gas_pump", qty: 0.224, recipeId: "hydrogen", modifiers: [] },
      { entityId: "hydrogen_generator", qty: 1.12, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: ["divers_lungs"] },
    ],
    netInputTemps: { "Water||free": 95 },
  };

  const param = encodeStateToParam(state);
  assert.strictEqual(
    param,
    "u:s_r:electrolyzer~water_pump:water*0.1~gas_pump:hydrogen*0.224~hydrogen_generator*1.12~duplicant*8+divers_lungs_t:Water|free=95"
  );

  const decodedState = decodeStateFromParam(param);
  assert.strictEqual(decodedState.rateMode, "s");
  assert.strictEqual(decodedState.strictPipeMatching, true);
  assert.strictEqual(decodedState.rows.length, 5);
  assert.strictEqual(decodedState.rows[2].qty, 0.224);
  assert.deepStrictEqual(decodedState.rows[4].modifiers, ["divers_lungs"]);
  assert.strictEqual(decodedState.netInputTemps["Water||free"], 95);
  assert.strictEqual(decodedState.netInputTemps["Water|free"], 95);

  // Decoding with legacy p:0 flag still enforces strict pipe matching
  const decodedP0 = decodeStateFromParam("u:s_p:0_r:electrolyzer~duplicant*8");
  assert.strictEqual(decodedP0.strictPipeMatching, true);
  assert.strictEqual(decodedP0.rows.length, 2);

  // Default temperature 20 for Water is omitted from URL
  const stateDefault = {
    rateMode: "s",
    strictPipeMatching: true,
    rows: [{ entityId: "electrolyzer", qty: 1 }],
    netInputTemps: { "Water||free": 20 },
  };
  const paramDefault = encodeStateToParam(stateDefault);
  assert.strictEqual(paramDefault.includes("t:"), false);

  console.log("✓ URL State Serialization tests passed");
}

// 4. Presets & Strict Pipe Matching
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  assert.ok(PRESETS.length >= 5, "Should have at least 5 presets defined");
  const hydra = getPresetById("hydra_spom");
  assert.strictEqual(hydra.name, "Hydra SPOM (PDF Example)");
  assert.strictEqual(hydra.rows.length, 5);

  // Oil refinery preset test
  const oilPreset = getPresetById("oil_refinery_petroleum_loop");
  assert.ok(oilPreset, "Oil refinery preset should exist");
  assert.strictEqual(oilPreset.rows.length, 6);
  const evaluatedOil = oilPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const oilNet = calculateSystemNet(evaluatedOil);
  assert.ok(oilNet.netPower > 5000, "Oil refinery power plant should produce > 5000 W net");

  // Strict pipe state matching verification:
  // Water Geyser produces free water; Electrolyzer consumes in-pipe water.
  // Without a pump, they do NOT cancel each other out.
  const testRows = [
    { entityId: "geyser_water_geyser", qty: 1, recipeId: null, modifiers: [] },
    { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
  ];
  const evalTestRows = testRows.map((r) => evaluateRow(r, entityMap, elementMap));
  const testNet = calculateSystemNet(evalTestRows);
  const pipeWaterInput = testNet.netInputs.find((s) => s.resource === "Water" && s.state === "in a pipe");
  const freeWaterOutput = testNet.netOutputs.find((s) => s.resource === "Water" && s.state === "free");
  assert.ok(pipeWaterInput, "In-pipe water must be required as an input");
  assert.strictEqual(pipeWaterInput.rate, 1000);
  assert.ok(freeWaterOutput, "Free water must be produced as an output");
  assert.strictEqual(freeWaterOutput.rate, 3000);

  // When a liquid pump is added, it converts free water to in-pipe water to satisfy the electrolyzer
  const pumpRows = [
    { entityId: "geyser_water_geyser", qty: 1, recipeId: null, modifiers: [] },
    { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
    { entityId: "liquid_pump", qty: 0.1, recipeId: "water", modifiers: [] }, // 1000 g/s pump
  ];
  const evalPumpRows = pumpRows.map((r) => evaluateRow(r, entityMap, elementMap));
  const pumpNet = calculateSystemNet(evalPumpRows);
  const matchedPipeInput = pumpNet.netInputs.find((s) => s.resource === "Water" && s.state === "in a pipe");
  const remainingFreeOutput = pumpNet.netOutputs.find((s) => s.resource === "Water" && s.state === "free");
  assert.strictEqual(matchedPipeInput, undefined, "In-pipe water input is completely satisfied by pump");
  assert.strictEqual(remainingFreeOutput.rate, 2000, "Surplus free water is 3000 - 1000 = 2000 g/s");

  console.log("✓ Presets and Strict Pipe Matching tests passed");
}

// 5. Component HTML Rendering
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const row = { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] };
  const evaluated = evaluateRow(row, entityMap, elementMap);

  const rowHtml = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {});
  assert.ok(rowHtml.includes("Electrolyzer"), "Row HTML should include entity name");
  assert.ok(rowHtml.includes("Oxygen: +888 g/s"), "Row HTML should include Oxygen output stream");
  assert.ok(rowHtml.includes("Hydrogen: +112 g/s"), "Row HTML should include Hydrogen output stream");
  assert.ok(rowHtml.includes("Water: -1 Kg/s"), "Row HTML should include Water input stream");
  assert.ok(rowHtml.includes("Power: -120 W"), "Row HTML should include Power input stream");
  // Ensure Feed Temp input was removed
  assert.ok(!rowHtml.includes("input-temp-field"), "Row HTML should NOT contain per-row feed temp input");
  assert.ok(!rowHtml.includes("Feed:"), "Row HTML should NOT contain Feed: label");

  const net = calculateSystemNet([evaluated], { strictPipeMatching: true });
  const netHtml = renderNetSummaryRowHtml(net, elementMap, "s", { "Water||in a pipe": 20 }, true);
  assert.ok(netHtml.includes("NET"), "NET row HTML should include NET badge");
  assert.ok(netHtml.includes("Oxygen: +888 g/s"), "NET row HTML should include Oxygen stream");
  // Ensure NET input temperature control is rendered
  assert.ok(netHtml.includes("net-temp-input"), "NET summary should include net-temp-input");
  assert.ok(netHtml.includes('data-key="Water||in a pipe"'), "NET summary input should have data-key");

  // Duplicant Labor non-thermal test: Duplicant Labor should NOT render net-temp-input
  const mgRow = { entityId: "manual_generator", qty: 1, recipeId: null, modifiers: [] };
  const mgEval = evaluateRow(mgRow, entityMap, elementMap);
  const mgNet = calculateSystemNet([mgEval], { strictPipeMatching: true });
  const mgNetHtml = renderNetSummaryRowHtml(mgNet, elementMap, "s", {}, true);
  assert.ok(mgNetHtml.includes("Duplicant Labor: -1 s/s (labor)"), "NET should list Duplicant Labor");
  assert.ok(!mgNetHtml.includes('data-resource="Duplicant Labor"'), "Duplicant Labor must not have a net-temp-input field");

  // Tune-up with Microchip tests
  const tunedMg = evaluateRow({ entityId: "manual_generator", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
  assert.strictEqual(tunedMg.power, 600);
  const mgChip = tunedMg.inputs.find((i) => i.resource === "Microchip");
  assert.ok(mgChip, "Tuned manual generator must consume Microchips");
  assert.strictEqual(mgChip.unit, "chips/s");

  const tunedCg = evaluateRow({ entityId: "coal_generator", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
  assert.strictEqual(tunedCg.power, 900);
  const cgNet = calculateSystemNet([tunedCg], { strictPipeMatching: true });
  const cgNetHtml = renderNetSummaryRowHtml(cgNet, elementMap, "s", {}, true);
  assert.ok(cgNetHtml.includes("Microchip: -0.0006 chips/s (solid)"), "NET summary should display Microchip input");
  assert.ok(!cgNetHtml.includes('data-resource="Microchip"'), "Microchip must not have a net-temp-input field");

  // Branding verification
  const indexHtml = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(indexHtml.includes("Calculator Not Included"), "index.html must include Calculator Not Included branding");
  assert.ok(indexHtml.includes("calculatornotincluded.com"), "index.html must include calculatornotincluded.com domain");
  assert.ok(!indexHtml.includes("mass-unit-btn"), "index.html must NOT have mass-unit-btn selector");

  console.log("✓ Component HTML Rendering tests passed");
}

// 6. Bionic Duplicants Augmentations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const bionic = entityMap.get("bionic_duplicant");
  assert.ok(bionic, "bionic_duplicant entity should exist");

  // Crude Oil recipe (default)
  const crudeEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "crude_oil" }, entityMap, elementMap);
  const crudeIn = crudeEval.inputs.find((i) => i.resource === "Crude Oil");
  assert.ok(crudeIn, "Default Bionic should consume Crude Oil");
  assert.strictEqual(crudeIn.rate, 33.33);

  // Gear Balm recipe
  const balmEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "gear_balm" }, entityMap, elementMap);
  const balmIn = balmEval.inputs.find((i) => i.resource === "Gear Balm");
  assert.ok(balmIn, "Bionic with gear_balm recipe should consume Gear Balm");
  assert.strictEqual(balmIn.rate, 0.0004167);
  assert.strictEqual(balmIn.unit, "balm/s");

  // Tallow Gear Balm recipe
  const tallowEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "tallow_gear_balm" }, entityMap, elementMap);
  const tallowIn = tallowEval.inputs.find((i) => i.resource === "Tallow Gear Balm");
  assert.ok(tallowIn, "Bionic with tallow_gear_balm recipe should consume Tallow Gear Balm");
  assert.strictEqual(tallowIn.rate, 0.0004167);
  assert.strictEqual(tallowIn.unit, "balm/s");

  // Defragmentation option producing Microchips
  const defragEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["defragment"] }, entityMap, elementMap);
  const chipOut = defragEval.outputs.find((o) => o.resource === "Microchip");
  assert.ok(chipOut, "Defragment modifier should produce Microchips");
  assert.ok(chipOut.rate > 0, "Defragment output rate should be positive");

  // Diver's lungs modifier (-25% Oxygen)
  const dlEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["divers_lungs"] }, entityMap, elementMap);
  const o2In = dlEval.inputs.find((i) => i.resource === "Oxygen");
  assert.strictEqual(o2In.rate, 75.0, "Diver's Lungs should reduce Oxygen to 75 g/s");

  console.log("✓ Bionic Duplicants Augmentations tests passed");
}

console.log("\n ALL JAVASCRIPT MODULE TESTS PASSED SUCCESSFULLY! \n");
