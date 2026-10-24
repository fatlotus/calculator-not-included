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
  isSolidResource,
  NET_RATE_EPSILON,
} from "../src/calculator.js";
import { buildEntityCatalog, searchEntities } from "../src/data_loader.js";
import { PRESETS, getPresetById } from "../src/presets.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
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
    "Coal: -1 Kg/s"
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
    "Gold: -600 g/cycle"
  );

  // F. Elide (free) for solids tests
  assert.strictEqual(
    formatStreamLine({ resource: "Dirt", rate: 200, unit: "g/s", state: "free" }, false, "s"),
    "Dirt: -200 g/s"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Iron", rate: 500, unit: "g/s", state: "free" }, true, "s"),
    "Iron: +500 g/s"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Oxygen", rate: 888, unit: "g/s", state: "free" }, true, "s"),
    "Oxygen: +888 g/s (free)"
  );
  assert.strictEqual(
    formatStreamLine({ resource: "Water", rate: 1000, unit: "g/s", state: "free" }, false, "s"),
    "Water: -1 Kg/s (free)"
  );

  console.log("✓ Calculator & Math Engine tests passed");
}

// 3. URL State Serialization (Structured Protocol Buffer)
{
  const state = {
    rateMode: "s",
    rows: [
      { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "liquid_pump", qty: 0.1, recipeId: "water", modifiers: [] },
      { entityId: "gas_pump", qty: 0.224, recipeId: "hydrogen", modifiers: [] },
      { entityId: "hydrogen_generator", qty: 1.12, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: ["divers_lungs"] },
    ],
    netInputTemps: { "Water||free": 95 },
  };

  const param = encodeStateToParam(state);
  // Verify it encodes to a compact URL-safe Base64 protobuf string (no +, /, or = padding)
  assert.ok(typeof param === "string" && param.length > 0);
  assert.strictEqual(/^[A-Za-z0-9_-]+$/.test(param), true, "Encoded param must be URL-safe Base64");

  const decodedState = decodeStateFromParam(param);
  assert.strictEqual(decodedState.rateMode, "s");
  assert.strictEqual(decodedState.rows.length, 5);
  assert.strictEqual(decodedState.rows[0].entityId, "electrolyzer");
  assert.strictEqual(decodedState.rows[0].qty, 1);
  assert.strictEqual(decodedState.rows[1].qty, 0.1);
  assert.strictEqual(decodedState.rows[1].recipeId, "water");
  assert.strictEqual(decodedState.rows[2].qty, 0.224);
  assert.strictEqual(decodedState.rows[2].recipeId, "hydrogen");
  assert.deepStrictEqual(decodedState.rows[4].modifiers, ["divers_lungs"]);
  assert.strictEqual(decodedState.netInputTemps["Water||free"], 95);
  assert.strictEqual(decodedState.netInputTemps["Water|free"], 95);

  // Default temperature 20 for Water is omitted from URL
  const stateDefault = {
    rateMode: "s",
    rows: [{ entityId: "electrolyzer", qty: 1 }],
    netInputTemps: { "Water||free": 20 },
  };
  const paramDefault = encodeStateToParam(stateDefault);
  const decodedDefault = decodeStateFromParam(paramDefault);
  assert.strictEqual(decodedDefault.rows.length, 1);
  assert.strictEqual(Object.keys(decodedDefault.netInputTemps).length, 0);

  console.log("✓ URL State Serialization tests passed");
}

// 4. Presets & Strict Pipe Matching
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  assert.ok(PRESETS.length >= 5, "Should have at least 5 presets defined");
  const hydra = getPresetById("hydra_spom");
  assert.strictEqual(hydra.name, "Hydra SPOM");
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
  assert.strictEqual(dreckoCritterRow.qty, 1);
  assert.ok(
    dreckoCritterRow.recipeId === "bristle_blossom_plastic" || dreckoCritterRow.recipeId === "bristle_berry_plastic",
    "Drecko should use Bristle Blossom/Berry recipe"
  );
  const dreckoPlantRow = dreckoPreset.rows.find((r) => r.entityId === "plant_bristle_blossom");
  assert.ok(dreckoPlantRow, "Preset should contain plant_bristle_blossom");
  assert.strictEqual(dreckoPlantRow.qty, 1);
  assert.strictEqual(dreckoPlantRow.recipeId, "growth", "Bristle Blossom should use growth recipe");

  const evalDrecko = dreckoPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const dreckoNet = calculateSystemNet(evalDrecko);
  const plasticOut = dreckoNet.netOutputs.find((o) => o.resource === "Plastic");
  assert.ok(plasticOut, "Drecko preset must output Plastic");
  assert.ok(plasticOut.rate > 80, "Plastic output should be > 80 g/s");

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

  // Regular Drecko with Balm Lily preset test (Zero-Resource Reed Fiber)
  const regularDreckoPreset = getPresetById("drecko_reed_fiber_balm_lily");
  assert.ok(regularDreckoPreset, "Regular Drecko Balm Lily preset should exist");
  assert.strictEqual(regularDreckoPreset.rows.length, 2);
  const regularDreckoRow = regularDreckoPreset.rows.find((r) => r.entityId === "critter_drecko");
  assert.ok(regularDreckoRow, "Preset should contain critter_drecko");
  assert.strictEqual(regularDreckoRow.qty, 1);
  assert.strictEqual(regularDreckoRow.recipeId, "balm_lily");
  const balmLilyRow = regularDreckoPreset.rows.find((r) => r.entityId === "plant_balm_lily");
  assert.ok(balmLilyRow, "Preset should contain plant_balm_lily");
  assert.strictEqual(balmLilyRow.qty, 1);
  assert.strictEqual(balmLilyRow.recipeId, "growth");

  const evalRegularDrecko = regularDreckoPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const regularDreckoNet = calculateSystemNet(evalRegularDrecko);
  const reedFiberOut = regularDreckoNet.netOutputs.find((o) => o.resource === "Reed Fiber");
  assert.ok(reedFiberOut, "Drecko preset must output Reed Fiber");
  assert.ok(reedFiberOut.rate > 0.4, "Reed Fiber output should be > 0.4 g/s");
  const regularPhosphoriteOut = regularDreckoNet.netOutputs.find((o) => o.resource === "Phosphorite");
  assert.ok(regularPhosphoriteOut, "Drecko preset must output Phosphorite");

  // Zero net inputs: Balm Lily requires 0 inputs, Growth cancels out completely
  assert.strictEqual(regularDreckoNet.netInputs.length, 0, "Balm Lily Drecko ranch requires zero net inputs");

  // Carbon Skimmer Loops include Gas Pump with matched ratios
  const coalPreset = getPresetById("coal_skimmer_loop");
  assert.ok(coalPreset, "Coal skimmer loop preset should exist");
  assert.strictEqual(coalPreset.rows.length, 4);
  const coalGenRow = coalPreset.rows.find((r) => r.entityId === "coal_generator");
  assert.ok(coalGenRow, "Coal skimmer loop must contain coal generator");
  assert.strictEqual(coalGenRow.qty, 15, "Coal generators should be 15x");
  const coalPumpRow = coalPreset.rows.find((r) => r.entityId === "gas_pump");
  assert.ok(coalPumpRow, "Coal skimmer loop must contain a gas pump");
  assert.strictEqual(coalPumpRow.qty, 0.6, "Gas pump should be 0.6x");
  assert.strictEqual(coalPumpRow.recipeId, "carbon_dioxide");
  const coalSkimmerRow = coalPreset.rows.find((r) => r.entityId === "carbon_skimmer");
  assert.ok(coalSkimmerRow, "Coal skimmer loop must contain carbon skimmer");
  assert.strictEqual(coalSkimmerRow.qty, 1, "Carbon skimmer should be 1x");
  const coalSieveRow = coalPreset.rows.find((r) => r.entityId === "water_sieve");
  assert.ok(coalSieveRow, "Coal skimmer loop must contain water sieve");
  assert.strictEqual(coalSieveRow.qty, 0.2, "Water sieve should be 0.2x");

  const evalCoal = coalPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const coalNet = calculateSystemNet(evalCoal);
  assert.strictEqual(coalNet.netPower, 8712, "Coal skimmer loop should produce 8712 W net power");
  // All intermediate loop resources cancel to zero
  assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Carbon Dioxide"), undefined);
  assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Carbon Dioxide"), undefined);
  assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Water"), undefined);
  assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Water"), undefined);
  assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Polluted Water"), undefined);
  assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Polluted Water"), undefined);

  const arborPreset = getPresetById("arbor_ethanol_loop");
  assert.ok(arborPreset, "Arbor ethanol loop preset should exist");
  assert.strictEqual(arborPreset.rows.length, 5);
  const arborPumpRow = arborPreset.rows.find((r) => r.entityId === "gas_pump");
  assert.ok(arborPumpRow, "Arbor ethanol loop must contain a gas pump");
  assert.strictEqual(arborPumpRow.qty, 0.6, "Arbor gas pump should be 0.6x to match 1x carbon skimmer");
  assert.strictEqual(arborPumpRow.recipeId, "carbon_dioxide");
  const evalArbor = arborPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const arborNet = calculateSystemNet(evalArbor);
  // Piped CO2 from gas pump is fully consumed by carbon skimmer
  assert.strictEqual(arborNet.netOutputs.find((o) => o.resource === "Carbon Dioxide" && o.state === "in a pipe"), undefined);

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

  const net = calculateSystemNet([evaluated]);
  const netHtml = renderNetSummaryRowHtml(net, elementMap, "s", { "Water||in a pipe": 20 }, true);
  assert.ok(netHtml.includes("NET"), "NET row HTML should include NET badge");
  assert.ok(netHtml.includes("Oxygen: +888 g/s"), "NET row HTML should include Oxygen stream");
  // Ensure NET input temperature control is rendered
  assert.ok(netHtml.includes("net-temp-input"), "NET summary should include net-temp-input");
  assert.ok(netHtml.includes('data-key="Water||in a pipe"'), "NET summary input should have data-key");

  // Duplicant Labor non-thermal test: Duplicant Labor should NOT render net-temp-input
  const mgRow = { entityId: "manual_generator", qty: 1, recipeId: null, modifiers: [] };
  const mgEval = evaluateRow(mgRow, entityMap, elementMap);
  const mgNet = calculateSystemNet([mgEval]);
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
  const cgRowHtml = renderTableRowHtml({ entityId: "coal_generator", qty: 1 }, tunedCg, elementMap, "s", 0, {});
  assert.ok(cgRowHtml.includes("Coal: -1 Kg/s"), "Row HTML should display Coal without (free)");
  assert.ok(!cgRowHtml.includes("Coal: -1 Kg/s (free)"), "Row HTML must NOT display (free) next to solid Coal");

  const cgNet = calculateSystemNet([tunedCg]);
  const cgNetHtml = renderNetSummaryRowHtml(cgNet, elementMap, "s", {}, true);
  assert.ok(cgNetHtml.includes("Microchip: -0.0006 chips/s (solid)"), "NET summary should display Microchip input");
  assert.ok(!cgNetHtml.includes('data-resource="Microchip"'), "Microchip must not have a net-temp-input field");
  assert.ok(cgNetHtml.includes("Coal: -1 Kg/s"), "NET summary should display Coal input without (free)");
  assert.ok(!cgNetHtml.includes("Coal: -1 Kg/s (free)"), "NET summary must NOT show (free) next to solid Coal");

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

  // None (External / Ignored) bathroom
  const noneRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "none" }, entityMap, elementMap);
  assert.strictEqual(noneRow.inputs.some((i) => i.resource === "Water" || i.resource === "Dirt"), false, "None bathroom requires no water/dirt inputs");
  assert.strictEqual(noneRow.outputs.some((o) => o.resource === "Polluted Water" || o.resource === "Polluted Dirt"), false, "None bathroom produces no polluted water/dirt outputs");

  // URL State encoding/decoding of bathroom options
  const rowFloor = { entityId: "duplicant", qty: 2, recipeId: null, modifiers: [], bathroom: "floor" };
  const paramFloor = encodeStateToParam({ rateMode: "s", rows: [rowFloor] });
  const decodedStateFloor = decodeStateFromParam(paramFloor);
  assert.strictEqual(decodedStateFloor.rows.length, 1);
  assert.strictEqual(decodedStateFloor.rows[0].entityId, "duplicant");
  assert.strictEqual(decodedStateFloor.rows[0].qty, 2);
  assert.strictEqual(decodedStateFloor.rows[0].bathroom, "floor");

  const rowNone = { entityId: "duplicant", qty: 3, recipeId: null, modifiers: [], bathroom: "none" };
  const paramNone = encodeStateToParam({ rateMode: "s", rows: [rowNone] });
  const decodedStateNone = decodeStateFromParam(paramNone);
  assert.strictEqual(decodedStateNone.rows.length, 1);
  assert.strictEqual(decodedStateNone.rows[0].entityId, "duplicant");
  assert.strictEqual(decodedStateNone.rows[0].qty, 3);
  assert.strictEqual(decodedStateNone.rows[0].bathroom, "none");

  // HTML rendering contains bathroom selector for duplicants
  const html = renderTableRowHtml(rowFloor, floorRow, elementMap, "s", 0, {});
  assert.ok(html.includes('class="bathroom-select"'), "HTML must render bathroom-select");
  assert.ok(html.includes('value="floor" selected'), "HTML must select floor option");
  assert.ok(html.includes('value="none"'), "HTML must include none option");
  assert.ok(html.includes('class="food-select"'), "HTML must render food-select");

  const htmlNone = renderTableRowHtml(rowNone, noneRow, elementMap, "s", 0, {});
  assert.ok(htmlNone.includes('value="none" selected'), "HTML must select none option when configured");

  // Duplicant Food / Diet Selection tests
  const bbqRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "barbecue" }, entityMap, elementMap);
  const bbqIn = bbqRow.inputs.find((i) => i.resource === "Barbecue");
  assert.ok(bbqIn, "Duplicant eating Barbecue must consume Barbecue");
  assert.strictEqual(bbqIn.rate, 0.4167, "Duplicant consumes 0.4167 g/s Barbecue (250 g/cycle = 1000 kcal)");
  assert.strictEqual(bbqRow.inputs.find((i) => i.resource === "Calories"), undefined, "Duplicant eating Barbecue does not consume generic Calories");

  const seafoodRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "cooked_seafood" }, entityMap, elementMap);
  const seafoodIn = seafoodRow.inputs.find((i) => i.resource === "Cooked Seafood");
  assert.ok(seafoodIn, "Duplicant eating Cooked Seafood must consume Cooked Seafood");
  assert.strictEqual(seafoodIn.rate, 1.0417, "Duplicant consumes 1.0417 g/s Cooked Seafood (625 g/cycle = 1000 kcal)");

  const fastingRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "none" }, entityMap, elementMap);
  assert.strictEqual(fastingRow.inputs.find((i) => i.resource === "Barbecue" || i.resource === "Calories"), undefined, "Fasting duplicant consumes no food");

  const bottomlessBbq = evaluateRow({ entityId: "duplicant", qty: 1, food: "barbecue", modifiers: ["bottomless_stomach"] }, entityMap, elementMap);
  const bBbqIn = bottomlessBbq.inputs.find((i) => i.resource === "Barbecue");
  assert.ok(bBbqIn, "Bottomless Stomach duplicant eating Barbecue must consume Barbecue");
  assert.strictEqual(Math.round(bBbqIn.rate * 10000) / 10000, 0.6251, "Bottomless stomach increases food consumption by 1.5x (0.6251 g/s)");

  // End-to-End Ranch -> Grill -> Duplicant Diet Stream Cancellation
  // 8 Duplicants eating Barbecue need 8 * 0.4167 = 3.3336 g/s Barbecue
  // Electric Grill produces 20 g/s Barbecue & consumes 40 g/s Meat -> 3.3336 / 20 = 0.16668 Grills
  // 0.16668 Grills consume 0.16668 * 40 = 6.6672 g/s Meat
  // Stone Hatch produces 0.5556 g/s Meat -> 6.6672 / 0.5556 = 12 Stone Hatches
  const evalHatches12 = evaluateRow({ entityId: "critter_stone_hatch", qty: 12, recipeId: "igneous_rock" }, entityMap, elementMap);
  const evalGrillMatched = evaluateRow({ entityId: "electric_grill", qty: 0.16668, recipeId: "barbecue" }, entityMap, elementMap);
  const evalDupes8 = evaluateRow({ entityId: "duplicant", qty: 8, food: "barbecue" }, entityMap, elementMap);

  const foodNet = calculateSystemNet([evalHatches12, evalGrillMatched, evalDupes8]);
  const netMeatRemain = foodNet.netInputs.find((i) => i.resource === "Meat") || foodNet.netOutputs.find((o) => o.resource === "Meat");
  const netBbqRemain = foodNet.netInputs.find((i) => i.resource === "Barbecue") || foodNet.netOutputs.find((o) => o.resource === "Barbecue");
  assert.ok(!netMeatRemain || Math.abs(netMeatRemain.rate) < 0.001, "Meat completely balances out in 12 Stone Hatches -> 0.1667 Grill -> 8 Duplicants chain");
  assert.ok(!netBbqRemain || Math.abs(netBbqRemain.rate) < 0.001, "Barbecue completely balances out in 12 Stone Hatches -> 0.1667 Grill -> 8 Duplicants chain");

  // Verify Electric Grill labor cost and net labor calculation
  const grillLaborIn = evalGrillMatched.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.ok(grillLaborIn, "Electric Grill must consume Duplicant Labor");
  assert.strictEqual(grillLaborIn.rate, 0.16668, "Grill labor rate scales proportionally with machine quantity");

  const netLabor = foodNet.netOutputs.find((o) => o.resource === "Duplicant Labor");
  assert.ok(netLabor, "System net includes Duplicant Labor from duplicants minus labor consumed by Electric Grill");
  assert.strictEqual(Math.round(netLabor.rate * 10000) / 10000, 5.8333, "8 Duplicants (6.0 s/s) minus 0.16668 Grill (0.16668 s/s) leaves 5.8333 s/s net labor");

  // Verify all food-producing cooking machines require Duplicant Labor across all recipes
  const cookingBuildingIds = ["microbe_musher", "electric_grill", "gas_range", "deep_fryer", "smoker"];
  for (const bId of cookingBuildingIds) {
    const building = entityMap.get(bId);
    assert.ok(building, `Building ${bId} must exist`);
    assert.ok(
      building.inputs.some((i) => i.resource === "Duplicant Labor"),
      `Base inputs of ${bId} must include Duplicant Labor`
    );
    for (const r of building.recipes || []) {
      assert.ok(
        r.inputs.some((i) => i.resource === "Duplicant Labor"),
        `Recipe ${r.id} on ${bId} must include Duplicant Labor`
      );
    }
  }

  console.log("✓ Duplicant Bathroom Options and Exhaled CO2 tests passed");
}

