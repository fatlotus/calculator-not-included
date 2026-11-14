/**
 * Tier 3: Cross-Feature Pairwise Combinations E2E Tests.
 * Covers pairwise combinations across all 7 emission recipes × rate modes ("s" vs "c")
 * × thermal pass-through + downstream consumer/phase change × [match] targets
 * × automatic loops × Protobuf URL round-trip × CLI (--json, text) + HTML (renderTableRowHtml).
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
import { computeStateData, renderStateToText } from "../../src/text_renderer.js";
import { renderTableRowHtml } from "../../src/components/table_row.js";
import {
  EMISSION_RECIPES,
  getCatalog,
  makeRow,
  makeEmissionRow,
  assertClose,
  requireEmissionRecipe,
  runCli,
} from "./helpers.js";

describe("Tier 3: Pairwise — 7 Emission Recipes × Rate Modes ('s' / 'c') × URL × Text × HTML", () => {
  for (const spec of EMISSION_RECIPES) {
    for (const rateMode of ["s", "c"]) {
      it(`${spec.id} × rateMode='${rateMode}' round-trips URL, renders HTML, and computes text/JSON state`, () => {
        const { entityMap, elementMap } = getCatalog();
        requireEmissionRecipe(spec.id);

        const qty = 12.5;
        const state = {
          rateMode,
          rows: [makeEmissionRow(spec.id, qty)],
        };

        const param = encodeStateToParam(state, elementMap);
        const decoded = decodeStateFromParam(param);
        assert.equal(decoded.rateMode, rateMode);
        assert.equal(decoded.rows.length, 1);
        assert.equal(decoded.rows[0].entityId, "emission");
        assert.equal(decoded.rows[0].recipeId, spec.id);
        assertClose(decoded.rows[0].qty, qty, 1e-4);

        const evaluated = resolveTableTemperatures(decoded.rows, entityMap, elementMap);
        assertClose(evaluated[0].inputs[0].rate, qty, 1e-4);
        assertClose(evaluated[0].outputs[0].rate, qty, 1e-4);

        const html = renderTableRowHtml(
          decoded.rows[0],
          evaluated[0],
          elementMap,
          rateMode,
          0,
          {},
          1,
          []
        );
        assert.ok(html.includes("Emission"));
        assert.ok(html.includes(spec.input));
        assert.ok(html.includes(spec.output));
        assert.ok(
          html.includes(rateMode === "c" ? "/cycle" : "/s"),
          `Expected rate unit '${rateMode === "c" ? "/cycle" : "/s"}' in HTML`
        );

        const data = computeStateData(decoded, getCatalog());
        assert.equal(data.rateMode, rateMode);
        assert.equal(data.rowsData.length, 1);

        const text = renderStateToText(decoded, { catalog: getCatalog() });
        assert.ok(text.includes("Emission"));
        assert.ok(text.includes(spec.output));
      });
    }
  }
});

describe("Tier 3: Pairwise — 7 Emission Recipes × CLI (--json & text)", () => {
  for (let i = 0; i < EMISSION_RECIPES.length; i++) {
    const spec = EMISSION_RECIPES[i];
    const rateMode = i % 2 === 0 ? "s" : "c";
    it(`${spec.id} × CLI --json and text (rateMode='${rateMode}')`, () => {
      const { elementMap } = getCatalog();
      requireEmissionRecipe(spec.id);
      const param = encodeStateToParam(
        { rateMode, rows: [makeEmissionRow(spec.id, 10)] },
        elementMap
      );

      const jsonRes = runCli([param, "--json"]);
      assert.equal(jsonRes.status, 0, `CLI --json failed: ${jsonRes.stderr}`);
      const parsed = JSON.parse(jsonRes.stdout);
      assert.equal(parsed.rateMode, rateMode);
      assert.ok(
        parsed.netData.net.netInputs.some((x) => x.resource === spec.input),
        `Expected '${spec.input}' in netInputs`
      );
      assert.ok(
        parsed.netData.net.netOutputs.some((x) => x.resource === spec.output),
        `Expected '${spec.output}' in netOutputs`
      );

      const textRes = runCli([param]);
      assert.equal(textRes.status, 0, `CLI text failed: ${textRes.stderr}`);
      assert.ok(textRes.stdout.includes(spec.output));
      if (rateMode === "c") {
        assert.ok(
          textRes.stdout.includes("6 Kg/cycle"),
          `Expected '6 Kg/cycle' in CLI output:\n${textRes.stdout}`
        );
      }
    });
  }
});

describe("Tier 3: Pairwise — Thermal Pass-Through × Downstream Consumers & Phase Change", () => {
  const po2Recipes = EMISSION_RECIPES.filter((r) => r.output === "Polluted Oxygen");

  for (const spec of po2Recipes) {
    it(`${spec.id} passes 65 °C through to Deodorizer -> Oxygen @ 65 °C`, () => {
      const { entityMap, elementMap } = getCatalog();
      requireEmissionRecipe(spec.id);
      const rows = [
        makeEmissionRow(spec.id, 100),
        makeRow("deodorizer", 1),
      ];
      const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
        netInputTemps: { [`${spec.input}||free`]: 65, "Sand||free": 65 },
      });
      assertClose(evaluated[0].outputs[0].tempC, 65, 1e-4);
      assertClose(evaluated[1].inputs[0].tempC, 65, 1e-4);
      assertClose(evaluated[1].outputs[0].tempC, 65, 1e-4);

      const net = calculateSystemNet(evaluated, { elementMap });
      const po2Net = [...net.netInputs, ...net.netOutputs].find(
        (s) => s.resource === "Polluted Oxygen"
      );
      assert.equal(po2Net, undefined, "Expected Polluted Oxygen to cancel completely");
    });
  }

  it("emit_oxylite passes 30 °C Oxygen to Duplicant and cancels Oxygen completely", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_oxylite");
    const rows = [
      makeEmissionRow("emit_oxylite", 100),
      makeRow("duplicant", 1),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
      netInputTemps: { "Oxylite||free": 30 },
    });
    assertClose(evaluated[0].outputs[0].tempC, 30, 1e-4);
    assertClose(evaluated[1].inputs[0].tempC, 30, 1e-4);
    const net = calculateSystemNet(evaluated, { elementMap });
    const o2Net = [...net.netInputs, ...net.netOutputs].find((s) => s.resource === "Oxygen");
    assert.equal(o2Net, undefined, "Expected Oxygen to cancel completely");
  });

  it("emit_bleach_stone feeds Chlorine into absorb_heat for downstream heating", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_bleach_stone");
    const rows = [
      makeEmissionRow("emit_bleach_stone", 1000),
      makeRow("absorb_heat", 1, {
        material: "Chlorine",
        materialState: "free",
        tempDelta: 20,
      }),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
      netInputTemps: { "Bleach Stone||free": 25 },
    });
    assertClose(evaluated[0].outputs[0].tempC, 25, 1e-4);
    assertClose(evaluated[1].inputs[0].tempC, 25, 1e-4);
    assertClose(evaluated[1].outputs[0].tempC, 45, 1e-4);
  });
});

describe("Tier 3: Pairwise — [match] Targets × Automatic Loops × URL Round-Trip", () => {
  it("computes both upstream and downstream [match] targets in Water Sieve -> Emission -> Deodorizer", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_dirt");
    const rows = [
      makeRow("water_sieve", 1), // outputs 200 g/s Polluted Dirt
      makeEmissionRow("emit_polluted_dirt", 50),
      makeRow("deodorizer", 1), // consumes 100 g/s Polluted Oxygen
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const matches = calculateRowMatchTargets(1, rows, entityMap, {
      elementMap,
      evaluatedRows: evaluated,
    });
    assertClose(matches["in:Polluted Dirt||free"].targetQty, 200, 1e-4);
    assertClose(matches["out:Polluted Oxygen||free"].targetQty, 100, 1e-4);

    const html = renderTableRowHtml(rows[1], evaluated[1], elementMap, "s", 1, matches, 3, []);
    assert.ok(html.includes("[match: 200×]"), "Expected [match: 200×] button in HTML");
    assert.ok(html.includes("[match: 100×]"), "Expected [match: 100×] button in HTML");
  });

  it("converges automatic loops and round-trips through Protobuf URL with emission rows", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_polluted_water");
    const rows = [
      makeRow("algae_terrarium", 1),
      makeEmissionRow("emit_polluted_water", 290.33),
      makeRow("deodorizer", 2.9033),
      makeRow("duplicant", 1),
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const state = {
      rateMode: "s",
      rows,
      loops: evaluated._loops || [],
    };
    const param = encodeStateToParam(state, elementMap);
    const decoded = decodeStateFromParam(param);
    assert.equal(decoded.rows.length, 4);
    assert.equal(decoded.rows[1].entityId, "emission");
    assert.equal(decoded.rows[1].recipeId, "emit_polluted_water");
    assertClose(decoded.rows[1].qty, 290.33, 1e-3);
  });
});
