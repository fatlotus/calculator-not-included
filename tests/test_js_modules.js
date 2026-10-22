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
  // Exhaled CO2 is always included
  const co2Base = dupBase.outputs.find((o) => o.resource === "Carbon Dioxide");
  const co2Mod = dupMod.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(co2Base, "Duplicant must always output Carbon Dioxide");
  assert.strictEqual(co2Base.rate, 2.0);
  assert.strictEqual(co2Mod.rate, 1.5, "Diver's Lungs scales CO2 output to 1.5 g/s");

  // Fractional Hydra SPOM Net Calculation
  const hydra = getPresetById("hydra_spom");
  const evaluatedHydra = hydra.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const net = calculateSystemNet(evaluatedHydra);

  assert.strictEqual(net.netPower, 698.24);
  assert.strictEqual(net.netBuildingHeat, 6.38);
  assert.strictEqual(net.netInputs.length, 2);
  const freeWaterIn = net.netInputs.find((i) => i.resource === "Water" && i.state === "free");
  const pipeWaterIn = net.netInputs.find((i) => i.resource === "Water" && i.state === "in a pipe");
  assert.strictEqual(freeWaterIn.rate, 1000);
  assert.strictEqual(Math.round(pipeWaterIn.rate * 100) / 100, 66.67);

  assert.strictEqual(net.netOutputs.length, 4);
  const oxygenOut = net.netOutputs.find((o) => o.resource === "Oxygen");
  assert.strictEqual(oxygenOut.rate, 88);
  assert.strictEqual(oxygenOut.state, "free");
  const laborOut = net.netOutputs.find((o) => o.resource === "Duplicant Labor");
  assert.strictEqual(laborOut.rate, 6);
  const co2Out = net.netOutputs.find((o) => o.resource === "Carbon Dioxide");
  assert.strictEqual(co2Out.rate, 16);
  const pWaterOut = net.netOutputs.find((o) => o.resource === "Polluted Water");
  assert.strictEqual(pWaterOut.rate, 156);

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
    netInputTemps: { "Water||free": 95, "Water||in a pipe": 95 },
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

  // Drecko plastic preset test (Bristle Berry / Bristle Blossom)
  const dreckoPreset = getPresetById("glossy_drecko_plastic");
  assert.ok(dreckoPreset, "Drecko plastic preset should exist");
  assert.strictEqual(dreckoPreset.rows.length, 2);
  const dreckoCritterRow = dreckoPreset.rows.find((r) => r.entityId === "critter_glossy_drecko");
  assert.ok(dreckoCritterRow, "Preset should contain critter_glossy_drecko");
  assert.ok(
    dreckoCritterRow.recipeId === "bristle_blossom_plastic" || dreckoCritterRow.recipeId === "bristle_berry_plastic",
    "Drecko should use Bristle Blossom/Berry recipe"
  );
  const dreckoPlantRow = dreckoPreset.rows.find((r) => r.entityId === "plant_bristle_blossom");
  assert.ok(dreckoPlantRow, "Preset should contain plant_bristle_blossom");
  assert.strictEqual(dreckoPlantRow.recipeId, "growth", "Bristle Blossom should use growth recipe");

  const evalDrecko = dreckoPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const dreckoNet = calculateSystemNet(evalDrecko);
  const plasticOut = dreckoNet.netOutputs.find((o) => o.resource === "Plastic");
  assert.ok(plasticOut, "Drecko preset must output Plastic");
  assert.ok(plasticOut.rate > 200, "Plastic output should be > 200 g/s");

  // Growth cancels out completely to 0
  const netGrowthIn = dreckoNet.netInputs.find((i) => i.resource === "Growth");
  const netGrowthOut = dreckoNet.netOutputs.find((o) => o.resource === "Growth");
  assert.strictEqual(netGrowthIn, undefined, "Net Growth input should be 0 (cancelled out)");
  assert.strictEqual(netGrowthOut, undefined, "Net Growth output should be 0 (cancelled out)");

  // Leaves Water as input and Plastic + Phosphorite as outputs
  const netWaterIn = dreckoNet.netInputs.find((i) => i.resource === "Water" && i.state === "in a pipe");
  assert.ok(netWaterIn, "Drecko preset requires in-pipe Water");
  const netPhosphoriteOut = dreckoNet.netOutputs.find((o) => o.resource === "Phosphorite");
  assert.ok(netPhosphoriteOut, "Drecko preset outputs Phosphorite");

  // Natural Gas Geyser Power preset test (Fractional Generator and Pump)
  const ngPreset = getPresetById("natural_gas_geyser_power");
  assert.ok(ngPreset, "Natural gas geyser preset should exist");
  assert.strictEqual(ngPreset.rows.length, 3);
  const ngGenRow = ngPreset.rows.find((r) => r.entityId === "natural_gas_generator");
  assert.ok(ngGenRow, "NG preset should contain natural_gas_generator");
  assert.strictEqual(ngGenRow.qty, 1.1667, "Natural gas generator should use fractional 1.1667 qty");
  const ngPumpRow = ngPreset.rows.find((r) => r.entityId === "gas_pump");
  assert.ok(ngPumpRow, "NG preset should contain gas_pump");
  assert.strictEqual(ngPumpRow.qty, 0.21, "Gas pump should use fractional 0.21 qty");

  const evalNG = ngPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const ngNet = calculateSystemNet(evalNG);
  assert.ok(ngNet.netPower > 850, "Natural gas geyser preset should produce > 850 W net power");

  const ngFreeGasOut = ngNet.netOutputs.find((o) => o.resource === "Natural Gas" && o.state === "free");
  assert.strictEqual(ngFreeGasOut, undefined, "Net free Natural Gas output must be 0");
  const ngPipeGasOut = ngNet.netOutputs.find((o) => o.resource === "Natural Gas" && o.state === "in a pipe");
  assert.strictEqual(ngPipeGasOut, undefined, "Net pipe Natural Gas output must be 0");
  const ngGasIn = ngNet.netInputs.find((i) => i.resource === "Natural Gas");
  const ngGasInRate = ngGasIn ? ngGasIn.rate : 0;
  assert.ok(ngGasInRate < 0.01, `Net Natural Gas input should be effectively 0 (was ${ngGasInRate} g/s)`);

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

  const rowHtml = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {}, 2);
  assert.ok(rowHtml.includes("Electrolyzer"), "Row HTML should include entity name");
  assert.ok(rowHtml.includes("Oxygen: +888 g/s"), "Row HTML should include Oxygen output stream");
  assert.ok(rowHtml.includes("Hydrogen: +112 g/s"), "Row HTML should include Hydrogen output stream");
  assert.ok(rowHtml.includes("Water: -1 Kg/s"), "Row HTML should include Water input stream");
  assert.ok(rowHtml.includes("Power: -120 W"), "Row HTML should include Power input stream");
  // Row drag tab and reorder arrow buttons
  assert.ok(rowHtml.includes('class="row-reorder-tab"'), "Row HTML must include row-reorder-tab");
  assert.ok(rowHtml.includes('class="row-drag-handle" draggable="true"'), "Row HTML must include draggable drag-handle");
  assert.ok(rowHtml.includes('class="btn-reorder btn-move-up"'), "Row HTML must include up arrow button");
  assert.ok(rowHtml.includes('class="btn-reorder btn-move-down"'), "Row HTML must include down arrow button");
  assert.ok(rowHtml.includes('btn-move-up" data-row-index="0" title="Move row up" aria-label="Move row up" disabled'), "Top row up arrow should be disabled");

  // Second row in 2-row table should have down arrow disabled
  const rowHtml2 = renderTableRowHtml(row, evaluated, elementMap, "s", 1, {}, 2);
  assert.ok(rowHtml2.includes('btn-move-down" data-row-index="1" title="Move row down" aria-label="Move row down" disabled'), "Bottom row down arrow should be disabled");

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
  assert.ok(!indexHtml.includes("<code>calculatornotincluded.com</code>"), "Header brand title must not include calculatornotincluded.com code tag");
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

  // Defragmentation option producing Microchips (0.33 microchips/cycle = 0.00055 chips/s)
  const defragEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["defragment"] }, entityMap, elementMap);
  const chipOut = defragEval.outputs.find((o) => o.resource === "Microchip");
  assert.ok(chipOut, "Defragment modifier should produce Microchips");
  assert.strictEqual(chipOut.rate, 0.00055, "Defragment rate should be 0.00055 chips/s (0.33 chips/cycle)");
  assert.strictEqual(formatStreamLine(chipOut, true, "c"), "Microchip: +0.33 chips/cycle (solid)", "Cycle display should be +0.33 chips/cycle");

  // Diver's lungs modifier (-25% Oxygen)
  const dlEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["divers_lungs"] }, entityMap, elementMap);
  const o2In = dlEval.inputs.find((i) => i.resource === "Oxygen");
  assert.strictEqual(o2In.rate, 75.0, "Diver's Lungs should reduce Oxygen to 75 g/s");

  console.log("✓ Bionic Duplicants Augmentations tests passed");
}