// 8. Non-Thermal Resources: Duplicant Labor and Calories have no temperature
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const dupeEntity = entityMap.get("duplicant");
  assert.strictEqual(
    dupeEntity.modifiers?.some((m) => m.id === "calories"),
    false,
    "Duplicant must not have Include Food (calories) modifier"
  );

  const evaluatedDupe = evaluateRow({ entityId: "duplicant", qty: 1 }, entityMap, elementMap);

  const calIn = evaluatedDupe.inputs.find((i) => i.resource === "Calories");
  assert.ok(calIn, "Duplicant must have Calories input by default");
  assert.strictEqual(calIn.tempC, undefined, "Calories input must not have tempC");
  assert.strictEqual(calIn.temp, null, "Calories input must have null temp");
  const calText = formatStreamLine(calIn, false, "c");
  assert.strictEqual(calText.includes("°C"), false, "Calories stream line must not include temperature");
  assert.strictEqual(calText, "Calories: -1000.02 kcal/cycle (free)");

  // Duplicant with explicit empty modifiers still consumes calories by default
  const emptyModsDupe = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: [] }, entityMap, elementMap);
  const emptyModsCalIn = emptyModsDupe.inputs.find((i) => i.resource === "Calories");
  assert.ok(emptyModsCalIn, "Duplicant with empty modifiers still consumes Calories by default");

  // Fasting duplicant (food: 'none') disables food/calorie consumption
  const fastingDupe = evaluateRow({ entityId: "duplicant", qty: 1, food: "none" }, entityMap, elementMap);
  assert.strictEqual(fastingDupe.inputs.find((i) => i.resource === "Calories"), undefined, "Fasting duplicant does not consume calories");

  // Bionic duplicant does not consume calories
  const bionicDupe = evaluateRow({ entityId: "bionic_duplicant", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(bionicDupe.inputs.find((i) => i.resource === "Calories"), undefined, "Bionic duplicant must never consume calories");

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

  // Critter Meat & Pacu Fillet Production
  const evalHatch = evaluateRow({ entityId: "critter_hatch", qty: 1 }, entityMap, elementMap);
  const hatchMeat = evalHatch.outputs.find((o) => o.resource === "Meat");
  assert.ok(hatchMeat, "Hatch must output Meat");
  assert.strictEqual(hatchMeat.rate, 0.5556, "Hatch produces 0.5556 g/s Meat (2 kg per 6-cycle egg)");
  assert.strictEqual(evalHatch.outputs.find((o) => o.resource === "Calories"), undefined, "Hatch must not produce Calories directly");

  const evalPacu = evaluateRow({ entityId: "critter_pacu", qty: 1 }, entityMap, elementMap);
  const pacuFillet = evalPacu.outputs.find((o) => o.resource === "Pacu Fillet");
  assert.ok(pacuFillet, "Pacu must output Pacu Fillet");
  assert.strictEqual(pacuFillet.rate, 1.1111, "Pacu produces 1.1111 g/s Pacu Fillet (1 kg per 1.5-cycle egg)");
  assert.strictEqual(evalPacu.outputs.find((o) => o.resource === "Calories"), undefined, "Pacu must not produce Calories directly");

  const evalVole = evaluateRow({ entityId: "critter_shove_vole", qty: 1 }, entityMap, elementMap);
  const voleMeat = evalVole.outputs.find((o) => o.resource === "Meat");
  assert.ok(voleMeat, "Shove Vole must output Meat");
  assert.strictEqual(voleMeat.rate, 2.7778, "Shove Vole produces 2.7778 g/s Meat (10 kg per 6-cycle egg)");
  assert.strictEqual(evalVole.outputs.find((o) => o.resource === "Calories"), undefined, "Shove Vole must not produce Calories directly");

  // Wild hatch produces 25% meat (0.1389 g/s)
  const evalWildHatch = evaluateRow({ entityId: "critter_hatch", qty: 1, modifiers: ["wild"] }, entityMap, elementMap);
  const wildMeat = evalWildHatch.outputs.find((o) => o.resource === "Meat");
  assert.ok(wildMeat, "Wild Hatch must output Meat");
  assert.strictEqual(Math.round(wildMeat.rate * 10000) / 10000, 0.1389);

  // Food-Producing Machines: Microbe Musher, Electric Grill, Gas Range, Deep Fryer
  const evalGrill = evaluateRow({ entityId: "electric_grill", qty: 1, recipeId: "barbecue" }, entityMap, elementMap);
  const grillMeatIn = evalGrill.inputs.find((i) => i.resource === "Meat");
  const grillLaborIn = evalGrill.inputs.find((i) => i.resource === "Duplicant Labor");
  const grillBbqOut = evalGrill.outputs.find((o) => o.resource === "Barbecue");
  assert.ok(grillMeatIn, "Electric Grill must consume Meat for Barbecue");
  assert.strictEqual(grillMeatIn.rate, 40.0, "Grill consumes 40 g/s Meat (2 kg per 50s batch)");
  assert.ok(grillLaborIn, "Electric Grill requires Duplicant Labor");
  assert.strictEqual(grillLaborIn.rate, 1.0);
  assert.ok(grillBbqOut, "Electric Grill outputs Barbecue");
  assert.strictEqual(grillBbqOut.rate, 20.0, "Grill produces 20 g/s Barbecue (1 kg per 50s batch)");
  assert.strictEqual(evalGrill.power, -60);
  assert.strictEqual(evalGrill.heat, 4.5);

  const evalGasRange = evaluateRow({ entityId: "gas_range", qty: 1, recipeId: "surf_and_turf" }, entityMap, elementMap);
  const rangeBbqIn = evalGasRange.inputs.find((i) => i.resource === "Barbecue");
  const rangeFishIn = evalGasRange.inputs.find((i) => i.resource === "Cooked Seafood");
  const rangeGasIn = evalGasRange.inputs.find((i) => i.resource === "Natural Gas" && i.state === "in a pipe");
  const rangeSurfOut = evalGasRange.outputs.find((o) => o.resource === "Surf'n'Turf");
  const rangeCo2Out = evalGasRange.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(rangeBbqIn && rangeFishIn && rangeGasIn && rangeSurfOut && rangeCo2Out, "Gas Range Surf'n'Turf streams verified");
  assert.strictEqual(rangeGasIn.rate, 100.0);
  assert.strictEqual(rangeCo2Out.rate, 25.0);
  assert.strictEqual(evalGasRange.power, -240);
  assert.strictEqual(evalGasRange.heat, 9.0);

  // System Net: Ranch to Grill meat matching
  // 8 Hatches * 0.5556 g/s Meat = 4.4448 g/s Meat
  // Grill takes 40 g/s Meat, so 4.4448 / 40 = 0.11112 Grills
  const evalHatches = evaluateRow({ entityId: "critter_hatch", qty: 8 }, entityMap, elementMap);
  const evalMatchedGrill = evaluateRow({ entityId: "electric_grill", qty: 0.11112, recipeId: "barbecue" }, entityMap, elementMap);
  const netRanchGrill = calculateSystemNet([evalHatches, evalMatchedGrill]);
  const netMeat = netRanchGrill.netInputs.find((i) => i.resource === "Meat") || netRanchGrill.netOutputs.find((o) => o.resource === "Meat");
  assert.ok(!netMeat || Math.abs(netMeat.rate) < 0.001, "Meat cancels out between 8 ranched hatches and matched grill");

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

// 10. Elision of Small Net Resource Inputs and Outputs (Roundoff Error Handling)
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  assert.strictEqual(NET_RATE_EPSILON, 1e-4, "NET_RATE_EPSILON must be 1e-4 (0.0001)");

  // 10.1 Oil Refinery preset: 1 oil refinery (1 s/s labor input) + 1.3333 duplicants (0.75 s/s labor output each)
  // Net labor is 0.999975 - 1.0 = -0.000025 s/s. This residual roundoff must be elided.
  const oilPreset = getPresetById("oil_refinery_petroleum_loop");
  assert.ok(oilPreset, "Oil refinery preset should exist");
  const evalOil = oilPreset.rows.map((r) => evaluateRow(r, entityMap, elementMap));
  const oilNet = calculateSystemNet(evalOil, { elementMap });

  const laborInNet = oilNet.netInputs.find((i) => i.resource === "Duplicant Labor");
  const laborOutNet = oilNet.netOutputs.find((o) => o.resource === "Duplicant Labor");
  assert.strictEqual(laborInNet, undefined, "Duplicant Labor roundoff residual (-0.000025 s/s) must be elided from netInputs");
  assert.strictEqual(laborOutNet, undefined, "Duplicant Labor must not appear in netOutputs");

  // Verify NET summary row HTML does NOT render "Duplicant Labor: -0 s/s (labor)" or any "-0" text
  const oilNetHtml = renderNetSummaryRowHtml(oilNet, elementMap, "s");
  assert.ok(!oilNetHtml.includes("Duplicant Labor"), "NET summary HTML must not render elided Duplicant Labor");
  assert.ok(!oilNetHtml.includes("-0 s/s"), "NET summary HTML must not display -0 s/s");
  assert.ok(!oilNetHtml.includes("-0 "), "NET summary HTML must not display negative zero for any resource");

  // Legitimate real inputs in this preset should remain intact
  assert.ok(oilNetHtml.includes("Crude Oil: -10 Kg/s"), "Real net input Crude Oil must be displayed");
  assert.ok(oilNetHtml.includes("Oxygen: -133.33 g/s"), "Real net input Oxygen must be displayed");
  assert.ok(oilNetHtml.includes("Water: -11.1108 g/s"), "Real net input Water must be displayed");

  // 10.2 Synthetic small amount elision for both inputs and outputs
  const tinyInputRow = {
    power: 0,
    heat: 0,
    inputs: [{ resource: "Water", rate: 0.00005, unit: "g/s", state: "free" }],
    outputs: [],
  };
  const tinyOutputRow = {
    power: 0,
    heat: 0,
    inputs: [],
    outputs: [{ resource: "Oxygen", rate: 0.000025, unit: "g/s", state: "free" }],
  };
  const tinyNet = calculateSystemNet([tinyInputRow, tinyOutputRow]);
  assert.strictEqual(tinyNet.netInputs.length, 0, "Tiny inputs below NET_RATE_EPSILON must be elided");
  assert.strictEqual(tinyNet.netOutputs.length, 0, "Tiny outputs below NET_RATE_EPSILON must be elided");

  // When all inputs/outputs are elided, empty-state placeholders must render
  const tinyHtml = renderNetSummaryRowHtml(tinyNet, elementMap, "s");
  assert.ok(tinyHtml.includes("None (0 net input required)"), "Empty input state rendered when inputs are elided");
  assert.ok(tinyHtml.includes("None (0 net surplus)"), "Empty output state rendered when outputs are elided");

  // 10.3 Preserving legitimate small resources above NET_RATE_EPSILON (e.g. Microchips, Gear Balm)
  const bionicRow = { entityId: "bionic_duplicant", qty: 1, recipeId: "gear_balm", modifiers: [] };
  const bionicEval = evaluateRow(bionicRow, entityMap, elementMap);
  const bionicNet = calculateSystemNet([bionicEval], { elementMap });
  const balmIn = bionicNet.netInputs.find((i) => i.resource === "Gear Balm");
  assert.ok(balmIn, "Gear Balm (0.0004167 balm/s) is above NET_RATE_EPSILON and must NOT be elided");
  assert.strictEqual(balmIn.rate, 0.0004167);

  const bionicHtml = renderNetSummaryRowHtml(bionicNet, elementMap, "s");
  assert.ok(bionicHtml.includes("Gear Balm: -0.0004 balm/s"), "Gear Balm must be displayed in NET inputs");

  const generatorRow = { entityId: "coal_generator", qty: 1, modifiers: ["engie_tuneup"] };
  const genEval = evaluateRow(generatorRow, entityMap, elementMap);
  const genNet = calculateSystemNet([genEval], { elementMap });
  const chipIn = genNet.netInputs.find((i) => i.resource === "Microchip");
  assert.ok(chipIn, "Microchip (0.0005556 chips/s) is above NET_RATE_EPSILON and must NOT be elided");

  // 10.4 formatStreamLine zero-sign behavior
  const zeroLabor = formatStreamLine({ resource: "Duplicant Labor", rate: 0, unit: "s/s", state: "labor" }, false, "s");
  assert.strictEqual(zeroLabor, "Duplicant Labor: 0 s/s (labor)", "Zero stream rate must format with unsigned 0");
  const tinyLabor = formatStreamLine({ resource: "Duplicant Labor", rate: 0.000025, unit: "s/s", state: "labor" }, false, "s");
  assert.strictEqual(tinyLabor, "Duplicant Labor: 0 s/s (labor)", "Stream rate rounding to 0 must format with unsigned 0, never -0");

  // 10.5 Cycle mode ("c") roundoff elision
  const oilNetHtmlCycle = renderNetSummaryRowHtml(oilNet, elementMap, "c");
  assert.ok(!oilNetHtmlCycle.includes("Duplicant Labor"), "Duplicant Labor must also be elided in cycle rate mode");
  assert.ok(!oilNetHtmlCycle.includes("-0 /cycle"), "Cycle mode must never render -0 /cycle");

  console.log("✓ Small Net Resource Inputs & Outputs Elision (Roundoff Error Handling) tests passed");
}

// 11. Icon Integrity and Accuracy Tests
{
  const { entities, entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

  // Machine icons must be actual machine graphics, not expansion pack logos
  const sublimation = entityMap.get("sublimation_station");
  assert.ok(sublimation, "Sublimation Station must exist");
  assert.strictEqual(sublimation.icon, "images/icons/Sublimation_Station.png", "Sublimation Station must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", sublimation.icon)), "Sublimation Station icon file must exist");

  const peatBurner = entityMap.get("peat_burner");
  assert.ok(peatBurner, "Peat Burner must exist");
  assert.strictEqual(peatBurner.icon, "images/icons/Peat_Burner.png", "Peat Burner must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", peatBurner.icon)), "Peat Burner icon file must exist");

  const sludgePress = entityMap.get("sludge_press");
  assert.ok(sludgePress, "Sludge Press must exist");
  assert.strictEqual(sludgePress.icon, "images/icons/Sludge_Press.png", "Sludge Press must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", sludgePress.icon)), "Sludge Press icon file must exist");

  const deepFryer = entityMap.get("deep_fryer");
  assert.ok(deepFryer, "Deep Fryer must exist");
  assert.strictEqual(deepFryer.icon, "images/icons/Deep_Fryer.png", "Deep Fryer must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", deepFryer.icon)), "Deep Fryer icon file must exist");

  const smoker = entityMap.get("smoker");
  assert.ok(smoker, "Smoker must exist");
  assert.strictEqual(smoker.icon, "images/icons/Smoker.png", "Smoker must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", smoker.icon)), "Smoker icon file must exist");

  const powerControl = entityMap.get("power_control_station");
  assert.ok(powerControl, "Power Control Station must exist");
  assert.strictEqual(powerControl.icon, "images/icons/Power_Control_Station.png", "Power Control Station must use its machine icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", powerControl.icon)), "Power Control Station icon file must exist");

  // Element and resource icons verification
  const reedFiber = elementMap.get("Reed Fiber");
  assert.ok(reedFiber, "Reed Fiber must exist in elementMap");
  assert.strictEqual(reedFiber.icon, "images/icons/Reed_Fiber.png", "Reed Fiber must have Reed_Fiber.png icon");
  assert.ok(fs.existsSync(path.resolve(__dirname, "..", reedFiber.icon)), "Reed Fiber icon file must exist");

  const pollutedDirt = elementMap.get("Polluted Dirt");
  assert.ok(pollutedDirt, "Polluted Dirt must exist in elementMap");
  assert.strictEqual(pollutedDirt.icon, "images/icons/Polluted_Dirt.png", "Polluted Dirt must use Polluted_Dirt.png icon");

  const microchip = elementMap.get("Microchip");
  assert.ok(microchip, "Microchip must exist in elementMap");
  assert.strictEqual(microchip.icon, "images/icons/Microchip.png", "Microchip must use Microchip.png icon");

  const gearBalm = elementMap.get("Gear Balm");
  assert.ok(gearBalm, "Gear Balm must exist in elementMap");
  assert.strictEqual(gearBalm.icon, "images/icons/Gear_Balm.png", "Gear Balm must use Gear_Balm.png icon");

  // Verify no entity or input/output stream uses an expansion pack icon
  for (const ent of entities) {
    assert.ok(!ent.icon.includes("_icon.png"), `Entity ${ent.name} must not use expansion pack icon (${ent.icon})`);

    const checkStreams = (streams) => {
      if (!streams) return;
      for (const s of streams) {
        const elem = elementMap.get(s.resource);
        assert.ok(elem, `Resource ${s.resource} used in ${ent.name} must resolve in elementMap`);
        assert.ok(elem.icon, `Resource ${s.resource} must have an icon`);
        assert.ok(fs.existsSync(path.resolve(__dirname, "..", elem.icon)), `Icon file ${elem.icon} for resource ${s.resource} must exist`);
        assert.ok(!elem.icon.includes("_icon.png"), `Resource ${s.resource} must not use expansion pack icon (${elem.icon})`);
      }
    };

    checkStreams(ent.inputs);
    checkStreams(ent.outputs);
    if (ent.recipes) {
      for (const r of ent.recipes) {
        checkStreams(r.inputs);
        checkStreams(r.outputs);
      }
    }
  }

  console.log("✓ Icon Integrity and Accuracy tests passed");
}

