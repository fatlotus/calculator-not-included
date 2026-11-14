/**
 * Tier 4: Real-World ONI Application Scenarios E2E Tests.
 * Minimum requirement: >= 6 realistic multi-row ONI scenarios end-to-end.
 * Uses exclusively public entry points and Interface Contracts from PROJECT.md.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTableTemperatures,
  calculateRowMatchTargets,
  calculateSystemNet,
  SECONDS_PER_CYCLE,
} from "../../src/calculator.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
} from "../../src/url_state.js";
import { renderStateToText } from "../../src/text_renderer.js";
import { renderTableRowHtml } from "../../src/components/table_row.js";
import {
  getCatalog,
  makeRow,
  makeEmissionRow,
  assertClose,
  requireEmissionRecipe,
  runCli,
} from "./helpers.js";

describe("Tier 4: Real-World ONI Scenarios", () => {
  it("Scenario 1: Polluted Water off-gassing + Deodorizer chain", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_water");

    const state = {
      rateMode: "s",
      rows: [
        makeEmissionRow("emit_polluted_water", 100),
        makeRow("deodorizer", 1),
      ],
    };

    const evaluated = resolveTableTemperatures(state.rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });

    const po2 = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Polluted Oxygen"
    );
    assert.equal(po2, undefined, "Polluted Oxygen should cancel completely");

    const o2Out = net.netOutputs.find((s) => s.resource === "Oxygen");
    const clayOut = net.netOutputs.find((s) => s.resource === "Clay");
    assert.ok(o2Out, "Expected Oxygen net output");
    assert.ok(clayOut, "Expected Clay net output");
    assertClose(o2Out.rate, 90, 1e-3);
    assertClose(clayOut.rate, 143.33, 1e-2);

    const param = encodeStateToParam(state, elementMap);
    const jsonRes = runCli([param, "--json"]);
    assert.equal(jsonRes.status, 0, `CLI --json failed: ${jsonRes.stderr}`);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.ok(parsed.netData.net.netOutputs.some((o) => o.resource === "Oxygen"));
  });

  it("Scenario 2: Bleach Stone Chlorine disinfection room in /cycle mode + URL + CLI", () => {
    const catalog = getCatalog();
    const { entityMap, elementMap } = catalog;
    requireEmissionRecipe("emit_bleach_stone");

    const state = {
      rateMode: "c",
      rows: [makeEmissionRow("emit_bleach_stone", 5)],
    };

    const param = encodeStateToParam(state, elementMap);
    const decoded = decodeStateFromParam(param);
    assert.equal(decoded.rateMode, "c");

    const evaluated = resolveTableTemperatures(decoded.rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });
    const clOut = net.netOutputs.find((s) => s.resource === "Chlorine");
    assert.ok(clOut, "Expected Chlorine net output");
    assertClose(clOut.rate * SECONDS_PER_CYCLE, 3000, 1e-4);

    const text = renderStateToText(decoded, { catalog });
    assert.ok(text.includes("3 Kg/cycle"), `Expected '3 Kg/cycle' in text:\n${text}`);

    const cliRes = runCli([param]);
    assert.equal(cliRes.status, 0, `CLI failed: ${cliRes.stderr}`);
    assert.ok(cliRes.stdout.includes("Chlorine"));
    assert.ok(cliRes.stdout.includes("/cycle"));
  });

  it("Scenario 3: Oxylite early-game oxygenation matched to 3 Duplicants", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_oxylite");

    const rows = [
      makeEmissionRow("emit_oxylite", 300),
      makeRow("duplicant", 3),
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const matches = calculateRowMatchTargets(0, rows, entityMap, {
      elementMap,
      evaluatedRows: evaluated,
    });
    const o2Match = matches["out:Oxygen||free"];
    assert.ok(o2Match, "Expected Oxygen match target on Oxylite emission");
    assertClose(o2Match.targetQty, 300, 1e-4);
    assert.equal(o2Match.isMatched, true, "Expected 300x Oxylite to be matched to 3 Duplicants");

    const net = calculateSystemNet(evaluated, { elementMap });
    const o2Net = [...net.netInputs, ...net.netOutputs].find((s) => s.resource === "Oxygen");
    assert.equal(o2Net, undefined, "Expected Oxygen to cancel completely");
    assert.ok(net.netOutputs.some((s) => s.resource === "Carbon Dioxide"));
  });

  it("Scenario 4: Multi-source Polluted Oxygen recovery (Polluted Dirt + Slime + Rot Pile)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");
    requireEmissionRecipe("emit_slime");
    requireEmissionRecipe("emit_rot_pile");

    const rows = [
      makeEmissionRow("emit_polluted_dirt", 50),
      makeEmissionRow("emit_slime", 30),
      makeEmissionRow("emit_rot_pile", 20),
      makeRow("deodorizer", 1),
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });

    const po2Net = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Polluted Oxygen"
    );
    assert.equal(po2Net, undefined, "Expected 50+30+20=100 g/s Polluted Oxygen to cancel completely");

    const o2Out = net.netOutputs.find((s) => s.resource === "Oxygen");
    assert.ok(o2Out);
    assertClose(o2Out.rate, 90, 1e-3);

    const html0 = renderTableRowHtml(rows[0], evaluated[0], elementMap, "s", 0, {}, 4, []);
    const html2 = renderTableRowHtml(rows[2], evaluated[2], elementMap, "s", 2, {}, 4, []);
    assert.ok(html0.includes("Polluted Dirt"));
    assert.ok(html2.includes("Rot Pile"));
  });

  it("Scenario 5: Elevated-temperature Polluted Mud emission feeding Deodorizer & Duplicant", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_mud");

    const rows = [
      makeEmissionRow("emit_polluted_mud", 100),
      makeRow("deodorizer", 1),
      makeRow("duplicant", 0.9),
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
      netInputTemps: { "Polluted Mud||free": 85, "Sand||free": 85 },
    });

    assertClose(evaluated[0].outputs[0].tempC, 85, 1e-4, "Emission Polluted Oxygen temp");
    assertClose(evaluated[1].outputs[0].tempC, 85, 1e-4, "Deodorizer Oxygen temp");
    assertClose(evaluated[2].inputs[0].tempC, 85, 1e-4, "Duplicant Oxygen inlet temp");

    const net = calculateSystemNet(evaluated, { elementMap });
    const o2Net = [...net.netInputs, ...net.netOutputs].find((s) => s.resource === "Oxygen");
    assert.equal(o2Net, undefined, "Expected 90 g/s Oxygen to cancel completely");
  });

  it("Scenario 6: Water Sieve Polluted Dirt siphoning via Emission + Deodorizer", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");

    const state = {
      rateMode: "s",
      rows: [
        makeRow("water_sieve", 1), // outputs 200 g/s Polluted Dirt
        makeEmissionRow("emit_polluted_dirt", 200),
        makeRow("deodorizer", 2), // consumes 200 g/s Polluted Oxygen
      ],
    };

    const evaluated = resolveTableTemperatures(state.rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });

    const pDirtNet = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Polluted Dirt"
    );
    const po2Net = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Polluted Oxygen"
    );
    assert.equal(pDirtNet, undefined, "Expected Polluted Dirt to cancel completely");
    assert.equal(po2Net, undefined, "Expected Polluted Oxygen to cancel completely");

    const o2Out = net.netOutputs.find((s) => s.resource === "Oxygen");
    assert.ok(o2Out);
    assertClose(o2Out.rate, 180, 1e-3);

    const param = encodeStateToParam(state, elementMap);
    const decoded = decodeStateFromParam(param);
    assert.equal(decoded.rows.length, 3);
    assert.equal(decoded.rows[1].recipeId, "emit_polluted_dirt");

    const cliRes = runCli([param, "--no-header"]);
    assert.equal(cliRes.status, 0, `CLI failed: ${cliRes.stderr}`);
    assert.ok(cliRes.stdout.includes("Water Sieve"));
    assert.ok(cliRes.stdout.includes("Emission"));
    assert.ok(cliRes.stdout.includes("Deodorizer"));
  });
});