// 7. Regular Duplicants: Bathroom Options and Exhaled CO2
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

  // Default / Plumbed bathroom
  const plumbedRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "plumbed" }, entityMap, elementMap);
  const pWaterIn = plumbedRow.inputs.find((i) => i.resource === "Water" && i.state === "in a pipe");
  const pPollutedWaterOut = plumbedRow.outputs.find((o) => o.resource === "Polluted Water" && o.state === "in a pipe");
  const pCo2Out = plumbedRow.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(pWaterIn, "Plumbed duplicant must consume pipe water");
  assert.strictEqual(pWaterIn.rate, 8.3333);
  assert.ok(pPollutedWaterOut, "Plumbed duplicant must produce pipe polluted water");
  assert.strictEqual(pPollutedWaterOut.rate, 19.5);
  assert.ok(pCo2Out, "Duplicant must always exhale Carbon Dioxide");
  assert.strictEqual(pCo2Out.rate, 2.0);

  // Outhouse bathroom
  const outhouseRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "outhouse" }, entityMap, elementMap);
  const oDirtIn = outhouseRow.inputs.find((i) => i.resource === "Dirt" && i.state === "free");
  const oPollutedDirtOut = outhouseRow.outputs.find((o) => o.resource === "Polluted Dirt" && o.state === "free");
  assert.ok(oDirtIn, "Outhouse duplicant must consume free dirt");
  assert.strictEqual(oDirtIn.rate, 21.6667);
  assert.ok(oPollutedDirtOut, "Outhouse duplicant must produce free polluted dirt");
  assert.strictEqual(oPollutedDirtOut.rate, 32.8333);

  // Peeing on the floor
  const floorRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "floor" }, entityMap, elementMap);
  const fPollutedWaterOut = floorRow.outputs.find((o) => o.resource === "Polluted Water" && o.state === "free");
  assert.strictEqual(floorRow.inputs.some((i) => i.resource === "Water" || i.resource === "Dirt"), false, "Floor peeing requires no water/dirt inputs");
  assert.ok(fPollutedWaterOut, "Floor peeing must produce free polluted water");
  assert.strictEqual(fPollutedWaterOut.rate, 11.1667);

  // URL State encoding/decoding of bathroom options
  const rowFloor = { entityId: "duplicant", qty: 2, recipeId: null, modifiers: [], bathroom: "floor" };
  const encodedFloor = encodeRow(rowFloor);
  assert.strictEqual(encodedFloor, "duplicant*2!floor");
  const decodedFloor = decodeRow(encodedFloor);
  assert.strictEqual(decodedFloor.entityId, "duplicant");
  assert.strictEqual(decodedFloor.qty, 2);
  assert.strictEqual(decodedFloor.bathroom, "floor");

  // HTML rendering contains bathroom selector for duplicants
  const html = renderTableRowHtml(rowFloor, floorRow, elementMap, "s", 0, {});
  assert.ok(html.includes('class="bathroom-select"'), "HTML must render bathroom-select");
  assert.ok(html.includes('value="floor" selected'), "HTML must select floor option");

  console.log("✓ Duplicant Bathroom Options and Exhaled CO2 tests passed");
}