console.log("\n ALL JAVASCRIPT MODULE TESTS PASSED SUCCESSFULLY! \n");

// 10. Sludge Press Recipes and Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const sludgePress = entityMap.get("sludge_press");
  assert.ok(sludgePress, "sludge_press entity must exist");
  assert.strictEqual(sludgePress.recipes.length, 2, "Sludge Press must have 2 recipes");

  // Default evaluation (Mud recipe)
  const defaultEval = evaluateRow({ entityId: "sludge_press", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -120);
  assert.strictEqual(defaultEval.heat, 4.0);
  const mudIn = defaultEval.inputs.find((i) => i.resource === "Mud");
  const laborIn = defaultEval.inputs.find((i) => i.resource === "Duplicant Labor");
  const dirtOut = defaultEval.outputs.find((o) => o.resource === "Dirt");
  const waterOut = defaultEval.outputs.find((o) => o.resource === "Water");

  assert.ok(mudIn, "Sludge Press default must consume Mud");
  assert.strictEqual(mudIn.rate, 7500.0);
  assert.strictEqual(mudIn.state, "free");

  assert.ok(laborIn, "Sludge Press default must require Duplicant Labor");
  assert.strictEqual(laborIn.rate, 1.0);
  assert.strictEqual(laborIn.unit, "s/s");
  assert.strictEqual(laborIn.state, "labor");

  assert.ok(dirtOut, "Sludge Press default must output Dirt");
  assert.strictEqual(dirtOut.rate, 3000.0);
  assert.strictEqual(dirtOut.state, "free");

  assert.ok(waterOut, "Sludge Press default must output Water in a pipe");
  assert.strictEqual(waterOut.rate, 4500.0);
  assert.strictEqual(waterOut.state, "in a pipe");

  // Explicit recipe: mud
  const mudEval = evaluateRow({ entityId: "sludge_press", qty: 2, recipeId: "mud" }, entityMap, elementMap);
  assert.strictEqual(mudEval.power, -240);
  assert.strictEqual(mudEval.heat, 8.0);
  const mudIn2 = mudEval.inputs.find((i) => i.resource === "Mud");
  const waterOut2 = mudEval.outputs.find((o) => o.resource === "Water");
  assert.strictEqual(mudIn2.rate, 15000.0);
  assert.strictEqual(waterOut2.rate, 9000.0);

  // Explicit recipe: polluted_mud
  const pmudEval = evaluateRow({ entityId: "sludge_press", qty: 1, recipeId: "polluted_mud" }, entityMap, elementMap);
  assert.strictEqual(pmudEval.power, -120);
  assert.strictEqual(pmudEval.heat, 4.0);
  const pmudIn = pmudEval.inputs.find((i) => i.resource === "Polluted Mud");
  const pmudLabor = pmudEval.inputs.find((i) => i.resource === "Duplicant Labor");
  const pdirtOut = pmudEval.outputs.find((o) => o.resource === "Polluted Dirt");
  const pwaterOut = pmudEval.outputs.find((o) => o.resource === "Polluted Water");

  assert.ok(pmudIn, "Sludge Press polluted_mud recipe must consume Polluted Mud");
  assert.strictEqual(pmudIn.rate, 7500.0);
  assert.strictEqual(pmudIn.state, "free");

  assert.ok(pmudLabor, "Sludge Press polluted_mud recipe must require Duplicant Labor");
  assert.strictEqual(pmudLabor.rate, 1.0);

  assert.ok(pdirtOut, "Sludge Press polluted_mud recipe must output Polluted Dirt");
  assert.strictEqual(pdirtOut.rate, 3000.0);
  assert.strictEqual(pdirtOut.state, "free");

  assert.ok(pwaterOut, "Sludge Press polluted_mud recipe must output Polluted Water in a pipe");
  assert.strictEqual(pwaterOut.rate, 4500.0);
  assert.strictEqual(pwaterOut.state, "in a pipe");

  // URL state round-trip with sludge_press and polluted_mud recipe
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "sludge_press", qty: 1, recipeId: "polluted_mud", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "sludge_press");
  assert.strictEqual(decoded.rows[0].recipeId, "polluted_mud");

  console.log("✓ Sludge Press Recipes and Calculations tests passed");
}

