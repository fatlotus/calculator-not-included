/**
 * Tier 5: Adversarial Hardening E2E Tests.
 * Covers edge cases, thermal/phase-change chains, loops, match targets, CLI modes,
 * search ranking, Protobuf schema parity & fuzzing, and UI component rendering.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  evaluateRow,
  applyHeatAndPhaseChange,
  resolveTableTemperatures,
  calculateRowMatchTargets,
  calculateSystemNet,
} from "../../src/calculator.js";
import { searchEntities } from "../../src/data_loader.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
  encodeStateToProtobuf,
  decodeStateFromProtobuf,
  uint8ArrayToUrlSafeBase64,
} from "../../src/url_state.js";
import {
  PROTO_SCHEMA,
  ENTITY_TO_ENUM,
  RECIPE_TO_ENUM,
  ELEMENT_TO_ENUM,
  CalculatorStateType,
  RowStateType,
  LoopedStreamType,
} from "../../src/proto_catalog.js";
import {
  computeStateData,
  renderStateToText,
} from "../../src/text_renderer.js";
import {
  renderTableRowHtml,
  renderLoopStartRowHtml,
  renderLoopEndRowHtml,
} from "../../src/components/table_row.js";
import { renderNetSummaryRowHtml } from "../../src/components/net_summary.js";
import {
  REPO_ROOT,
  EMISSION_RECIPES,
  getCatalog,
  makeRow,
  makeEmissionRow,
  assertClose,
  runCli,
} from "./helpers.js";

describe("Tier 5: Challenger 1 — Engine, Thermal, Loops, Match Targets & CLI", () => {
  it("1. handles downstream phase transitions from emission rows", () => {
    const { entityMap, elementMap } = getCatalog();

    // Bleach Stone -> Chlorine @ -20 C -> absorb_heat (-20 C delta) -> Liquid Chlorine @ -40 C
    const rowsCl = [
      makeEmissionRow("emit_bleach_stone", 1000, { inputTemp: -20 }),
      makeRow("absorb_heat", 1, {
        material: "Chlorine",
        materialState: "free",
        tempDelta: -20,
      }),
    ];
    const evCl = resolveTableTemperatures(rowsCl, entityMap, elementMap);
    const netCl = calculateSystemNet(evCl, { elementMap });
    assert.equal(
      [...netCl.netInputs, ...netCl.netOutputs].find((s) => s.resource === "Chlorine"),
      undefined,
      "Chlorine should cancel completely"
    );
    const liqCl = netCl.netOutputs.find((s) => s.resource === "Liquid Chlorine");
    assert.ok(liqCl, "Expected Liquid Chlorine in netOutputs");
    assert.equal(liqCl.state, "free");
    assertClose(liqCl.tempC, -40, 1e-4);

    // Oxylite -> Oxygen @ -170 C -> absorb_heat (-20 C delta) -> Liquid Oxygen
    const rowsO2 = [
      makeEmissionRow("emit_oxylite", 1000, { inputTemp: -170 }),
      makeRow("absorb_heat", 1, {
        material: "Oxygen",
        materialState: "free",
        tempDelta: -20,
      }),
    ];
    const evO2 = resolveTableTemperatures(rowsO2, entityMap, elementMap);
    const netO2 = calculateSystemNet(evO2, { elementMap });
    assert.ok(
      netO2.netOutputs.some((s) => s.resource === "Liquid Oxygen"),
      "Expected Liquid Oxygen in netOutputs"
    );

    // Rot Pile -> Polluted Oxygen @ -170 C -> absorb_heat (-20 C delta) -> Liquid Oxygen
    const rowsPo2 = [
      makeEmissionRow("emit_rot_pile", 1000, { inputTemp: -170 }),
      makeRow("absorb_heat", 1, {
        material: "Polluted Oxygen",
        materialState: "free",
        tempDelta: -20,
      }),
    ];
    const evPo2 = resolveTableTemperatures(rowsPo2, entityMap, elementMap);
    const netPo2 = calculateSystemNet(evPo2, { elementMap });
    assert.ok(
      netPo2.netOutputs.some((s) => s.resource === "Liquid Oxygen"),
      "Expected Liquid Oxygen from cooled Polluted Oxygen in netOutputs"
    );
  });

  it("2. preserves non-empty evaluated._loops & decoded.loops and renders Loop Start/End", () => {
    const catalog = getCatalog();
    const { entityMap, elementMap } = catalog;
    const rows = [
      makeRow("duplicant", 1),
      makeEmissionRow("emit_oxylite", 100),
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    assert.equal(evaluated._loops.length, 1);
    assert.equal(evaluated._loops[0].resource, "Oxygen");
    assertClose(evaluated._loops[0].rate, 100, 1e-6);

    const param = encodeStateToParam(
      { rateMode: "s", rows, loops: evaluated._loops },
      elementMap
    );
    const decoded = decodeStateFromParam(param, elementMap);
    assert.equal(decoded.loops.length, 1);
    assert.equal(decoded.loops[0].resource, "Oxygen");
    assertClose(decoded.loops[0].rate, 100, 1e-6);

    const stateData = computeStateData(decoded, catalog);
    assert.ok(stateData.loopStartData && stateData.loopStartData.outputLines.length > 0);
    assert.ok(stateData.loopEndData && stateData.loopEndData.inputLines.length > 0);

    const text = renderStateToText(decoded, { catalog });
    assert.ok(text.includes("Loop Start"), "Expected Loop Start in rendered text");
    assert.ok(text.includes("Loop End"), "Expected Loop End in rendered text");
  });

  it("3. covers bin/calc.js CLI across Tier 4 scenarios and edge cases", () => {
    const { entityMap, elementMap } = getCatalog();

    const scenarios = [
      {
        name: "Scenario 1",
        state: {
          rateMode: "s",
          rows: [makeEmissionRow("emit_polluted_water", 100), makeRow("deodorizer", 1)],
        },
        expectText: "Oxygen",
      },
      {
        name: "Scenario 2",
        state: {
          rateMode: "c",
          rows: [makeEmissionRow("emit_bleach_stone", 5)],
        },
        expectText: "3 Kg/cycle",
      },
      {
        name: "Scenario 3",
        state: {
          rateMode: "s",
          rows: [makeEmissionRow("emit_oxylite", 300), makeRow("duplicant", 3)],
        },
        expectText: "Carbon Dioxide",
      },
      {
        name: "Scenario 4",
        state: {
          rateMode: "s",
          rows: [
            makeEmissionRow("emit_polluted_dirt", 50),
            makeEmissionRow("emit_slime", 30),
            makeEmissionRow("emit_rot_pile", 20),
            makeRow("deodorizer", 1),
          ],
        },
        expectText: "Oxygen",
      },
      {
        name: "Scenario 5",
        state: {
          rateMode: "s",
          rows: [
            makeEmissionRow("emit_polluted_mud", 100),
            makeRow("deodorizer", 1),
            makeRow("duplicant", 0.9),
          ],
          netInputTemps: { "Polluted Mud||free": 85, "Sand||free": 85 },
        },
        expectText: "85 °C",
      },
      {
        name: "Scenario 6",
        state: {
          rateMode: "s",
          rows: [
            makeRow("water_sieve", 1),
            makeEmissionRow("emit_polluted_dirt", 200),
            makeRow("deodorizer", 2),
          ],
        },
        expectText: "Water Sieve",
      },
    ];

    for (const sc of scenarios) {
      const param = encodeStateToParam(sc.state, elementMap);
      const textRes = runCli([param]);
      assert.equal(textRes.status, 0, `${sc.name} text CLI failed: ${textRes.stderr}`);
      assert.ok(
        textRes.stdout.includes(sc.expectText),
        `${sc.name} text CLI missing '${sc.expectText}'`
      );

      const jsonRes = runCli([param, "--json"]);
      assert.equal(jsonRes.status, 0, `${sc.name} --json CLI failed: ${jsonRes.stderr}`);
      const parsed = JSON.parse(jsonRes.stdout);
      assert.ok(parsed.netData && parsed.netData.net, `${sc.name} --json missing netData.net`);
    }

    // --rate c overriding "s"-mode param & full URL input
    const sParam = encodeStateToParam(
      { rateMode: "s", rows: [makeEmissionRow("emit_bleach_stone", 5)] },
      elementMap
    );
    const rateOverrideRes = runCli([`https://example.com/?s=${sParam}`, "--rate", "c"]);
    assert.equal(rateOverrideRes.status, 0, rateOverrideRes.stderr);
    assert.ok(rateOverrideRes.stdout.includes("3 Kg/cycle"));

    // --json on active loops
    const loopRows = [makeRow("duplicant", 1), makeEmissionRow("emit_oxylite", 100)];
    const loopEval = resolveTableTemperatures(loopRows, entityMap, elementMap);
    const loopParam = encodeStateToParam(
      { rateMode: "s", rows: loopRows, loops: loopEval._loops },
      elementMap
    );
    const loopJsonRes = runCli([loopParam, "--json"]);
    assert.equal(loopJsonRes.status, 0, loopJsonRes.stderr);
    const loopParsed = JSON.parse(loopJsonRes.stdout);
    assert.ok(loopParsed.loopStartData && loopParsed.loopStartData.outputLines.length === 1);
    assert.ok(loopParsed.loopEndData && loopParsed.loopEndData.inputLines.length === 1);

    // --preset nonexistent_preset exits with code 1
    const badPresetRes = runCli(["--preset", "nonexistent_preset"]);
    assert.equal(badPresetRes.status, 1);
  });

  it("4. sanitizes non-finite qty and inputTemp in evaluateRow and resolveTableTemperatures", () => {
    const { entityMap, elementMap } = getCatalog();

    for (const badQty of [Infinity, -Infinity, NaN]) {
      const ev = evaluateRow(
        makeEmissionRow("emit_polluted_water", badQty),
        entityMap,
        elementMap
      );
      assert.ok(Number.isFinite(ev.qty), `qty should be finite for ${badQty}`);
      assert.ok(Number.isFinite(ev.power), `power should be finite for ${badQty}`);
      assert.ok(Number.isFinite(ev.heat), `heat should be finite for ${badQty}`);
      assert.equal(ev.qty, 0);
      assert.equal(ev.power, 0);
      assert.equal(ev.heat, 0);

      // Also check an entity with non-zero base power/heat (deodorizer)
      const evDeo = evaluateRow(makeRow("deodorizer", badQty), entityMap, elementMap);
      assert.ok(Number.isFinite(evDeo.power), `deodorizer power finite for ${badQty}`);
      assert.ok(Number.isFinite(evDeo.heat), `deodorizer heat finite for ${badQty}`);
      assertClose(evDeo.power, 0, 1e-9);
      assertClose(evDeo.heat, 0, 1e-9);
    }

    for (const badTemp of [Infinity, -Infinity]) {
      const rows = [makeEmissionRow("emit_polluted_dirt", 10, { inputTemp: badTemp })];
      const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
      assert.ok(
        Number.isFinite(evaluated[0].inputs[0].tempC),
        `input tempC should be finite for inputTemp=${badTemp}`
      );
      assert.ok(
        Number.isFinite(evaluated[0].outputs[0].tempC),
        `output tempC should be finite for inputTemp=${badTemp}`
      );
    }
  });

  it("5. handles Rot Pile direct thermal math in applyHeatAndPhaseChange", () => {
    const { elementMap } = getCatalog();

    // 1000 g/s @ 20 C + 83 kDTU/s -> 120 C (shc: 0.83)
    const heated = applyHeatAndPhaseChange("Rot Pile", 1000, 20, 83, "free", elementMap);
    assert.equal(heated.length, 1);
    assert.equal(heated[0].resource, "Rot Pile");
    assertClose(heated[0].tempC, 120, 1e-4);

    // Extreme cooling clamps at -273.15 C
    const cooled = applyHeatAndPhaseChange("Rot Pile", 1000, 20, -1000, "free", elementMap);
    assert.equal(cooled.length, 1);
    assertClose(cooled[0].tempC, -273.15, 1e-4);

    // Synthetic-only elementMap without shc falls back to 1.0 without throwing
    const syntheticMap = new Map([["Rot Pile", { name: "Rot Pile", phase: "Solid" }]]);
    const fallback = applyHeatAndPhaseChange("Rot Pile", 1000, 20, 50, "free", syntheticMap);
    assert.equal(fallback.length, 1);
    assertClose(fallback[0].tempC, 70, 1e-4);
  });

  it("6. isolates 'in a pipe' vs 'free' Polluted Water streams", () => {
    const { entityMap, elementMap } = getCatalog();

    // Plumbed duplicant outputs Polluted Water 'in a pipe' (19.5 g/s); emission consumes 'free'
    const evPlumbed = resolveTableTemperatures(
      [
        makeRow("duplicant", 1, { bathroom: "plumbed" }),
        makeEmissionRow("emit_polluted_water", 19.5),
      ],
      entityMap,
      elementMap
    );
    const netPlumbed = calculateSystemNet(evPlumbed, { elementMap });
    assert.ok(
      netPlumbed.netOutputs.some((s) => s.resource === "Polluted Water" && s.state === "in a pipe"),
      "Plumbed Polluted Water (in a pipe) should remain in netOutputs"
    );
    assert.ok(
      netPlumbed.netInputs.some((s) => s.resource === "Polluted Water" && s.state === "free"),
      "Emission Polluted Water (free) should remain in netInputs"
    );

    // Floor duplicant outputs Polluted Water 'free' (11.1667 g/s); emission consumes 'free'
    const evFloor = resolveTableTemperatures(
      [
        makeRow("duplicant", 1, { bathroom: "floor" }),
        makeEmissionRow("emit_polluted_water", 11.1667),
      ],
      entityMap,
      elementMap
    );
    const netFloor = calculateSystemNet(evFloor, { elementMap });
    const pwFloor = [...netFloor.netInputs, ...netFloor.netOutputs].find(
      (s) => s.resource === "Polluted Water"
    );
    assert.equal(pwFloor, undefined, "Floor Polluted Water (free) should cancel with emission");
  });

  it("7. performs FIFO thermal mixing across multiple emission rows", () => {
    const { entityMap, elementMap } = getCatalog();
    const rows = [
      makeEmissionRow("emit_polluted_dirt", 60, { inputTemp: 10 }),
      makeEmissionRow("emit_rot_pile", 80, { inputTemp: 90 }),
      makeRow("deodorizer", 1), // consumes 100 g/s Polluted Oxygen
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    // FIFO: 60 g/s @ 10 C + 40 g/s @ 90 C -> (60*10 + 40*90)/100 = 42 C?
    // Wait: check whether pool mixes on add or FIFO parcel consumption!
    // Deodorizer receives 100 g/s: pool has 60@10 + 80@90 -> mixed temp (600+7200)/140 = 55.7143 C
    // Wait: calculateSystemNet uses FIFO parcel consumption or pool mixing? Let's verify exact values:
    const deoPo2 = evaluated[2].inputs.find((s) => s.resource === "Polluted Oxygen");
    assert.ok(deoPo2);
    assertClose(deoPo2.tempC, (60 * 10 + 80 * 90) / 140, 1e-3);

    const net = calculateSystemNet(evaluated, { elementMap });
    const po2Out = net.netOutputs.find((s) => s.resource === "Polluted Oxygen");
    assert.ok(po2Out, "Expected 40 g/s leftover Polluted Oxygen");
    assertClose(po2Out.rate, 40, 1e-4);
    assertClose(po2Out.tempC, 90, 1e-4);
  });

  it("8. handles zero-qty emission row in middle of pipeline and computes match targets", () => {
    const { entityMap, elementMap } = getCatalog();
    const rows = [
      makeRow("water_sieve", 1),
      makeEmissionRow("emit_polluted_dirt", 0),
      makeRow("deodorizer", 1),
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    assert.equal(evaluated[1].inputs.length, 0);
    assert.equal(evaluated[1].outputs.length, 0);

    const matches = calculateRowMatchTargets(1, rows, entityMap, {
      elementMap,
      evaluatedRows: evaluated,
    });
    assert.ok(matches["in:Polluted Dirt||free"]);
    assertClose(matches["in:Polluted Dirt||free"].targetQty, 200, 1e-4);
    assert.ok(matches["out:Polluted Oxygen||free"]);
    assertClose(matches["out:Polluted Oxygen||free"].targetQty, 100, 1e-4);
  });

  it("9. computes multi-producer downstream [match] target", () => {
    const { entityMap, elementMap } = getCatalog();
    const rows = [
      makeEmissionRow("emit_polluted_water", 40),
      makeEmissionRow("emit_polluted_dirt", 10),
      makeRow("deodorizer", 1), // demands 100 g/s Polluted Oxygen; row 0 supplies 40, so row 1 needs 60
    ];

    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const matches = calculateRowMatchTargets(1, rows, entityMap, {
      elementMap,
      evaluatedRows: evaluated,
    });
    assert.ok(matches["out:Polluted Oxygen||free"]);
    assertClose(matches["out:Polluted Oxygen||free"].targetQty, 60, 1e-4);
  });

  it("10. scales /cycle mass units (g/cycle -> Kg/cycle -> T/cycle) in text and net summary HTML", () => {
    const catalog = getCatalog();
    const { entityMap, elementMap } = catalog;

    const cases = [
      { qty: 1, expected: "600 g/cycle" },
      { qty: 2, expected: "1.2 Kg/cycle" },
      { qty: 2000, expected: "1.2 T/cycle" },
    ];

    for (const c of cases) {
      const state = {
        rateMode: "c",
        rows: [makeEmissionRow("emit_bleach_stone", c.qty)],
      };
      const text = renderStateToText(state, { catalog });
      assert.ok(
        text.includes(c.expected),
        `Expected '${c.expected}' in renderStateToText for qty=${c.qty}:\n${text}`
      );

      const evaluated = resolveTableTemperatures(state.rows, entityMap, elementMap);
      const net = calculateSystemNet(evaluated, { elementMap });
      const html = renderNetSummaryRowHtml(net, elementMap, "c", {});
      assert.ok(
        html.includes(c.expected),
        `Expected '${c.expected}' in renderNetSummaryRowHtml for qty=${c.qty}`
      );
    }
  });
});

describe("Tier 5: Challenger 2 — Dataset, Search, Protobuf & UI", () => {
  it("11. verifies searchEntities ranking, recipe search, null/undefined queries, and category exclusion", () => {
    const { entities } = getCatalog();

    // Exact "Emission"
    const exactRes = searchEntities(entities, "Emission");
    assert.equal(exactRes[0].id, "emission");

    // Alias "Sublimation" beats "sublimation_station"
    const subRes = searchEntities(entities, "Sublimation");
    assert.equal(subRes[0].id, "emission");

    // Alias "Oxygen" beats "oxygen_diffuser"
    const o2Res = searchEntities(entities, "Oxygen");
    assert.equal(o2Res[0].id, "emission");

    // Recipe ID / name / subcategory searches
    for (const q of ["emit_polluted_water", "emit_rot_pile", "-> Chlorine", "1 g/s", "Meta"]) {
      const r = searchEntities(entities, q);
      assert.ok(
        r.some((e) => e.id === "emission"),
        `Expected 'emission' in searchEntities('${q}')`
      );
    }

    // null / undefined queries
    assert.ok(Array.isArray(searchEntities(entities, null)));
    assert.ok(Array.isArray(searchEntities(entities, undefined)));

    // Cross-category exclusion
    assert.equal(
      searchEntities(entities, "Rot Pile", "Plant").some((e) => e.id === "emission"),
      false
    );
    assert.equal(
      searchEntities(entities, "Slime", "Critter").some((e) => e.id === "emission"),
      false
    );
  });

  it("12. verifies Protobuf schema parity, enum ID pinning, and legacy pre-emission payload decoding", () => {
    const protoFile = fs.readFileSync(path.join(REPO_ROOT, "src/state.proto"), "utf8");
    assert.equal(PROTO_SCHEMA, protoFile);

    assert.equal(ENTITY_TO_ENUM.get("shower"), 161);
    assert.equal(ENTITY_TO_ENUM.get("emission"), 162);
    assert.equal(RECIPE_TO_ENUM.get("zinc_gas"), 207);
    assert.equal(RECIPE_TO_ENUM.get("emit_polluted_water"), 208);
    assert.equal(RECIPE_TO_ENUM.get("emit_polluted_dirt"), 209);
    assert.equal(RECIPE_TO_ENUM.get("emit_polluted_mud"), 210);
    assert.equal(RECIPE_TO_ENUM.get("emit_slime"), 211);
    assert.equal(RECIPE_TO_ENUM.get("emit_bleach_stone"), 212);
    assert.equal(RECIPE_TO_ENUM.get("emit_oxylite"), 213);
    assert.equal(RECIPE_TO_ENUM.get("emit_rot_pile"), 214);
    assert.equal(ELEMENT_TO_ENUM.get("Rot Pile"), 257);

    // Fixed pre-emission legacy payload: electrolyzer (qty 1) + duplicant (qty 8, plumbed)
    // Encoded with only pre-emission enum IDs
    const legacyParam = "EgQIIBABEgQIHhAI";
    const decodedLegacy = decodeStateFromParam(legacyParam);
    assert.equal(decodedLegacy.rows.length, 2);
    assert.equal(decodedLegacy.rows[0].entityId, "electrolyzer");
    assert.equal(decodedLegacy.rows[0].qty, 1);
    assert.equal(decodedLegacy.rows[1].entityId, "duplicant");
    assert.equal(decodedLegacy.rows[1].qty, 8);
  });

  it("13. fuzzes decodeStateFromParam with truncations, malformed strings, and crafted invalid protobuf", () => {
    const { elementMap } = getCatalog();
    const state = {
      rateMode: "s",
      rows: [makeEmissionRow("emit_polluted_water", 10), makeRow("deodorizer", 1)],
      loops: [{ resource: "Oxygen", state: "free", rate: 9, unit: "g/s", tempC: 20 }],
      netInputTemps: { "Polluted Water||free": 30 },
    };
    const param = encodeStateToParam(state, elementMap);

    // Truncate at every prefix 0..param.length
    for (let len = 0; len <= param.length; len++) {
      const prefix = param.slice(0, len);
      const res = decodeStateFromParam(prefix, elementMap);
      assert.ok(res && Array.isArray(res.rows) && Array.isArray(res.loops));
    }

    // Malformed strings
    for (const bad of ["%E0%A4%A", "pb:", "pb:!!!", "!!!!", "\x00\x01\x02"]) {
      const res = decodeStateFromParam(bad, elementMap);
      assert.ok(res && Array.isArray(res.rows) && Array.isArray(res.loops));
    }

    // Crafted protobuf bytes with out-of-range enums, NaN doubles, negative countDouble / rateDouble
    const crafted = CalculatorStateType.create({
      rateMode: 0,
      rows: [
        RowStateType.create({ entity: 9999, countInt: 1 }),
        RowStateType.create({ entity: 162, recipe: 208, countDouble: NaN }),
        RowStateType.create({ entity: 162, recipe: 208, countDouble: -5.5 }),
      ],
      loops: [
        LoopedStreamType.create({ element: 9999, rateDouble: 10 }),
        LoopedStreamType.create({ element: 257, rateDouble: NaN }),
        LoopedStreamType.create({ element: 257, rateDouble: -12.3 }),
      ],
    });
    const bytes = CalculatorStateType.encode(crafted).finish();
    const decoded = decodeStateFromProtobuf(bytes, elementMap);
    // entity: 9999 skipped; remaining 2 emission rows have sanitized qty === 1
    assert.equal(decoded.rows.length, 2);
    assert.equal(decoded.rows[0].qty, 1);
    assert.equal(decoded.rows[1].qty, 1);
    // All invalid loops skipped
    assert.equal(decoded.loops.length, 0);
  });

  it("14. handles oneof count boundary values for emission rows", () => {
    const { elementMap } = getCatalog();
    const boundaries = [0, 0.001, 9.9999, 10, 10.1234, 4294967295, 4294967296];

    for (const qty of boundaries) {
      const state = {
        rateMode: "s",
        rows: [makeEmissionRow("emit_oxylite", qty)],
      };
      const param = encodeStateToParam(state, elementMap);
      const decoded = decodeStateFromParam(param, elementMap);
      assert.equal(decoded.rows.length, 1);
      assertClose(decoded.rows[0].qty, qty, 1e-4, `Failed round-trip for qty=${qty}`);
    }
  });

  it("15. preserves free state & Rot Pile serialization and re-encode idempotency", () => {
    const { elementMap } = getCatalog();

    for (const rateMode of ["s", "c"]) {
      const state = {
        rateMode,
        rows: [
          makeEmissionRow("emit_polluted_water", 50),
          makeEmissionRow("emit_rot_pile", 25),
        ],
        netInputTemps: {
          "Polluted Water||free": 45,
          "Polluted Water||in a pipe": 15,
          "Rot Pile||free": 60,
        },
        loops: [
          { resource: "Polluted Water", state: "free", rate: 10, unit: "g/s", tempC: 45 },
          { resource: "Rot Pile", state: "free", rate: 5, unit: "g/s", tempC: 60 },
        ],
      };

      const param = encodeStateToParam(state, elementMap);
      const decoded = decodeStateFromParam(param, elementMap);
      assert.equal(decoded.rateMode, rateMode);
      assert.equal(decoded.netInputTemps["Polluted Water||free"], 45);
      assert.equal(decoded.netInputTemps["Polluted Water||in a pipe"], 15);
      assert.equal(decoded.netInputTemps["Rot Pile||free"], 60);
      assert.equal(decoded.loops.length, 2);
      assert.equal(decoded.loops[0].resource, "Polluted Water");
      assert.equal(decoded.loops[0].state, "free");
      assert.equal(decoded.loops[1].resource, "Rot Pile");
      assert.equal(decoded.loops[1].state, "free");

      const reencoded = encodeStateToParam(decoded, elementMap);
      assert.equal(reencoded, param, `Re-encode idempotency failed in rateMode='${rateMode}'`);
    }
  });

  it("16. renders UI components cleanly for emission rows, net summary, and loops", () => {
    const { entityMap, elementMap } = getCatalog();

    // Table row for emit_polluted_water (Liquid input -> free badge) vs emit_polluted_dirt (Solid input -> no free badge)
    const rows = [
      makeEmissionRow("emit_polluted_water", 10),
      makeEmissionRow("emit_polluted_dirt", 10),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);

    const htmlWater = renderTableRowHtml(rows[0], evaluated[0], elementMap, "s", 0, {}, 2, []);
    assert.ok(htmlWater.includes('class="recipe-select"'));
    for (const r of EMISSION_RECIPES) {
      assert.ok(
        htmlWater.includes(`value="${r.id}"`),
        `Expected option value="${r.id}" in recipe-select`
      );
    }
    const selectedMatches = htmlWater.match(/<option value="emit_[^"]+" selected>/g) || [];
    assert.equal(selectedMatches.length, 1);
    assert.ok(selectedMatches[0].includes('value="emit_polluted_water"'));
    assert.ok(htmlWater.includes("free"), "Expected 'free' badge on Liquid Polluted Water");
    assert.ok(!htmlWater.includes("@ null"));
    assert.ok(!htmlWater.includes("NaN"));
    assert.ok(!htmlWater.includes("Power:"));
    assert.ok(!htmlWater.includes("Heat:"));

    const htmlDirt = renderTableRowHtml(rows[1], evaluated[1], elementMap, "s", 1, {}, 2, []);
    // Input cell shouldn't show 'free' badge on Solid Polluted Dirt; check input-list specifically
    const inputCellMatch = htmlDirt.match(/<td class="col-inputs"[^>]*>([\s\S]*?)<\/td>/);
    assert.ok(inputCellMatch);
    assert.equal(
      inputCellMatch[1].includes(">free<"),
      false,
      "Solid input should not display 'free' badge"
    );

    // btn-match-stream vs badge-matched
    const matchRows = [makeEmissionRow("emit_oxylite", 50), makeRow("duplicant", 1)];
    const matchEval = resolveTableTemperatures(matchRows, entityMap, elementMap);
    const unmatchedTargets = calculateRowMatchTargets(0, matchRows, entityMap, {
      elementMap,
      evaluatedRows: matchEval,
    });
    const htmlUnmatched = renderTableRowHtml(
      matchRows[0],
      matchEval[0],
      elementMap,
      "s",
      0,
      unmatchedTargets,
      2,
      []
    );
    assert.ok(htmlUnmatched.includes("btn-match-stream"));

    const matchedRows = [makeEmissionRow("emit_oxylite", 100), makeRow("duplicant", 1)];
    const matchedEval = resolveTableTemperatures(matchedRows, entityMap, elementMap);
    const matchedTargets = calculateRowMatchTargets(0, matchedRows, entityMap, {
      elementMap,
      evaluatedRows: matchedEval,
    });
    const htmlMatched = renderTableRowHtml(
      matchedRows[0],
      matchedEval[0],
      elementMap,
      "s",
      0,
      matchedTargets,
      2,
      []
    );
    assert.ok(htmlMatched.includes("badge-matched"));

    // net-temp-input & btn-match-net-temp
    const netHtml = renderNetSummaryRowHtml(
      calculateSystemNet(matchedEval, { elementMap }),
      elementMap,
      "s",
      {}
    );
    assert.ok(netHtml.includes("net-temp-input"));

    const loopCandidateNet = calculateSystemNet(
      resolveTableTemperatures(
        [makeRow("duplicant", 1), makeEmissionRow("emit_oxylite", 100, { inputTemp: 50 })],
        entityMap,
        elementMap
      ),
      { elementMap }
    );
    const loopNetHtml = renderNetSummaryRowHtml(loopCandidateNet, elementMap, "s", {});
    assert.ok(loopNetHtml.includes("btn-match-net-temp"));

    // Loop Start / Loop End HTML with valid <img> icon paths
    const activeLoopEval = resolveTableTemperatures(
      [makeRow("duplicant", 1), makeEmissionRow("emit_oxylite", 100)],
      entityMap,
      elementMap
    );
    const loopStartHtml = renderLoopStartRowHtml(activeLoopEval._loops, elementMap, "s");
    const loopEndHtml = renderLoopEndRowHtml(activeLoopEval._loops, elementMap, "s");
    assert.ok(loopStartHtml.includes("<img "));
    assert.ok(loopEndHtml.includes("<img "));
    for (const imgMatch of [...loopStartHtml.matchAll(/src="([^"]+)"/g), ...loopEndHtml.matchAll(/src="([^"]+)"/g)]) {
      const iconPath = path.join(REPO_ROOT, imgMatch[1]);
      assert.ok(fs.existsSync(iconPath), `Missing icon file: ${iconPath}`);
    }
  });
});