// 8. Non-Thermal Resources: Duplicant Labor and Calories have no temperature
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const evaluatedDupe = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: ["calories"] }, entityMap, elementMap);

  const calIn = evaluatedDupe.inputs.find((i) => i.resource === "Calories");
  assert.ok(calIn, "Duplicant with calories modifier must have Calories input");
  assert.strictEqual(calIn.tempC, undefined, "Calories input must not have tempC");
  assert.strictEqual(calIn.temp, null, "Calories input must have null temp");
  const calText = formatStreamLine(calIn, false, "c");
  assert.strictEqual(calText.includes("°C"), false, "Calories stream line must not include temperature");
  assert.strictEqual(calText, "Calories: -1000.02 kcal/cycle (free)");

  const laborOut = evaluatedDupe.outputs.find((o) => o.resource === "Duplicant Labor");
  assert.ok(laborOut, "Duplicant must have Duplicant Labor output");
  assert.strictEqual(laborOut.tempC, undefined, "Duplicant Labor output must not have tempC");
  assert.strictEqual(laborOut.temp, null, "Duplicant Labor output must have null temp");
  const laborText = formatStreamLine(laborOut, true, "s");
  assert.strictEqual(laborText.includes("°C"), false, "Duplicant Labor stream line must not include temperature");
  assert.strictEqual(laborText, "Duplicant Labor: +0.75 s/s (labor)");

  // Plant Mealwood producing Calories
  const evaluatedMealwood = evaluateRow({ entityId: "plant_mealwood", qty: 1 }, entityMap, elementMap);
  const calOut = evaluatedMealwood.outputs.find((o) => o.resource === "Calories");
  assert.ok(calOut, "Mealwood produces Calories");
  assert.strictEqual(calOut.tempC, undefined, "Mealwood Calories output must not have tempC");
  assert.strictEqual(calOut.temp, null, "Mealwood Calories output must have null temp");
  const calOutText = formatStreamLine(calOut, true, "c");
  assert.strictEqual(calOutText.includes("°C"), false, "Mealwood Calories output must not include temperature");
  assert.strictEqual(calOutText, "Calories: +199.98 kcal/cycle (free)");

  // calculateSystemNet
  const net = calculateSystemNet([evaluatedDupe, evaluatedMealwood]);
  const netLabor = net.netOutputs.find((o) => o.resource === "Duplicant Labor");
  assert.ok(netLabor, "System net outputs should contain Duplicant Labor");
  assert.strictEqual(netLabor.tempC, undefined, "Net Duplicant Labor output must not have tempC");
  assert.strictEqual(netLabor.temp, null, "Net Duplicant Labor output must have null temp");

  const netCal = net.netInputs.find((i) => i.resource === "Calories");
  assert.ok(netCal, "System net inputs should contain Calories (1000 - 200 = 800 kcal/cycle deficit)");
  assert.strictEqual(netCal.tempC, undefined, "Net Calories input must not have tempC");
  assert.strictEqual(netCal.temp, null, "Net Calories input must have null temp");

  // HTML rendering: non-thermal inputs in NET summary row should not have temperature input field
  const netHtml = renderNetSummaryRowHtml(net, elementMap, "s");
  assert.ok(netHtml.includes("Duplicant Labor"), "Net HTML renders Duplicant Labor");
  assert.ok(netHtml.includes("Calories"), "Net HTML renders Calories");
  assert.strictEqual(netHtml.includes('data-resource="Calories"'), false, "Net HTML must not render temperature input for Calories");

  // Plant Growth non-thermal resource test
  const evaluatedMealwoodGrowth = evaluateRow({ entityId: "plant_mealwood", qty: 1, recipeId: "growth" }, entityMap, elementMap);
  const growthOut = evaluatedMealwoodGrowth.outputs.find((o) => o.resource === "Growth");
  assert.ok(growthOut, "Mealwood in growth recipe must output Growth");
  assert.strictEqual(growthOut.rate, 1.0, "Mealwood growth output rate must be 1.0 growth/s");
  assert.strictEqual(growthOut.tempC, undefined, "Growth output must not have tempC");
  assert.strictEqual(growthOut.temp, null, "Growth output must have null temp");
  const growthTextS = formatStreamLine(growthOut, true, "s");
  assert.strictEqual(growthTextS, "Growth: +1 growth/s (free)");
  assert.strictEqual(growthTextS.includes("°C"), false, "Growth stream line in /s must not include temperature");
  const growthTextC = formatStreamLine(growthOut, true, "c");
  assert.strictEqual(growthTextC, "Growth: +600 growth/cycle (free)");
  assert.strictEqual(growthTextC.includes("°C"), false, "Growth stream line in /cycle must not include temperature");

  // All 4 Drecko-harvestable plants have harvest and growth recipes
  for (const plantId of ["plant_mealwood", "plant_bristle_blossom", "plant_balm_lily", "plant_pincha_pepper"]) {
    const plant = entityMap.get(plantId);
    assert.ok(plant, `Plant ${plantId} must exist`);
    assert.ok(plant.recipes && plant.recipes.length >= 2, `${plantId} must have at least 2 recipes (harvest & growth)`);
    assert.ok(plant.recipes.some((r) => r.id === "harvest"), `${plantId} must have harvest recipe`);
    const gRec = plant.recipes.find((r) => r.id === "growth");
    assert.ok(gRec, `${plantId} must have growth recipe`);
    assert.ok(gRec.outputs.some((o) => o.resource === "Growth" && o.rate === 1.0), `${plantId} growth recipe must output 1.0 Growth`);
  }

  // Both Drecko critters consume Growth
  for (const critterId of ["critter_drecko", "critter_glossy_drecko"]) {
    const critter = entityMap.get(critterId);
    assert.ok(critter, `Critter ${critterId} must exist`);
    assert.ok(critter.recipes && critter.recipes.length > 0, `${critterId} must have recipes`);
    for (const r of critter.recipes) {
      assert.ok(r.inputs.some((i) => i.resource === "Growth" && i.rate === 1.0), `${critterId} recipe ${r.id} must consume 1.0 Growth`);
    }
  }

  console.log("✓ Non-Thermal Resources (Duplicant Labor, Calories, Growth) tests passed");
}