// 11. Compost Recipes and Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const compost = entityMap.get("compost");
  assert.ok(compost, "compost entity must exist");
  assert.ok(compost.recipes.length >= 6, "Compost must have compostable recipes");

  // Default evaluation (Polluted Dirt recipe)
  const defaultEval = evaluateRow({ entityId: "compost", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, 0.0);
  assert.strictEqual(defaultEval.heat, 1.125);
  const pdirtIn = defaultEval.inputs.find((i) => i.resource === "Polluted Dirt");
  const dirtOut = defaultEval.outputs.find((o) => o.resource === "Dirt");

  assert.ok(pdirtIn, "Compost default must consume Polluted Dirt");
  assert.strictEqual(pdirtIn.rate, 100.0);
  assert.strictEqual(pdirtIn.state, "free");

  assert.ok(dirtOut, "Compost default must output Dirt");
  assert.strictEqual(dirtOut.rate, 100.0);
  assert.strictEqual(dirtOut.state, "free");
  // Clamped output temperature @ 75 °C minimum
  assert.strictEqual(dirtOut.tempC, 75.0);

  // Temperature clamping tests:
  // Low inlet temp (20 °C) -> clamped to 75 °C
  const lowInletEval = evaluateRow({ entityId: "compost", qty: 1, inputTemp: 20.0 }, entityMap, elementMap);
  const lowDirtOut = lowInletEval.outputs.find((o) => o.resource === "Dirt");
  assert.strictEqual(lowDirtOut.tempC, 75.0);

  // High inlet temp (85 °C) -> passes through at 85 °C
  const highInletEval = evaluateRow({ entityId: "compost", qty: 1, inputTemp: 85.0 }, entityMap, elementMap);
  const highDirtOut = highInletEval.outputs.find((o) => o.resource === "Dirt");
  assert.strictEqual(highDirtOut.tempC, 85.0);

  // Explicit recipe: rot_pile
  const rotEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: "rot_pile" }, entityMap, elementMap);
  assert.strictEqual(rotEval.power, 0.0);
  assert.strictEqual(rotEval.heat, 1.125);
  const rotIn = rotEval.inputs.find((i) => i.resource === "Rot Pile");
  const rotDirtOut = rotEval.outputs.find((o) => o.resource === "Dirt");
  assert.ok(rotIn, "Compost rot_pile recipe must consume Rot Pile");
  assert.strictEqual(rotIn.rate, 100.0);
  assert.ok(rotDirtOut, "Compost rot_pile recipe must output Dirt");
  assert.strictEqual(rotDirtOut.rate, 100.0);

  // Explicit recipe: meal_lice
  const mealEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: "meal_lice" }, entityMap, elementMap);
  const mealIn = mealEval.inputs.find((i) => i.resource === "Meal Lice");
  assert.ok(mealIn, "Compost meal_lice recipe must consume Meal Lice");
  assert.strictEqual(mealIn.rate, 100.0);

  // Explicit recipe: bristle_berry
  const berryEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: "bristle_berry" }, entityMap, elementMap);
  const berryIn = berryEval.inputs.find((i) => i.resource === "Bristle Berry");
  assert.ok(berryIn, "Compost bristle_berry recipe must consume Bristle Berry");
  assert.strictEqual(berryIn.rate, 100.0);

  // Explicit recipe: mushroom
  const mushEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: "mushroom" }, entityMap, elementMap);
  const mushIn = mushEval.inputs.find((i) => i.resource === "Mushroom");
  assert.ok(mushIn, "Compost mushroom recipe must consume Mushroom");
  assert.strictEqual(mushIn.rate, 100.0);

  // Explicit recipe: seeds
  const seedsEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: "seeds" }, entityMap, elementMap);
  const seedsIn = seedsEval.inputs.find((i) => i.resource === "Seeds");
  assert.ok(seedsIn, "Compost seeds recipe must consume Seeds");
  assert.strictEqual(seedsIn.rate, 100.0);

  // Scaling with quantity (qty: 3)
  const multiEval = evaluateRow({ entityId: "compost", qty: 3, recipeId: "rot_pile" }, entityMap, elementMap);
  assert.strictEqual(multiEval.power, 0.0);
  assert.strictEqual(multiEval.heat, 3.375);
  const multiIn = multiEval.inputs.find((i) => i.resource === "Rot Pile");
  const multiOut = multiEval.outputs.find((o) => o.resource === "Dirt");
  assert.strictEqual(multiIn.rate, 300.0);
  assert.strictEqual(multiOut.rate, 300.0);

  // URL state round-trip with compost and rot_pile recipe
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "compost", qty: 2, recipeId: "rot_pile", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "compost");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "rot_pile");

  console.log("✓ Compost Recipes and Calculations tests passed");
}

// 12. Peat Burner Building and Tune-Up Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const peatBurner = entityMap.get("peat_burner");
  assert.ok(peatBurner, "peat_burner entity must exist");
  assert.strictEqual(peatBurner.name, "Peat Burner");

  // Default evaluation (qty: 1)
  const defaultEval = evaluateRow({ entityId: "peat_burner", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, 480.0);
  assert.strictEqual(defaultEval.heat, 4.5);

  const peatIn = defaultEval.inputs.find((i) => i.resource === "Peat");
  assert.ok(peatIn, "Peat Burner must consume Peat");
  assert.strictEqual(peatIn.rate, 1000.0);
  assert.strictEqual(peatIn.unit, "g/s");
  assert.strictEqual(peatIn.state, "free");

  const co2Out = defaultEval.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(co2Out, "Peat Burner must output Carbon Dioxide");
  assert.strictEqual(co2Out.rate, 40.0);
  assert.strictEqual(co2Out.unit, "g/s");
  assert.strictEqual(co2Out.state, "free");
  assert.strictEqual(co2Out.tempC, 110.0);

  // Scaling with quantity (qty: 2)
  const multiEval = evaluateRow({ entityId: "peat_burner", qty: 2 }, entityMap, elementMap);
  assert.strictEqual(multiEval.power, 960.0);
  assert.strictEqual(multiEval.heat, 9.0);
  const multiPeatIn = multiEval.inputs.find((i) => i.resource === "Peat");
  assert.strictEqual(multiPeatIn.rate, 2000.0);
  const multiCo2Out = multiEval.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.strictEqual(multiCo2Out.rate, 80.0);

  // Engie's Tune-Up modifier (+50% power, Microchip extra input)
  const tunedEval = evaluateRow({ entityId: "peat_burner", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
  assert.strictEqual(tunedEval.power, 720.0);
  const tunedPeatIn = tunedEval.inputs.find((i) => i.resource === "Peat");
  assert.ok(tunedPeatIn, "Tuned Peat Burner must consume Peat");
  assert.strictEqual(tunedPeatIn.rate, 1000.0);
  const chipIn = tunedEval.inputs.find((i) => i.resource === "Microchip");
  assert.ok(chipIn, "Tuned Peat Burner must consume Microchips");
  assert.strictEqual(chipIn.unit, "chips/s");
  assert.strictEqual(chipIn.state, "solid");
  assert.strictEqual(chipIn.rate, 0.0005555556);

  // URL state round-trip with Peat Burner and Engie's Tune-Up
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "peat_burner", qty: 2, recipeId: null, modifiers: ["engie_tuneup"] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "peat_burner");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.deepStrictEqual(decoded.rows[0].modifiers, ["engie_tuneup"]);

  console.log("✓ Peat Burner Building and Tune-Up tests passed");
}

// 13. Gleaner Building and Recipes Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const gleaner = entityMap.get("brackwax_gleaner");
  assert.ok(gleaner, "brackwax_gleaner entity must exist");
  assert.strictEqual(gleaner.name, "Gleaner");
  assert.strictEqual(gleaner.category, "Machine");
  assert.strictEqual(gleaner.subcategory, "Refinement");
  assert.strictEqual(gleaner.recipes.length, 2);

  // Default evaluation (primary recipe: brackene)
  const defaultEval = evaluateRow({ entityId: "brackwax_gleaner", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -480.0);
  assert.strictEqual(defaultEval.heat, 8.0);
  assert.strictEqual(defaultEval.inputs.length, 1);
  assert.strictEqual(defaultEval.outputs.length, 3);

  const brackeneIn = defaultEval.inputs.find((i) => i.resource === "Brackene");
  assert.ok(brackeneIn, "Default Gleaner must consume Brackene");
  assert.strictEqual(brackeneIn.rate, 1000.0);
  assert.strictEqual(brackeneIn.unit, "g/s");
  assert.strictEqual(brackeneIn.state, "in a pipe");

  const brackwaxOut = defaultEval.outputs.find((o) => o.resource === "Brackwax");
  assert.ok(brackwaxOut, "Default Gleaner must output Brackwax");
  assert.strictEqual(brackwaxOut.rate, 90.0);
  assert.strictEqual(brackwaxOut.unit, "g/s");
  assert.strictEqual(brackwaxOut.state, "free");

  const brineOut = defaultEval.outputs.find((o) => o.resource === "Brine");
  assert.ok(brineOut, "Default Gleaner must output Brine");
  assert.strictEqual(brineOut.rate, 810.0);
  assert.strictEqual(brineOut.unit, "g/s");
  assert.strictEqual(brineOut.state, "in a pipe");

  const co2Out = defaultEval.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(co2Out, "Default Gleaner must output Carbon Dioxide");
  assert.strictEqual(co2Out.rate, 100.0);
  assert.strictEqual(co2Out.unit, "g/s");
  assert.strictEqual(co2Out.state, "free");
  assert.strictEqual(co2Out.tempC, 75.0);

  // Explicit recipe: brackene
  const brackeneEval = evaluateRow({ entityId: "brackwax_gleaner", qty: 2, recipeId: "brackene" }, entityMap, elementMap);
  assert.strictEqual(brackeneEval.power, -960.0);
  assert.strictEqual(brackeneEval.heat, 16.0);
  assert.strictEqual(brackeneEval.inputs[0].resource, "Brackene");
  assert.strictEqual(brackeneEval.inputs[0].rate, 2000.0);
  assert.strictEqual(brackeneEval.outputs.find((o) => o.resource === "Brackwax").rate, 180.0);
  assert.strictEqual(brackeneEval.outputs.find((o) => o.resource === "Brine").rate, 1620.0);
  assert.strictEqual(brackeneEval.outputs.find((o) => o.resource === "Carbon Dioxide").rate, 200.0);

  // Explicit recipe: ovolene
  const ovoleneEval = evaluateRow({ entityId: "brackwax_gleaner", qty: 1, recipeId: "ovolene" }, entityMap, elementMap);
  assert.strictEqual(ovoleneEval.power, -480.0);
  assert.strictEqual(ovoleneEval.heat, 8.0);
  assert.strictEqual(ovoleneEval.inputs.length, 1);
  assert.strictEqual(ovoleneEval.outputs.length, 3);

  const ovoleneIn = ovoleneEval.inputs.find((i) => i.resource === "Ovolene");
  assert.ok(ovoleneIn, "Ovolene recipe must consume Ovolene");
  assert.strictEqual(ovoleneIn.rate, 1000.0);
  assert.strictEqual(ovoleneIn.unit, "g/s");
  assert.strictEqual(ovoleneIn.state, "in a pipe");

  const caviarOut = ovoleneEval.outputs.find((o) => o.resource === "Caviar");
  assert.ok(caviarOut, "Ovolene recipe must output Caviar");
  assert.strictEqual(caviarOut.rate, 90.0);
  assert.strictEqual(caviarOut.unit, "g/s");
  assert.strictEqual(caviarOut.state, "free");

  const mucinOut = ovoleneEval.outputs.find((o) => o.resource === "Mucin");
  assert.ok(mucinOut, "Ovolene recipe must output Mucin");
  assert.strictEqual(mucinOut.rate, 810.0);
  assert.strictEqual(mucinOut.unit, "g/s");
  assert.strictEqual(mucinOut.state, "in a pipe");

  const ovoleneCo2Out = ovoleneEval.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.ok(ovoleneCo2Out, "Ovolene recipe must output Carbon Dioxide");
  assert.strictEqual(ovoleneCo2Out.rate, 100.0);
  assert.strictEqual(ovoleneCo2Out.unit, "g/s");
  assert.strictEqual(ovoleneCo2Out.state, "free");
  assert.strictEqual(ovoleneCo2Out.tempC, 75.0);

  // Caviar element metadata verification
  assert.ok(elementMap.has("Caviar"), "elementMap must have Caviar metadata");
  const caviarElem = elementMap.get("Caviar");
  assert.strictEqual(caviarElem.state, "Solid");

  // URL state round-trip with Gleaner and ovolene recipe
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "brackwax_gleaner", qty: 3, recipeId: "ovolene", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "brackwax_gleaner");
  assert.strictEqual(decoded.rows[0].qty, 3);
  assert.strictEqual(decoded.rows[0].recipeId, "ovolene");

  console.log("✓ Gleaner Building and Recipes tests passed");
}

