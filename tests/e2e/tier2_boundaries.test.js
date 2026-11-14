/**
 * Tier 2: Boundary & Corner Cases E2E Tests (Features 1–10).
 * Minimum requirement: >= 5 tests per feature (>= 50 tests total).
 * Uses exclusively public entry points and Interface Contracts from PROJECT.md.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { searchEntities } from "../../src/data_loader.js";
import {
  evaluateRow,
  resolveTableTemperatures,
  calculateRowMatchTargets,
  calculateSystemNet,
  formatStreamLine,
  NET_RATE_EPSILON,
} from "../../src/calculator.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
} from "../../src/url_state.js";
import { renderTableRowHtml } from "../../src/components/table_row.js";
import {
  EMISSION_RECIPES,
  getCatalog,
  makeRow,
  makeEmissionRow,
  assertClose,
  requireEmissionEntity,
  requireEmissionRecipe,
  runCli,
} from "./helpers.js";

describe("Tier 2: Feature 1 — Emission Entity Search & Fallback Boundaries", () => {
  it("includes emission when searching with empty query '' in 'All'", () => {
    const { entities } = getCatalog();
    requireEmissionEntity();
    const results = searchEntities(entities, "", "All");
    assert.ok(results.some((e) => e.id === "emission"));
  });

  it("matches case-insensitively for 'eMiSsIoN', 'OFF-GAS', and 'sUbLiMaTiOn'", () => {
    const { entities } = getCatalog();
    requireEmissionEntity();
    for (const q of ["eMiSsIoN", "OFF-GAS", "sUbLiMaTiOn"]) {
      const results = searchEntities(entities, q, "All");
      assert.ok(
        results.some((e) => e.id === "emission"),
        `Expected case-insensitive search '${q}' to include 'emission'`
      );
    }
  });

  it("excludes emission when categoryFilter is Plant, Critter, Duplicant, or Geyser", () => {
    const { entities } = getCatalog();
    requireEmissionEntity();
    for (const cat of ["Plant", "Critter", "Duplicant", "Geyser"]) {
      const results = searchEntities(entities, "Emission", cat);
      assert.equal(
        results.some((e) => e.id === "emission"),
        false,
        `Expected categoryFilter '${cat}' to exclude 'emission'`
      );
    }
  });

  it("matches whitespace-padded query '  emission  '", () => {
    const { entities } = getCatalog();
    requireEmissionEntity();
    const results = searchEntities(entities, "  emission  ", "All");
    assert.ok(results.some((e) => e.id === "emission"));
  });

  it("falls back to first recipe gracefully when recipeId is unknown", () => {
    const { entityMap, elementMap } = getCatalog();
    const entity = requireEmissionEntity();
    const ev = evaluateRow(
      makeEmissionRow("nonexistent_emit_recipe", 5),
      entityMap,
      elementMap
    );
    assert.ok(ev.entity);
    assert.equal(ev.inputs.length, 1);
    assert.equal(ev.outputs.length, 1);
    assert.equal(ev.inputs[0].resource, entity.recipes[0].inputs[0].resource);
    assertClose(ev.inputs[0].rate, 5, 1e-6);
    assertClose(ev.outputs[0].rate, 5, 1e-6);
  });
});

describe("Tier 2: Feature 2 — emit_polluted_water Boundaries", () => {
  const id = "emit_polluted_water";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves temperature near Polluted Water freezing point (-20.0 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -20.0 }), entityMap, elementMap);
    assertClose(ev.inputs[0].tempC, -20.0, 1e-4);
    assertClose(ev.outputs[0].tempC, -20.0, 1e-4);
  });

  it("preserves temperature near Polluted Water boiling point (119.0 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 119.0 }), entityMap, elementMap);
    assertClose(ev.inputs[0].tempC, 119.0, 1e-4);
    assertClose(ev.outputs[0].tempC, 119.0, 1e-4);
  });
});

describe("Tier 2: Feature 3 — emit_polluted_dirt Boundaries", () => {
  const id = "emit_polluted_dirt";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("clamps negative qty: -5 to 0", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, -5), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves sub-zero temperature (-180 °C) near Polluted Oxygen condensation", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -180.0 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, -180.0, 1e-4);
  });
});

describe("Tier 2: Feature 4 — emit_polluted_mud Boundaries", () => {
  const id = "emit_polluted_mud";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves temperature near Polluted Mud transition (99.5 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 99.5 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, 99.5, 1e-4);
  });

  it("preserves elevated temperature (150 °C) cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 150.0 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, 150.0, 1e-4);
  });
});

describe("Tier 2: Feature 5 — emit_slime Boundaries", () => {
  const id = "emit_slime";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves temperature near Slime transition (124.9 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 124.9 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, 124.9, 1e-4);
  });

  it("preserves cold temperature (-182.0 °C) cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -182.0 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, -182.0, 1e-4);
  });
});

describe("Tier 2: Feature 6 — emit_bleach_stone Boundaries", () => {
  const id = "emit_bleach_stone";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves temperature near Chlorine condensation (-34.5 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -34.5 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, -34.5, 1e-4);
  });

  it("preserves high temperature (500 °C) cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 500.0 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, 500.0, 1e-4);
  });
});

describe("Tier 2: Feature 7 — emit_oxylite Boundaries", () => {
  const id = "emit_oxylite";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("preserves temperature near Oxygen condensation (-182.5 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -182.5 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, -182.5, 1e-4);
  });

  it("preserves high temperature (1000 °C) cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: 1000.0 }), entityMap, elementMap);
    assertClose(ev.outputs[0].tempC, 1000.0, 1e-4);
  });
});

describe("Tier 2: Feature 8 — emit_rot_pile (Synthetic Element) Boundaries", () => {
  const id = "emit_rot_pile";

  it("handles qty: 0 cleanly", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0), entityMap, elementMap);
    assertClose(ev.qty, 0, 1e-9);
    assert.equal(ev.inputs.length, 0);
    assert.equal(ev.outputs.length, 0);
  });

  it("handles tiny fractional qty: 0.001", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 0.001), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 0.001, 1e-9);
    assertClose(ev.outputs[0].rate, 0.001, 1e-9);
  });

  it("handles large qty: 100000", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const ev = evaluateRow(makeEmissionRow(id, 100000), entityMap, elementMap);
    assertClose(ev.inputs[0].rate, 100000, 1e-4);
    assertClose(ev.outputs[0].rate, 100000, 1e-4);
  });

  it("handles Rot Pile with null transition bounds at extreme cold (-250 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const rotInfo = elementMap.get("Rot Pile");
    assert.ok(rotInfo, "Expected Rot Pile in elementMap");
    assert.equal(rotInfo.low_temp ?? null, null);
    assert.equal(rotInfo.high_temp ?? null, null);

    const ev = evaluateRow(makeEmissionRow(id, 1, { inputTemp: -250.0 }), entityMap, elementMap);
    assertClose(ev.inputs[0].tempC, -250.0, 1e-4);
    assertClose(ev.outputs[0].tempC, -250.0, 1e-4);
  });

  it("handles Rot Pile in resolveTableTemperatures at extreme heat (+2000 °C)", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe(id);
    const rows = [makeEmissionRow(id, 10)];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap, {
      netInputTemps: { "Rot Pile||free": 2000.0 },
    });
    assertClose(evaluated[0].inputs[0].tempC, 2000.0, 1e-4);
    assertClose(evaluated[0].outputs[0].tempC, 2000.0, 1e-4);
  });
});

describe("Tier 2: Feature 9 — Protobuf URL Serialization Boundaries", () => {
  it("sanitizes NaN, Infinity, -Infinity, and negative qty to 1", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    for (const badQty of [NaN, Infinity, -Infinity, -5]) {
      const param = encodeStateToParam(
        { rateMode: "s", rows: [makeEmissionRow("emit_slime", badQty)] },
        elementMap
      );
      const decoded = decodeStateFromParam(param);
      assert.equal(decoded.rows.length, 1);
      assertClose(decoded.rows[0].qty, 1, 1e-6, `Expected sanitized qty 1 for ${badQty}`);
    }
  });

  it("round-trips qty: 0, tiny 0.001, and large 100000", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const state = {
      rateMode: "s",
      rows: [
        makeEmissionRow("emit_polluted_water", 0),
        makeEmissionRow("emit_polluted_dirt", 0.001),
        makeEmissionRow("emit_oxylite", 100000),
      ],
    };
    const param = encodeStateToParam(state, elementMap);
    const decoded = decodeStateFromParam(param);
    assert.equal(decoded.rows.length, 3);
    assertClose(decoded.rows[0].qty, 0, 1e-6);
    assertClose(decoded.rows[1].qty, 0.001, 1e-6);
    assertClose(decoded.rows[2].qty, 100000, 1e-4);
  });

  it("returns empty default state for malformed base64 without throwing", () => {
    for (const bad of ["", "!!!not_base64!!!", "a", "s=%%%bad%%%", null, undefined]) {
      const decoded = decodeStateFromParam(bad);
      assert.ok(decoded && Array.isArray(decoded.rows));
      assert.equal(decoded.rows.length, 0);
    }
  });

  it("rejects overlong parameter strings (> 65536 chars) safely", () => {
    const huge = "A".repeat(70000);
    const decoded = decodeStateFromParam(huge);
    assert.equal(decoded.rows.length, 0);
  });

  it("decodes full URL with ?s=...#fragment and pb: prefix", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const param = encodeStateToParam(
      { rateMode: "s", rows: [makeEmissionRow("emit_rot_pile", 42)] },
      elementMap
    );
    const fromUrl = decodeStateFromParam(`https://example.com/?s=${param}#section`);
    assert.equal(fromUrl.rows.length, 1);
    assert.equal(fromUrl.rows[0].entityId, "emission");
    assert.equal(fromUrl.rows[0].recipeId, "emit_rot_pile");
    assertClose(fromUrl.rows[0].qty, 42, 1e-4);

    const fromPb = decodeStateFromParam(`pb:${param}`);
    assert.equal(fromPb.rows.length, 1);
    assert.equal(fromPb.rows[0].recipeId, "emit_rot_pile");
  });
});

describe("Tier 2: Feature 10 — Rate, Match, UI & CLI Boundaries", () => {
  it("produces no NaN or Infinity match targets when upstream/downstream rate is 0", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_bleach_stone");
    const rows = [makeEmissionRow("emit_bleach_stone", 0)];
    const matches = calculateRowMatchTargets(0, rows, entityMap, { elementMap });
    for (const [k, m] of Object.entries(matches)) {
      assert.ok(
        Number.isFinite(m.targetQty),
        `Expected finite targetQty for '${k}', got ${m.targetQty}`
      );
    }
  });

  it("cancels exact emission match without stray NET streams above NET_RATE_EPSILON", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_oxylite");
    const rows = [
      makeEmissionRow("emit_oxylite", 100),
      makeRow("duplicant", 1), // consumes 100 g/s Oxygen
    ];
    const evaluated = resolveTableTemperatures(rows, entityMap, elementMap);
    const net = calculateSystemNet(evaluated, { elementMap });
    const o2Net = [...net.netInputs, ...net.netOutputs].find(
      (s) => s.resource === "Oxygen"
    );
    assert.ok(
      !o2Net || Math.abs(o2Net.rate) < NET_RATE_EPSILON,
      `Expected Oxygen to cancel completely, got ${o2Net?.rate}`
    );
  });

  it("formats zero and tiny streams cleanly without -0", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionRecipe("emit_slime");
    const line0 = formatStreamLine(
      { resource: "Polluted Oxygen", rate: -0, unit: "g/s", state: "free", tempC: 20 },
      true,
      "c",
      elementMap
    );
    assert.ok(!line0.includes("-0"), `Unexpected '-0' in '${line0}'`);

    const evTiny = evaluateRow(makeEmissionRow("emit_slime", 0.001), entityMap, elementMap);
    const lineTiny = formatStreamLine(evTiny.outputs[0], true, "s", elementMap);
    assert.ok(lineTiny.includes("Polluted Oxygen"));
  });

  it("renders table row HTML gracefully for qty: 0 and unknown recipeId", () => {
    const { entityMap, elementMap } = getCatalog();
    requireEmissionEntity();
    const row = makeEmissionRow("unknown_recipe", 0);
    const evaluated = resolveTableTemperatures([row], entityMap, elementMap);
    const html = renderTableRowHtml(row, evaluated[0], elementMap, "s", 0, {}, 1, []);
    assert.ok(html.includes("Emission"));
  });

  it("supports CLI --no-header and stdin pipe for emission states", () => {
    const { elementMap } = getCatalog();
    requireEmissionEntity();
    const param = encodeStateToParam(
      { rateMode: "s", rows: [makeEmissionRow("emit_polluted_mud", 15)] },
      elementMap
    );
    const res = runCli(["--no-header"], param);
    assert.equal(res.status, 0, `CLI stdin pipe failed: ${res.stderr}`);
    assert.ok(res.stdout.includes("Emission"));
    assert.ok(res.stdout.includes("Polluted Mud"));
    assert.ok(res.stdout.includes("Polluted Oxygen"));
  });
});