// 9. Geotuner Connected Inputs by Geyser Type
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

  // 1x Geotuned Water Geyser -> Bleach Stone (25 g/s)
  const water1 = evaluateRow({ entityId: "geyser_water_geyser", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
  const bsIn1 = water1.inputs.find((i) => i.resource === "Bleach Stone");
  assert.ok(bsIn1, "1x Geotuned Water Geyser requires Bleach Stone");
  assert.strictEqual(bsIn1.rate, 25.0, "1x Geotuned Water Geyser consumes 25 g/s Bleach Stone");
  const waterOut1 = water1.outputs.find((o) => o.resource === "Water");
  assert.strictEqual(waterOut1.rate, 3600.0, "1x Geotuner gives +20% output (3000 * 1.2 = 3600 g/s)");

  // 5x Geotuned Water Geyser -> Bleach Stone (125 g/s)
  const water5 = evaluateRow({ entityId: "geyser_water_geyser", qty: 1, modifiers: ["geotuned_5"] }, entityMap, elementMap);
  const bsIn5 = water5.inputs.find((i) => i.resource === "Bleach Stone");
  assert.ok(bsIn5, "5x Geotuned Water Geyser requires Bleach Stone");
  assert.strictEqual(bsIn5.rate, 125.0, "5x Geotuned Water Geyser consumes 125 g/s Bleach Stone");
  const waterOut5 = water5.outputs.find((o) => o.resource === "Water");
  assert.strictEqual(waterOut5.rate, 6000.0, "5x Geotuner gives +100% output (3000 * 2 = 6000 g/s)");

  // Metal Volcano (Iron Volcano) -> Refined Phosphorus (25 g/s)
  const ironGeotuned = evaluateRow({ entityId: "geyser_iron_volcano", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
  const phosIn = ironGeotuned.inputs.find((i) => i.resource === "Refined Phosphorus");
  assert.ok(phosIn, "Geotuned Iron Volcano requires Refined Phosphorus");
  assert.strictEqual(phosIn.rate, 25.0, "1x Geotuner consumes 25 g/s Refined Phosphorus");

  // Gas Vent (Chlorine Gas Vent) -> Salt (25 g/s)
  const chlorineGeotuned = evaluateRow({ entityId: "geyser_chlorine_gas_vent", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
  const saltIn = chlorineGeotuned.inputs.find((i) => i.resource === "Salt");
  assert.ok(saltIn, "Geotuned Chlorine Vent requires Salt");
  assert.strictEqual(saltIn.rate, 25.0, "1x Geotuner consumes 25 g/s Salt");

  // Extreme / Magma (Hydrogen Vent & Volcano) -> Abyssalite (25 g/s)
  const h2Geotuned = evaluateRow({ entityId: "geyser_hydrogen_vent", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
  const abyssaliteIn = h2Geotuned.inputs.find((i) => i.resource === "Abyssalite");
  assert.ok(abyssaliteIn, "Geotuned Hydrogen Vent requires Abyssalite");
  assert.strictEqual(abyssaliteIn.rate, 25.0, "1x Geotuner consumes 25 g/s Abyssalite");

  const volcanoGeotuned = evaluateRow({ entityId: "geyser_volcano", qty: 1, modifiers: ["geotuned_5"] }, entityMap, elementMap);
  const abyssaliteIn5 = volcanoGeotuned.inputs.find((i) => i.resource === "Abyssalite");
  assert.ok(abyssaliteIn5, "5x Geotuned Volcano requires Abyssalite");
  assert.strictEqual(abyssaliteIn5.rate, 125.0, "5x Geotuner consumes 125 g/s Abyssalite");

  // calculateSystemNet
  const net = calculateSystemNet([water1, ironGeotuned]);
  const netBs = net.netInputs.find((i) => i.resource === "Bleach Stone");
  assert.ok(netBs, "Net inputs must include Bleach Stone for geotuned water geyser");
  assert.strictEqual(netBs.rate, 25.0);

  const netPhos = net.netInputs.find((i) => i.resource === "Refined Phosphorus");
  assert.ok(netPhos, "Net inputs must include Refined Phosphorus for geotuned metal volcano");
  assert.strictEqual(netPhos.rate, 25.0);

  console.log("✓ Geotuner Connected Inputs by Geyser Type tests passed");
}

console.log("\n ALL JAVASCRIPT MODULE TESTS PASSED SUCCESSFULLY! \n");