// 14. Glass Forge Building and Recipe Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const glassForge = entityMap.get("glass_forge");
  assert.ok(glassForge, "glass_forge entity must exist");
  assert.strictEqual(glassForge.name, "Glass Forge");
  assert.strictEqual(glassForge.category, "Machine");
  assert.strictEqual(glassForge.subcategory, "Refinement");
  assert.strictEqual(glassForge.recipes.length, 1);
  assert.strictEqual(glassForge.recipes[0].id, "molten_glass");

  // Default evaluation (Sand -> Molten Glass)
  const defaultEval = evaluateRow({ entityId: "glass_forge", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -1200.0);
  assert.strictEqual(defaultEval.heat, 16.0);
  assert.strictEqual(defaultEval.inputs.length, 2);
  assert.strictEqual(defaultEval.outputs.length, 1);

  const sandIn = defaultEval.inputs.find((i) => i.resource === "Sand");
  assert.ok(sandIn, "Glass Forge default must consume Sand");
  assert.strictEqual(sandIn.rate, 2500.0);
  assert.strictEqual(sandIn.unit, "g/s");
  assert.strictEqual(sandIn.state, "free");

  const laborIn = defaultEval.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.ok(laborIn, "Glass Forge default must require Duplicant Labor");
  assert.strictEqual(laborIn.rate, 1.0);
  assert.strictEqual(laborIn.unit, "s/s");
  assert.strictEqual(laborIn.state, "labor");

  const moltenGlassOut = defaultEval.outputs.find((o) => o.resource === "Molten Glass");
  assert.ok(moltenGlassOut, "Glass Forge default must output Molten Glass");
  assert.strictEqual(moltenGlassOut.rate, 625.0);
  assert.strictEqual(moltenGlassOut.unit, "g/s");
  assert.strictEqual(moltenGlassOut.state, "in a pipe");
  assert.strictEqual(moltenGlassOut.tempC, 1750.0);

  // Explicit recipe: molten_glass with qty: 2
  const explicitEval = evaluateRow({ entityId: "glass_forge", qty: 2, recipeId: "molten_glass" }, entityMap, elementMap);
  assert.strictEqual(explicitEval.power, -2400.0);
  assert.strictEqual(explicitEval.heat, 32.0);
  assert.strictEqual(explicitEval.inputs.find((i) => i.resource === "Sand").rate, 5000.0);
  assert.strictEqual(explicitEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 2.0);
  assert.strictEqual(explicitEval.outputs.find((o) => o.resource === "Molten Glass").rate, 1250.0);
  assert.strictEqual(explicitEval.outputs.find((o) => o.resource === "Molten Glass").tempC, 1750.0);

  // URL state round-trip with Glass Forge
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "glass_forge", qty: 2, recipeId: "molten_glass", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "glass_forge");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "molten_glass");

  console.log("✓ Glass Forge Building and Recipe tests passed");
}

// 15. Bleach Stone Hopper Building and Recipe Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const hopper = entityMap.get("bleach_stone_hopper");
  assert.ok(hopper, "bleach_stone_hopper entity must exist");
  assert.strictEqual(hopper.name, "Bleach Stone Hopper");
  assert.strictEqual(hopper.category, "Machine");
  assert.strictEqual(hopper.subcategory, "Refinement");
  assert.strictEqual(hopper.recipes.length, 2);
  assert.strictEqual(hopper.recipes[0].id, "bleach_stone_gold");
  assert.strictEqual(hopper.recipes[1].id, "bleach_stone_gold_amalgam");

  // Default evaluation (Gold recipe)
  const defaultEval = evaluateRow({ entityId: "bleach_stone_hopper", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -480.0);
  assert.strictEqual(defaultEval.heat, 3.0);
  assert.strictEqual(defaultEval.inputs.length, 2);
  assert.strictEqual(defaultEval.outputs.length, 2);

  const saltIn = defaultEval.inputs.find((i) => i.resource === "Salt");
  assert.ok(saltIn, "Bleach Stone Hopper default must consume Salt");
  assert.strictEqual(saltIn.rate, 750.0);
  assert.strictEqual(saltIn.unit, "g/s");
  assert.strictEqual(saltIn.state, "free");

  const goldIn = defaultEval.inputs.find((i) => i.resource === "Gold");
  assert.ok(goldIn, "Bleach Stone Hopper default must consume Gold");
  assert.strictEqual(goldIn.rate, 12.5);
  assert.strictEqual(goldIn.unit, "g/s");
  assert.strictEqual(goldIn.state, "free");

  const bleachOut = defaultEval.outputs.find((o) => o.resource === "Bleach Stone");
  assert.ok(bleachOut, "Bleach Stone Hopper default must output Bleach Stone");
  assert.strictEqual(bleachOut.rate, 250.0);
  assert.strictEqual(bleachOut.unit, "g/s");
  assert.strictEqual(bleachOut.state, "free");

  const sandOut = defaultEval.outputs.find((o) => o.resource === "Sand");
  assert.ok(sandOut, "Bleach Stone Hopper default must output Sand");
  assert.strictEqual(sandOut.rate, 500.0);
  assert.strictEqual(sandOut.unit, "g/s");
  assert.strictEqual(sandOut.state, "free");

  // Explicit recipe: bleach_stone_gold_amalgam with qty: 2
  const amalgamEval = evaluateRow(
    { entityId: "bleach_stone_hopper", qty: 2, recipeId: "bleach_stone_gold_amalgam" },
    entityMap,
    elementMap
  );
  assert.strictEqual(amalgamEval.power, -960.0);
  assert.strictEqual(amalgamEval.heat, 6.0);
  assert.strictEqual(amalgamEval.inputs.find((i) => i.resource === "Salt").rate, 1500.0);
  const goldAmalgamIn = amalgamEval.inputs.find((i) => i.resource === "Gold Amalgam");
  assert.ok(goldAmalgamIn, "Bleach Stone Hopper amalgam recipe must consume Gold Amalgam");
  assert.strictEqual(goldAmalgamIn.rate, 25.0);
  assert.strictEqual(amalgamEval.outputs.find((o) => o.resource === "Bleach Stone").rate, 500.0);
  assert.strictEqual(amalgamEval.outputs.find((o) => o.resource === "Sand").rate, 1000.0);

  // URL state round-trip with Bleach Stone Hopper
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "bleach_stone_hopper", qty: 2, recipeId: "bleach_stone_gold_amalgam", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "bleach_stone_hopper");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "bleach_stone_gold_amalgam");

  console.log("✓ Bleach Stone Hopper Building and Recipes tests passed");
}

