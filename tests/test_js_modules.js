/**
 * Unit test suite for JavaScript modules in src/.
 * Run with: node tests/test_js_modules.js
 */

import assert from "node:assert";
import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  calculateSystemNet,
  calculateRowMatchTargets,
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

  assert.strictEqual(net.netOutputs.length, 1);
  const oxygenOut = net.netOutputs.find((o) => o.resource === "Oxygen");
  assert.strictEqual(oxygenOut.rate, 88);
  assert.strictEqual(oxygenOut.state, "free");

  // Check match targets for Gas Pump (index 2)
  const matches = calculateRowMatchTargets(2, hydra.rows, entityMap);
  assert.strictEqual(matches["in:Hydrogen||free"].isMatched, true);
  assert.strictEqual(matches["in:Hydrogen||free"].targetQty, 0.224);
  assert.strictEqual(matches["out:Hydrogen||in a pipe"].isMatched, true);

  console.log("✓ Calculator & Math Engine tests passed");
}

// 3. URL State Serialization
{
  const rowStr = encodeRow({
    entityId: "petroleum_generator",
    recipeId: "ethanol",
    qty: 2,
    modifiers: ["mod_a", "mod_b"],
    inputTemp: 25,
  });
  assert.strictEqual(rowStr, "petroleum_generator:ethanol*2@25+mod_a,mod_b");

  const decodedRow = decodeRow(rowStr);
  assert.strictEqual(decodedRow.entityId, "petroleum_generator");
  assert.strictEqual(decodedRow.recipeId, "ethanol");
  assert.strictEqual(decodedRow.qty, 2);
  assert.strictEqual(decodedRow.inputTemp, 25);
  assert.deepStrictEqual(decodedRow.modifiers, ["mod_a", "mod_b"]);

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
  };

  const param = encodeStateToParam(state);
  assert.strictEqual(
    param,
    "u:s_r:electrolyzer~water_pump:water*0.1~gas_pump:hydrogen*0.224~hydrogen_generator*1.12~duplicant*8+divers_lungs"
  );

  const decodedState = decodeStateFromParam(param);
  assert.strictEqual(decodedState.rateMode, "s");
  assert.strictEqual(decodedState.strictPipeMatching, true);
  assert.strictEqual(decodedState.rows.length, 5);
  assert.strictEqual(decodedState.rows[2].qty, 0.224);
  assert.deepStrictEqual(decodedState.rows[4].modifiers, ["divers_lungs"]);

  // Decoding with explicit p:0
  const decodedP0 = decodeStateFromParam("u:s_p:0_r:electrolyzer~duplicant*8");
  assert.strictEqual(decodedP0.strictPipeMatching, false);
  assert.strictEqual(decodedP0.rows.length, 2);

  console.log("✓ URL State Serialization tests passed");
}

// 4. Presets
{
  assert.ok(PRESETS.length >= 5, "Should have at least 5 presets defined");
  const hydra = getPresetById("hydra_spom");
  assert.strictEqual(hydra.name, "Hydra SPOM (PDF Example)");
  assert.strictEqual(hydra.rows.length, 5);
  assert.strictEqual(hydra.strictPipeMatching, true);

  for (const preset of PRESETS) {
    assert.strictEqual(preset.strictPipeMatching, true, `${preset.name} should have strictPipeMatching: true`);
  }

  console.log("✓ Presets tests passed");
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
  assert.ok(rowHtml.includes("Water: -1000 g/s"), "Row HTML should include Water input stream");
  assert.ok(rowHtml.includes("Power: -120 W"), "Row HTML should include Power input stream");

  const net = calculateSystemNet([evaluated], { strictPipeMatching: true });
  const netHtml = renderNetSummaryRowHtml(net, elementMap, "s");
  assert.ok(netHtml.includes("NET"), "NET row HTML should include NET badge");
  assert.ok(netHtml.includes("Oxygen: +888 g/s"), "NET row HTML should include Oxygen stream");

  console.log("✓ Component HTML Rendering tests passed");
}

console.log("\n ALL JAVASCRIPT MODULE TESTS PASSED SUCCESSFULLY! \n");
