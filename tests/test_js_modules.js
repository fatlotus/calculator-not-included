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

  // URL State encoding/decoding of bathroom options
  const rowFloor = { entityId: "duplicant", qty: 2, recipeId: null, modifiers: [], bathroom: "floor" };
  const paramFloor = encodeStateToParam({ rateMode: "s", rows: [rowFloor] });
  const decodedStateFloor = decodeStateFromParam(paramFloor);
  assert.strictEqual(decodedStateFloor.rows.length, 1);
  assert.strictEqual(decodedStateFloor.rows[0].entityId, "duplicant");
  assert.strictEqual(decodedStateFloor.rows[0].qty, 2);
  assert.strictEqual(decodedStateFloor.rows[0].bathroom, "floor");

  // HTML rendering contains bathroom selector for duplicants
  const html = renderTableRowHtml(rowFloor, floorRow, elementMap, "s", 0, {});
  assert.ok(html.includes('class="bathroom-select"'), "HTML must render bathroom-select");
  assert.ok(html.includes('value="floor" selected'), "HTML must select floor option");
  assert.ok(html.includes('class="food-select"'), "HTML must render food-select");

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