// 16. Molecular Forge Building and Recipe Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const forge = entityMap.get("molecular_forge");
  assert.ok(forge, "molecular_forge entity must exist");
  assert.strictEqual(forge.name, "Molecular Forge");
  assert.strictEqual(forge.category, "Machine");
  assert.strictEqual(forge.subcategory, "Refinement");
  assert.strictEqual(forge.recipes.length, 5);
  assert.strictEqual(forge.recipes[0].id, "thermium");
  assert.strictEqual(forge.recipes[1].id, "super_coolant");
  assert.strictEqual(forge.recipes[2].id, "visco_gel_fluid");
  assert.strictEqual(forge.recipes[3].id, "insulite");
  assert.strictEqual(forge.recipes[4].id, "plastium");

  assert.strictEqual(forge.outputs[0].temp, "@ 40 °C+");
  assert.strictEqual(forge.recipes[0].outputs[0].temp, "@ 40 °C+");

  // Default evaluation (thermium recipe)
  const defaultEval = evaluateRow({ entityId: "molecular_forge", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -1600.0);
  assert.strictEqual(defaultEval.heat, 16.0);
  assert.strictEqual(defaultEval.inputs.length, 3);
  assert.strictEqual(defaultEval.outputs.length, 1);

  const tungstenIn = defaultEval.inputs.find((i) => i.resource === "Tungsten");
  assert.ok(tungstenIn, "Molecular Forge default must consume Tungsten");
  assert.strictEqual(tungstenIn.rate, 1187.5);
  assert.strictEqual(tungstenIn.unit, "g/s");
  assert.strictEqual(tungstenIn.state, "free");

  const niobiumIn = defaultEval.inputs.find((i) => i.resource === "Niobium");
  assert.ok(niobiumIn, "Molecular Forge default must consume Niobium");
  assert.strictEqual(niobiumIn.rate, 62.5);
  assert.strictEqual(niobiumIn.unit, "g/s");
  assert.strictEqual(niobiumIn.state, "free");

  const laborIn = defaultEval.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.ok(laborIn, "Molecular Forge default must require Duplicant Labor");
  assert.strictEqual(laborIn.rate, 1.0);
  assert.strictEqual(laborIn.unit, "s/s");
  assert.strictEqual(laborIn.state, "labor");

  const thermiumOut = defaultEval.outputs.find((o) => o.resource === "Thermium");
  assert.ok(thermiumOut, "Molecular Forge default must output Thermium");
  assert.strictEqual(thermiumOut.rate, 1250.0);
  assert.strictEqual(thermiumOut.unit, "g/s");
  assert.strictEqual(thermiumOut.state, "free");
  assert.strictEqual(thermiumOut.tempC, 40.0);
  assert.strictEqual(thermiumOut.temp, "@ 40 °C");

  // Explicit recipe: super_coolant
  const superCoolantEval = evaluateRow(
    { entityId: "molecular_forge", qty: 1, recipeId: "super_coolant" },
    entityMap,
    elementMap
  );
  assert.strictEqual(superCoolantEval.power, -1600.0);
  assert.strictEqual(superCoolantEval.heat, 16.0);
  assert.strictEqual(superCoolantEval.inputs.find((i) => i.resource === "Fullerene").rate, 12.5);
  assert.strictEqual(superCoolantEval.inputs.find((i) => i.resource === "Gold").rate, 618.75);
  assert.strictEqual(superCoolantEval.inputs.find((i) => i.resource === "Petroleum").rate, 618.75);
  assert.strictEqual(superCoolantEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(superCoolantEval.outputs.find((o) => o.resource === "Super Coolant").rate, 1250.0);

  // Explicit recipe: visco_gel_fluid
  const viscoGelEval = evaluateRow(
    { entityId: "molecular_forge", qty: 1, recipeId: "visco_gel_fluid" },
    entityMap,
    elementMap
  );
  assert.strictEqual(viscoGelEval.power, -1600.0);
  assert.strictEqual(viscoGelEval.heat, 16.0);
  assert.strictEqual(viscoGelEval.inputs.find((i) => i.resource === "Isosap").rate, 437.5);
  assert.strictEqual(viscoGelEval.inputs.find((i) => i.resource === "Petroleum").rate, 812.5);
  assert.strictEqual(viscoGelEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(viscoGelEval.outputs.find((o) => o.resource === "Visco-Gel Fluid").rate, 1250.0);

  // Explicit recipe: insulite
  const insuliteEval = evaluateRow(
    { entityId: "molecular_forge", qty: 1, recipeId: "insulite" },
    entityMap,
    elementMap
  );
  assert.strictEqual(insuliteEval.power, -1600.0);
  assert.strictEqual(insuliteEval.heat, 16.0);
  assert.strictEqual(insuliteEval.inputs.find((i) => i.resource === "Isosap").rate, 187.5);
  assert.strictEqual(insuliteEval.inputs.find((i) => i.resource === "Abyssalite").rate, 1000.0);
  assert.strictEqual(insuliteEval.inputs.find((i) => i.resource === "Reed Fiber").rate, 62.5);
  assert.strictEqual(insuliteEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(insuliteEval.outputs.find((o) => o.resource === "Insulite").rate, 1250.0);

  // Explicit recipe: plastium with qty: 2
  const plastiumEval = evaluateRow(
    { entityId: "molecular_forge", qty: 2, recipeId: "plastium" },
    entityMap,
    elementMap
  );
  assert.strictEqual(plastiumEval.power, -3200.0);
  assert.strictEqual(plastiumEval.heat, 32.0);
  assert.strictEqual(plastiumEval.inputs.find((i) => i.resource === "Thermium").rate, 375.0);
  assert.strictEqual(plastiumEval.inputs.find((i) => i.resource === "Plastic").rate, 1750.0);
  assert.strictEqual(plastiumEval.inputs.find((i) => i.resource === "Brackwax").rate, 375.0);
  assert.strictEqual(plastiumEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 2.0);
  assert.strictEqual(plastiumEval.outputs.find((o) => o.resource === "Plastium").rate, 2500.0);

  // URL state round-trip with Molecular Forge
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "molecular_forge", qty: 2, recipeId: "plastium", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "molecular_forge");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "plastium");

  console.log("✓ Molecular Forge Building and Recipes tests passed");
}

// 17. Plant Pulverizer Building and Recipe Calculations
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const pulverizer = entityMap.get("plant_pulverizer");
  assert.ok(pulverizer, "plant_pulverizer entity must exist");
  assert.strictEqual(pulverizer.name, "Plant Pulverizer");
  assert.strictEqual(pulverizer.category, "Machine");
  assert.strictEqual(pulverizer.subcategory, "Refinement");
  assert.strictEqual(pulverizer.recipes.length, 5);
  assert.strictEqual(pulverizer.recipes[0].id, "brackene_sleet_wheat");
  assert.strictEqual(pulverizer.recipes[1].id, "brackene_nosh_bean");
  assert.strictEqual(pulverizer.recipes[2].id, "brackene_pincha_pepper");
  assert.strictEqual(pulverizer.recipes[3].id, "phyto_oil_slime");
  assert.strictEqual(pulverizer.recipes[4].id, "phyto_oil_seakomb");

  // Default evaluation (brackene_sleet_wheat recipe)
  const defaultEval = evaluateRow({ entityId: "plant_pulverizer", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, 0.0);
  assert.strictEqual(defaultEval.heat, 2.0);
  assert.strictEqual(defaultEval.inputs.length, 3);
  assert.strictEqual(defaultEval.outputs.length, 1);

  const sleetWheatIn = defaultEval.inputs.find((i) => i.resource === "Sleet Wheat Grain");
  assert.ok(sleetWheatIn, "Plant Pulverizer default must consume Sleet Wheat Grain");
  assert.strictEqual(sleetWheatIn.rate, 0.25);
  assert.strictEqual(sleetWheatIn.unit, "units/s");
  assert.strictEqual(sleetWheatIn.state, "free");

  const waterIn = defaultEval.inputs.find((i) => i.resource === "Water");
  assert.ok(waterIn, "Plant Pulverizer default must consume Water");
  assert.strictEqual(waterIn.rate, 375.0);
  assert.strictEqual(waterIn.unit, "g/s");
  assert.strictEqual(waterIn.state, "in a pipe");

  const laborIn = defaultEval.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.ok(laborIn, "Plant Pulverizer default must require Duplicant Labor");
  assert.strictEqual(laborIn.rate, 1.0);
  assert.strictEqual(laborIn.unit, "s/s");
  assert.strictEqual(laborIn.state, "labor");

  const brackeneOut = defaultEval.outputs.find((o) => o.resource === "Brackene");
  assert.ok(brackeneOut, "Plant Pulverizer default must output Brackene");
  assert.strictEqual(brackeneOut.rate, 500.0);
  assert.strictEqual(brackeneOut.unit, "g/s");
  assert.strictEqual(brackeneOut.state, "in a pipe");

  // Explicit recipe: brackene_nosh_bean
  const noshBeanEval = evaluateRow(
    { entityId: "plant_pulverizer", qty: 1, recipeId: "brackene_nosh_bean" },
    entityMap,
    elementMap
  );
  assert.strictEqual(noshBeanEval.power, 0.0);
  assert.strictEqual(noshBeanEval.heat, 2.0);
  assert.strictEqual(noshBeanEval.inputs.find((i) => i.resource === "Nosh Bean").rate, 0.05);
  assert.strictEqual(noshBeanEval.inputs.find((i) => i.resource === "Water").rate, 450.0);
  assert.strictEqual(noshBeanEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(noshBeanEval.outputs.find((o) => o.resource === "Brackene").rate, 500.0);

  // Explicit recipe: brackene_pincha_pepper
  const pinchaEval = evaluateRow(
    { entityId: "plant_pulverizer", qty: 1, recipeId: "brackene_pincha_pepper" },
    entityMap,
    elementMap
  );
  assert.strictEqual(pinchaEval.power, 0.0);
  assert.strictEqual(pinchaEval.heat, 2.0);
  assert.strictEqual(pinchaEval.inputs.find((i) => i.resource === "Pincha Peppernut").rate, 75.0);
  assert.strictEqual(pinchaEval.inputs.find((i) => i.resource === "Water").rate, 425.0);
  assert.strictEqual(pinchaEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(pinchaEval.outputs.find((o) => o.resource === "Brackene").rate, 500.0);

  // Explicit recipe: phyto_oil_slime
  const slimeEval = evaluateRow(
    { entityId: "plant_pulverizer", qty: 1, recipeId: "phyto_oil_slime" },
    entityMap,
    elementMap
  );
  assert.strictEqual(slimeEval.power, 0.0);
  assert.strictEqual(slimeEval.heat, 2.0);
  assert.strictEqual(slimeEval.inputs.find((i) => i.resource === "Slime").rate, 2500.0);
  assert.strictEqual(slimeEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(slimeEval.outputs.find((o) => o.resource === "Phyto Oil").rate, 1750.0);
  assert.strictEqual(slimeEval.outputs.find((o) => o.resource === "Dirt").rate, 750.0);

  // Explicit recipe: phyto_oil_seakomb with qty: 2
  const seakombEval = evaluateRow(
    { entityId: "plant_pulverizer", qty: 2, recipeId: "phyto_oil_seakomb" },
    entityMap,
    elementMap
  );
  assert.strictEqual(seakombEval.power, 0.0);
  assert.strictEqual(seakombEval.heat, 4.0);
  assert.strictEqual(seakombEval.inputs.find((i) => i.resource === "Seakomb Leaf").rate, 1250.0);
  assert.strictEqual(seakombEval.inputs.find((i) => i.resource === "Water").rate, 3750.0);
  assert.strictEqual(seakombEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 2.0);
  assert.strictEqual(seakombEval.outputs.find((o) => o.resource === "Phyto Oil").rate, 5000.0);

  // URL state round-trip with Plant Pulverizer
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "plant_pulverizer", qty: 2, recipeId: "phyto_oil_seakomb", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "plant_pulverizer");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "phyto_oil_seakomb");

  console.log("✓ Plant Pulverizer Building and Recipes tests passed");
}

// Thermo Regulator: Gas Cooling Recipes & Temperature Reduction
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const building = entityMap.get("thermo_regulator");
  assert.ok(building, "thermo_regulator entity must exist in catalog");
  assert.strictEqual(building.recipes.length, 5, "Thermo Regulator should have 5 recipes");

  // Default evaluation: Hydrogen recipe
  const defaultEval = evaluateRow({ entityId: "thermo_regulator", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -240.0);
  assert.strictEqual(defaultEval.heat, 33.6);
  assert.strictEqual(defaultEval.inputs.length, 1);
  assert.strictEqual(defaultEval.outputs.length, 1);

  const h2In = defaultEval.inputs.find((i) => i.resource === "Hydrogen");
  assert.ok(h2In, "Default Thermo Regulator must consume Hydrogen");
  assert.strictEqual(h2In.rate, 1000.0);
  assert.strictEqual(h2In.unit, "g/s");
  assert.strictEqual(h2In.state, "in a pipe");
  assert.strictEqual(h2In.tempC, 20.0);

  const h2Out = defaultEval.outputs.find((o) => o.resource === "Hydrogen");
  assert.ok(h2Out, "Default Thermo Regulator must output Hydrogen");
  assert.strictEqual(h2Out.rate, 1000.0);
  assert.strictEqual(h2Out.unit, "g/s");
  assert.strictEqual(h2Out.state, "in a pipe");
  assert.strictEqual(h2Out.tempC, 6.0, "Output temp should be cooled by 14 °C (20 - 14 = 6 °C)");
  assert.strictEqual(h2Out.temp, "@ 6 °C");

  // Explicit recipe: oxygen
  const oxygenEval = evaluateRow(
    { entityId: "thermo_regulator", qty: 1, recipeId: "oxygen" },
    entityMap,
    elementMap
  );
  assert.strictEqual(oxygenEval.power, -240.0);
  assert.strictEqual(oxygenEval.heat, 14.07);
  const o2In = oxygenEval.inputs.find((i) => i.resource === "Oxygen");
  const o2Out = oxygenEval.outputs.find((o) => o.resource === "Oxygen");
  assert.strictEqual(o2In.rate, 1000.0);
  assert.strictEqual(o2Out.rate, 1000.0);
  assert.strictEqual(o2Out.tempC, 6.0);

  // Explicit recipe: natural_gas
  const natGasEval = evaluateRow(
    { entityId: "thermo_regulator", qty: 1, recipeId: "natural_gas" },
    entityMap,
    elementMap
  );
  assert.strictEqual(natGasEval.power, -240.0);
  assert.strictEqual(natGasEval.heat, 30.674);
  const ngIn = natGasEval.inputs.find((i) => i.resource === "Natural Gas");
  const ngOut = natGasEval.outputs.find((o) => o.resource === "Natural Gas");
  assert.strictEqual(ngIn.rate, 1000.0);
  assert.strictEqual(ngOut.rate, 1000.0);
  assert.strictEqual(ngOut.tempC, 6.0);

  // Explicit recipe: chlorine
  const chlorineEval = evaluateRow(
    { entityId: "thermo_regulator", qty: 1, recipeId: "chlorine" },
    entityMap,
    elementMap
  );
  assert.strictEqual(chlorineEval.power, -240.0);
  assert.strictEqual(chlorineEval.heat, 6.72);
  const clIn = chlorineEval.inputs.find((i) => i.resource === "Chlorine");
  const clOut = chlorineEval.outputs.find((o) => o.resource === "Chlorine");
  assert.strictEqual(clIn.rate, 1000.0);
  assert.strictEqual(clOut.rate, 1000.0);
  assert.strictEqual(clOut.tempC, 6.0);

  // Explicit recipe: carbon_dioxide with qty: 2 and custom input temperature (30 °C -> 16 °C)
  const co2Eval = evaluateRow(
    { entityId: "thermo_regulator", qty: 2, recipeId: "carbon_dioxide" },
    entityMap,
    elementMap,
    20.0,
    { "Carbon Dioxide||in a pipe": 30.0 }
  );
  assert.strictEqual(co2Eval.power, -480.0);
  assert.strictEqual(co2Eval.heat, 23.688);
  const co2In = co2Eval.inputs.find((i) => i.resource === "Carbon Dioxide");
  const co2Out = co2Eval.outputs.find((o) => o.resource === "Carbon Dioxide");
  assert.strictEqual(co2In.rate, 2000.0);
  assert.strictEqual(co2In.tempC, 30.0);
  assert.strictEqual(co2Out.rate, 2000.0);
  assert.strictEqual(co2Out.tempC, 16.0);
  assert.strictEqual(co2Out.temp, "@ 16 °C");

  // URL state round-trip with Thermo Regulator
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "thermo_regulator", qty: 2, recipeId: "hydrogen", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "thermo_regulator");
  assert.strictEqual(decoded.rows[0].qty, 2);
  assert.strictEqual(decoded.rows[0].recipeId, "hydrogen");

  console.log("✓ Thermo Regulator Building and Recipes tests passed");
}

// Rock Crusher: Metal Ore Crushing Recipes
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const building = entityMap.get("rock_crusher");
  assert.ok(building, "rock_crusher entity must exist in catalog");
  assert.strictEqual(building.recipes.length, 9, "Rock Crusher should have 9 recipes");

  // Evaluate crushed_copper recipe
  const copperEval = evaluateRow(
    { entityId: "rock_crusher", qty: 1, recipeId: "crushed_copper" },
    entityMap,
    elementMap
  );
  assert.strictEqual(copperEval.power, -240.0);
  assert.strictEqual(copperEval.heat, 16.0);
  assert.strictEqual(copperEval.inputs.length, 2);
  assert.strictEqual(copperEval.outputs.length, 2);

  const copperOreIn = copperEval.inputs.find((i) => i.resource === "Copper Ore");
  assert.ok(copperOreIn, "crushed_copper must consume Copper Ore");
  assert.strictEqual(copperOreIn.rate, 2500.0);
  assert.strictEqual(copperOreIn.unit, "g/s");
  assert.strictEqual(copperOreIn.state, "free");

  const copperLaborIn = copperEval.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.ok(copperLaborIn, "crushed_copper must require Duplicant Labor");
  assert.strictEqual(copperLaborIn.rate, 1.0);
  assert.strictEqual(copperLaborIn.unit, "s/s");
  assert.strictEqual(copperLaborIn.state, "labor");

  const copperOut = copperEval.outputs.find((o) => o.resource === "Copper");
  assert.ok(copperOut, "crushed_copper must produce Copper");
  assert.strictEqual(copperOut.rate, 1250.0);
  assert.strictEqual(copperOut.unit, "g/s");
  assert.strictEqual(copperOut.state, "free");

  const copperSandOut = copperEval.outputs.find((o) => o.resource === "Sand");
  assert.ok(copperSandOut, "crushed_copper must produce Sand");
  assert.strictEqual(copperSandOut.rate, 1250.0);
  assert.strictEqual(copperSandOut.unit, "g/s");
  assert.strictEqual(copperSandOut.state, "free");

  // Evaluate crushed_gold recipe
  const goldEval = evaluateRow(
    { entityId: "rock_crusher", qty: 2, recipeId: "crushed_gold" },
    entityMap,
    elementMap
  );
  assert.strictEqual(goldEval.power, -480.0);
  assert.strictEqual(goldEval.heat, 32.0);
  const goldAmalgamIn = goldEval.inputs.find((i) => i.resource === "Gold Amalgam");
  assert.strictEqual(goldAmalgamIn.rate, 5000.0);
  const goldLaborIn = goldEval.inputs.find((i) => i.resource === "Duplicant Labor");
  assert.strictEqual(goldLaborIn.rate, 2.0);
  const goldOut = goldEval.outputs.find((o) => o.resource === "Gold");
  assert.strictEqual(goldOut.rate, 2500.0);
  const goldSandOut = goldEval.outputs.find((o) => o.resource === "Sand");
  assert.strictEqual(goldSandOut.rate, 2500.0);

  // Evaluate crushed_iron recipe
  const ironEval = evaluateRow(
    { entityId: "rock_crusher", qty: 1, recipeId: "crushed_iron" },
    entityMap,
    elementMap
  );
  assert.strictEqual(ironEval.power, -240.0);
  assert.strictEqual(ironEval.heat, 16.0);
  assert.strictEqual(ironEval.inputs.find((i) => i.resource === "Iron Ore").rate, 2500.0);
  assert.strictEqual(ironEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(ironEval.outputs.find((o) => o.resource === "Iron").rate, 1250.0);
  assert.strictEqual(ironEval.outputs.find((o) => o.resource === "Sand").rate, 1250.0);

  // Evaluate crushed_aluminum recipe
  const aluminumEval = evaluateRow(
    { entityId: "rock_crusher", qty: 1, recipeId: "crushed_aluminum" },
    entityMap,
    elementMap
  );
  assert.strictEqual(aluminumEval.power, -240.0);
  assert.strictEqual(aluminumEval.heat, 16.0);
  assert.strictEqual(aluminumEval.inputs.find((i) => i.resource === "Aluminum Ore").rate, 2500.0);
  assert.strictEqual(aluminumEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(aluminumEval.outputs.find((o) => o.resource === "Aluminum").rate, 1250.0);
  assert.strictEqual(aluminumEval.outputs.find((o) => o.resource === "Sand").rate, 1250.0);

  // Evaluate crushed_tungsten recipe
  const tungstenEval = evaluateRow(
    { entityId: "rock_crusher", qty: 1, recipeId: "crushed_tungsten" },
    entityMap,
    elementMap
  );
  assert.strictEqual(tungstenEval.power, -240.0);
  assert.strictEqual(tungstenEval.heat, 16.0);
  assert.strictEqual(tungstenEval.inputs.find((i) => i.resource === "Wolframite").rate, 2500.0);
  assert.strictEqual(tungstenEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
  assert.strictEqual(tungstenEval.outputs.find((o) => o.resource === "Tungsten").rate, 1250.0);
  assert.strictEqual(tungstenEval.outputs.find((o) => o.resource === "Sand").rate, 1250.0);

  // URL state round-trip with Rock Crusher recipes
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "rock_crusher", qty: 1, recipeId: "crushed_copper", modifiers: [] },
      { entityId: "rock_crusher", qty: 2, recipeId: "crushed_tungsten", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 2);
  assert.strictEqual(decoded.rows[0].entityId, "rock_crusher");
  assert.strictEqual(decoded.rows[0].recipeId, "crushed_copper");
  assert.strictEqual(decoded.rows[1].entityId, "rock_crusher");
  assert.strictEqual(decoded.rows[1].qty, 2);
  assert.strictEqual(decoded.rows[1].recipeId, "crushed_tungsten");

  console.log("✓ Rock Crusher Building and Recipes tests passed");
}

// Metal Refinery: Metal Ore Refining Recipes
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const building = entityMap.get("metal_refinery");
  assert.ok(building, "metal_refinery entity must exist in catalog");
  assert.strictEqual(building.recipes.length, 7, "Metal Refinery should have 7 recipes");

  // Evaluate aluminum recipe
  const aluminumEval = evaluateRow(
    { entityId: "metal_refinery", qty: 1, recipeId: "aluminum" },
    entityMap,
    elementMap
  );
  assert.strictEqual(aluminumEval.power, -1200.0);
  assert.strictEqual(aluminumEval.heat, 16.0);
  assert.strictEqual(aluminumEval.inputs.length, 1);
  assert.strictEqual(aluminumEval.outputs.length, 1);
  const alIn = aluminumEval.inputs.find((i) => i.resource === "Aluminum Ore");
  assert.ok(alIn, "aluminum recipe must consume Aluminum Ore");
  assert.strictEqual(alIn.rate, 2500.0);
  assert.strictEqual(alIn.unit, "g/s");
  assert.strictEqual(alIn.state, "free");
  const alOut = aluminumEval.outputs.find((o) => o.resource === "Aluminum");
  assert.ok(alOut, "aluminum recipe must produce Aluminum");
  assert.strictEqual(alOut.rate, 2500.0);
  assert.strictEqual(alOut.unit, "g/s");
  assert.strictEqual(alOut.state, "free");
  assert.strictEqual(alOut.temp, "@ 40 °C");

  // Evaluate cobalt recipe
  const cobaltEval = evaluateRow(
    { entityId: "metal_refinery", qty: 2, recipeId: "cobalt" },
    entityMap,
    elementMap
  );
  assert.strictEqual(cobaltEval.power, -2400.0);
  assert.strictEqual(cobaltEval.heat, 32.0);
  assert.strictEqual(cobaltEval.inputs.length, 1);
  assert.strictEqual(cobaltEval.outputs.length, 1);
  const coIn = cobaltEval.inputs.find((i) => i.resource === "Cobalt Ore");
  assert.ok(coIn, "cobalt recipe must consume Cobalt Ore");
  assert.strictEqual(coIn.rate, 5000.0);
  assert.strictEqual(coIn.unit, "g/s");
  assert.strictEqual(coIn.state, "free");
  const coOut = cobaltEval.outputs.find((o) => o.resource === "Cobalt");
  assert.ok(coOut, "cobalt recipe must produce Cobalt");
  assert.strictEqual(coOut.rate, 5000.0);
  assert.strictEqual(coOut.unit, "g/s");
  assert.strictEqual(coOut.state, "free");
  assert.strictEqual(coOut.temp, "@ 40 °C");

  // Evaluate tungsten recipe
  const tungstenEval = evaluateRow(
    { entityId: "metal_refinery", qty: 1, recipeId: "tungsten" },
    entityMap,
    elementMap
  );
  assert.strictEqual(tungstenEval.power, -1200.0);
  assert.strictEqual(tungstenEval.heat, 16.0);
  assert.strictEqual(tungstenEval.inputs.length, 1);
  assert.strictEqual(tungstenEval.outputs.length, 1);
  const tuIn = tungstenEval.inputs.find((i) => i.resource === "Wolframite");
  assert.ok(tuIn, "tungsten recipe must consume Wolframite");
  assert.strictEqual(tuIn.rate, 2500.0);
  assert.strictEqual(tuIn.unit, "g/s");
  assert.strictEqual(tuIn.state, "free");
  const tuOut = tungstenEval.outputs.find((o) => o.resource === "Tungsten");
  assert.ok(tuOut, "tungsten recipe must produce Tungsten");
  assert.strictEqual(tuOut.rate, 2500.0);
  assert.strictEqual(tuOut.unit, "g/s");
  assert.strictEqual(tuOut.state, "free");
  assert.strictEqual(tuOut.temp, "@ 40 °C");

  // URL state round-trip with Metal Refinery recipes
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "metal_refinery", qty: 1, recipeId: "aluminum", modifiers: [] },
      { entityId: "metal_refinery", qty: 2, recipeId: "cobalt", modifiers: [] },
      { entityId: "metal_refinery", qty: 3, recipeId: "tungsten", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 3);
  assert.strictEqual(decoded.rows[0].entityId, "metal_refinery");
  assert.strictEqual(decoded.rows[0].recipeId, "aluminum");
  assert.strictEqual(decoded.rows[0].qty, 1);
  assert.strictEqual(decoded.rows[1].entityId, "metal_refinery");
  assert.strictEqual(decoded.rows[1].recipeId, "cobalt");
  assert.strictEqual(decoded.rows[1].qty, 2);
  assert.strictEqual(decoded.rows[2].entityId, "metal_refinery");
  assert.strictEqual(decoded.rows[2].recipeId, "tungsten");
  assert.strictEqual(decoded.rows[2].qty, 3);

  console.log("✓ Metal Refinery Building and Recipes tests passed");
}

// Ice Maker: Water freezing recipe & negative output temperature
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);
  const building = entityMap.get("ice_maker");
  assert.ok(building, "ice_maker entity must exist in catalog");
  assert.strictEqual(building.power, -60.0);
  assert.strictEqual(building.heat, 16.0);
  assert.strictEqual(building.recipes.length, 1, "Ice Maker should have 1 recipe");

  // Default evaluation
  const defaultEval = evaluateRow({ entityId: "ice_maker", qty: 1 }, entityMap, elementMap);
  assert.strictEqual(defaultEval.power, -60.0);
  assert.strictEqual(defaultEval.heat, 16.0);
  assert.strictEqual(defaultEval.inputs.length, 1);
  assert.strictEqual(defaultEval.outputs.length, 1);

  const waterIn = defaultEval.inputs.find((i) => i.resource === "Water");
  assert.ok(waterIn, "Default Ice Maker must consume Water");
  assert.strictEqual(waterIn.rate, 500.0);
  assert.strictEqual(waterIn.unit, "g/s");
  assert.strictEqual(waterIn.state, "free");

  const iceOut = defaultEval.outputs.find((o) => o.resource === "Ice");
  assert.ok(iceOut, "Default Ice Maker must output Ice");
  assert.strictEqual(iceOut.rate, 500.0);
  assert.strictEqual(iceOut.unit, "g/s");
  assert.strictEqual(iceOut.state, "free");
  assert.strictEqual(iceOut.tempC, -20.0, "Ice output temperature must be -20 °C");
  assert.strictEqual(iceOut.temp, "@ -20 °C");

  // Explicit recipe evaluation with qty: 3 scaling
  const scaledEval = evaluateRow(
    { entityId: "ice_maker", qty: 3, recipeId: "ice" },
    entityMap,
    elementMap
  );
  assert.strictEqual(scaledEval.power, -180.0);
  assert.strictEqual(scaledEval.heat, 48.0);
  assert.strictEqual(scaledEval.inputs.length, 1);
  assert.strictEqual(scaledEval.outputs.length, 1);

  const scaledWaterIn = scaledEval.inputs.find((i) => i.resource === "Water");
  assert.ok(scaledWaterIn);
  assert.strictEqual(scaledWaterIn.rate, 1500.0);
  assert.strictEqual(scaledWaterIn.unit, "g/s");
  assert.strictEqual(scaledWaterIn.state, "free");

  const scaledIceOut = scaledEval.outputs.find((o) => o.resource === "Ice");
  assert.ok(scaledIceOut);
  assert.strictEqual(scaledIceOut.rate, 1500.0);
  assert.strictEqual(scaledIceOut.unit, "g/s");
  assert.strictEqual(scaledIceOut.state, "free");
  assert.strictEqual(scaledIceOut.tempC, -20.0);
  assert.strictEqual(scaledIceOut.temp, "@ -20 °C");

  // URL state round-trip with Ice Maker
  const urlState = {
    rateMode: "s",
    rows: [
      { entityId: "ice_maker", qty: 3, recipeId: "ice", modifiers: [] }
    ],
    netInputTemps: {}
  };
  const encoded = encodeStateToParam(urlState);
  const decoded = decodeStateFromParam(encoded);
  assert.strictEqual(decoded.rows.length, 1);
  assert.strictEqual(decoded.rows[0].entityId, "ice_maker");
  assert.strictEqual(decoded.rows[0].qty, 3);
  assert.strictEqual(decoded.rows[0].recipeId, "ice");

  console.log("✓ Ice Maker Building and Recipes tests passed");
}

// 21. Closed Loop Matching, Unrounded Match Precision, and Thermal Isolation
{
  const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

  // A. Match Button HTML uses full-precision targetQty in data-target-qty
  const targetFloat = 8.571183680466273;
  const mockMatches = {
    "out:Coal||free": { targetQty: targetFloat, isMatched: false }
  };
  const testRow = { entityId: "critter_stone_hatch", qty: 1, recipeId: "igneous_rock" };
  const evaluatedTestRow = evaluateRow(testRow, entityMap, elementMap);
  const matchHtml = renderTableRowHtml(testRow, evaluatedTestRow, elementMap, "s", 0, mockMatches);
  assert.ok(matchHtml.includes(`data-target-qty="${targetFloat}"`), "Match button must embed full unrounded float in data-target-qty");
  assert.ok(matchHtml.includes("[match: 8.5712×]"), "Match button display text should still show cleanly formatted 4-decimal quantity");

  // B. Carbon Skimmer output temperature pass-through: Polluted Water output adopts Water input temperature
  // Carbon Skimmer with Water @ 20 °C and Carbon Dioxide @ 110 °C
  const csRow = { entityId: "carbon_skimmer", qty: 1 };
  const csInputsWithTemps = {
    "Water||in a pipe": 20.0,
    "Carbon Dioxide||in a pipe": 110.0,
  };
  const csEval = evaluateRow(csRow, entityMap, elementMap, 20.0, csInputsWithTemps);
  const pwOut = csEval.outputs.find((o) => o.resource === "Polluted Water");
  assert.ok(pwOut, "Carbon skimmer must output Polluted Water");
  assert.strictEqual(pwOut.tempC, 20.0, "Carbon skimmer Polluted Water output temp must inherit Water inlet temp (20 °C), not blend 110 °C CO2");
  assert.strictEqual(pwOut.temp, "@ 20 °C");

  // C. End-to-end Closed Loop Matching and Thermal Stability (User Scenario: Hatch + Coal Gen + Grill + Dupes + Skimmer + Pump + Sieve)
  const loopRows = [
    { entityId: "critter_stone_hatch", qty: 1, recipeId: "igneous_rock", modifiers: [], food: "calories" },
    { entityId: "coal_generator", qty: 1, recipeId: null, modifiers: [], food: "calories" },
    { entityId: "electric_grill", qty: 1, recipeId: "barbecue", modifiers: [], food: "calories" },
    { entityId: "duplicant", qty: 1, recipeId: null, modifiers: [], bathroom: "none", food: "barbecue" },
    { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [], food: "calories" },
    { entityId: "gas_pump", qty: 1, recipeId: "carbon_dioxide", modifiers: [], food: "calories" },
    { entityId: "water_sieve", qty: 1, recipeId: "sand", modifiers: [], food: "calories" },
  ];

  // Match 1: Hatch coal to Coal Generator (1.0x coal generator -> 1000 g/s coal)
  const t0 = calculateRowMatchTargets(0, loopRows, entityMap);
  assert.ok(t0["out:Coal||free"], "Hatch should have out:Coal match target");
  loopRows[0].qty = t0["out:Coal||free"].targetQty;

  // Match 2: Electric Grill to Hatch meat
  const t2 = calculateRowMatchTargets(2, loopRows, entityMap);
  assert.ok(t2["in:Meat||free"], "Electric Grill should have in:Meat match target");
  loopRows[2].qty = t2["in:Meat||free"].targetQty;

  // Match 3: Duplicants to Grill barbecue
  const t3 = calculateRowMatchTargets(3, loopRows, entityMap);
  assert.ok(t3["in:Barbecue||free"], "Duplicants should have in:Barbecue match target");
  loopRows[3].qty = t3["in:Barbecue||free"].targetQty;

  // Match 4: Gas Pump to Coal Gen + Dupe CO2 (free)
  const t5 = calculateRowMatchTargets(5, loopRows, entityMap);
  assert.ok(t5["in:Carbon Dioxide||free"], "Gas Pump should have in:Carbon Dioxide match target");
  loopRows[5].qty = t5["in:Carbon Dioxide||free"].targetQty;

  // Match 5: Carbon Skimmer to piped CO2
  const t4 = calculateRowMatchTargets(4, loopRows, entityMap);
  assert.ok(t4["in:Carbon Dioxide||in a pipe"], "Carbon Skimmer should have in:Carbon Dioxide match target");
  loopRows[4].qty = t4["in:Carbon Dioxide||in a pipe"].targetQty;

  // Match 6: Water Sieve to Polluted Water from Carbon Skimmer
  const t6 = calculateRowMatchTargets(6, loopRows, entityMap);
  assert.ok(t6["in:Polluted Water||in a pipe"], "Water Sieve should have in:Polluted Water match target");
  loopRows[6].qty = t6["in:Polluted Water||in a pipe"].targetQty;

  // Evaluate thermal propagation and system net
  const evaluatedLoop = resolveTableTemperatures(loopRows, entityMap, elementMap);
  const netLoop = calculateSystemNet(evaluatedLoop);

  // Intermediate resources (Coal, Meat, Barbecue, Carbon Dioxide, Water, Polluted Water) must be 100% matched with 0 net residue
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Coal"), undefined, "Coal must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Coal"), undefined, "Coal must not appear in net outputs");
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Meat"), undefined, "Meat must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Meat"), undefined, "Meat must not appear in net outputs");
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Barbecue"), undefined, "Barbecue must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Barbecue"), undefined, "Barbecue must not appear in net outputs");
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Carbon Dioxide"), undefined, "Carbon Dioxide must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Carbon Dioxide"), undefined, "Carbon Dioxide must not appear in net outputs");
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Water"), undefined, "Water must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Water"), undefined, "Water must not appear in net outputs");
  assert.strictEqual(netLoop.netInputs.find((i) => i.resource === "Polluted Water"), undefined, "Polluted Water must not appear in net inputs");
  assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === "Polluted Water"), undefined, "Polluted Water must not appear in net outputs");

  // Check that all match targets in the closed loop report isMatched: true
  const finalMatches0 = calculateRowMatchTargets(0, loopRows, entityMap);
  assert.strictEqual(finalMatches0["out:Coal||free"].isMatched, true);
  assert.strictEqual(finalMatches0["out:Meat||free"].isMatched, true);

  const finalMatches1 = calculateRowMatchTargets(1, loopRows, entityMap);
  assert.strictEqual(finalMatches1["in:Coal||free"].isMatched, true);
  assert.strictEqual(finalMatches1["out:Carbon Dioxide||free"].isMatched, true);

  const finalMatches2 = calculateRowMatchTargets(2, loopRows, entityMap);
  assert.strictEqual(finalMatches2["in:Meat||free"].isMatched, true);
  assert.strictEqual(finalMatches2["out:Barbecue||free"].isMatched, true);

  const finalMatches3 = calculateRowMatchTargets(3, loopRows, entityMap);
  assert.strictEqual(finalMatches3["in:Barbecue||free"].isMatched, true);
  assert.strictEqual(finalMatches3["out:Carbon Dioxide||free"].isMatched, true);

  const finalMatches4 = calculateRowMatchTargets(4, loopRows, entityMap);
  assert.strictEqual(finalMatches4["in:Water||in a pipe"].isMatched, true);
  assert.strictEqual(finalMatches4["in:Carbon Dioxide||in a pipe"].isMatched, true);
  assert.strictEqual(finalMatches4["out:Polluted Water||in a pipe"].isMatched, true);

  const finalMatches5 = calculateRowMatchTargets(5, loopRows, entityMap);
  assert.strictEqual(finalMatches5["in:Carbon Dioxide||free"].isMatched, true);
  assert.strictEqual(finalMatches5["out:Carbon Dioxide||in a pipe"].isMatched, true);

  const finalMatches6 = calculateRowMatchTargets(6, loopRows, entityMap);
  assert.strictEqual(finalMatches6["in:Polluted Water||in a pipe"].isMatched, true);
  assert.strictEqual(finalMatches6["out:Water||in a pipe"].isMatched, true);

  // Water loop thermal temperature must remain stable at 20 °C
  const csWaterIn = evaluatedLoop[4].inputs.find((i) => i.resource === "Water");
  const csPwOut = evaluatedLoop[4].outputs.find((o) => o.resource === "Polluted Water");
  const wsPwIn = evaluatedLoop[6].inputs.find((i) => i.resource === "Polluted Water");
  const wsWaterOut = evaluatedLoop[6].outputs.find((o) => o.resource === "Water");
  assert.strictEqual(Math.round(csWaterIn.tempC * 10) / 10, 20.0, "Water loop feed into Carbon Skimmer must be 20 °C");
  assert.strictEqual(Math.round(csPwOut.tempC * 10) / 10, 20.0, "Polluted Water output from Carbon Skimmer must be 20 °C");
  assert.strictEqual(Math.round(wsPwIn.tempC * 10) / 10, 20.0, "Polluted Water feed into Water Sieve must be 20 °C");
  assert.strictEqual(Math.round(wsWaterOut.tempC * 10) / 10, 20.0, "Water output from Water Sieve must be 20 °C");

  console.log("✓ Closed Loop Matching, Unrounded Match Precision, and Thermal Isolation tests passed");
}

console.log("\n ALL JAVASCRIPT MODULE TESTS PASSED SUCCESSFULLY! \n");
