/**
 * Test Suite: Calculator & Math Engine.
 * Tests building row evaluation, scaling, stream formatting,
 * unit auto-scaling, small net rate elision (roundoff handling), and default temperatures.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  calculateSystemNet,
  getDefaultElementTemp,
  formatStreamLine,
  NET_RATE_EPSILON,
} from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";

const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Calculator Core Engine & Evaluation", () => {
  it("evaluates a single building row correctly", () => {
    const elRow = evaluateRow({ entityId: "electrolyzer", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(elRow.power, -120);
    assert.strictEqual(elRow.heat, 1.25);
    assert.strictEqual(elRow.inputs[0].rate, 1000);
    assert.strictEqual(elRow.outputs[0].rate, 888);
    assert.strictEqual(elRow.outputs[1].rate, 112);
  });

  it("scales building inputs, outputs, power, and heat proportionally with quantity", () => {
    const elRow3 = evaluateRow({ entityId: "electrolyzer", qty: 3 }, entityMap, elementMap);
    assert.strictEqual(elRow3.power, -360);
    assert.strictEqual(elRow3.heat, 3.75);
    assert.strictEqual(elRow3.inputs[0].rate, 3000);
    assert.strictEqual(elRow3.outputs[0].rate, 2664);
    assert.strictEqual(elRow3.outputs[1].rate, 336);
  });

  it("resolves default element temperatures correctly", () => {
    assert.strictEqual(getDefaultElementTemp("Water", elementMap), 20);

    const customElements = new Map([
      ["Steam", { low_temp: 372.5, high_temp: null }],
      ["Ice", { low_temp: null, high_temp: 272.5 }],
      ["MoltenGold", { default_temp: 1100 }],
    ]);
    assert.ok(getDefaultElementTemp("Steam", customElements) > 99.35);
    assert.ok(getDefaultElementTemp("Ice", customElements) < -0.65);
    assert.strictEqual(getDefaultElementTemp("MoltenGold", customElements), 1100);
  });
});

describe("Stream Formatting & Unit Scaling", () => {
  it("formats stream lines in per-second mode with automatic unit scaling (g/s, Kg/s, T/s)", () => {
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
  });

  it("formats stream lines in per-cycle mode with automatic unit scaling", () => {
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
  });

  it("elides '(free)' state label for solid resources while retaining it for fluids", () => {
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
  });

  it("formats zero stream rate with unsigned zero, avoiding negative zero output", () => {
    const zeroLabor = formatStreamLine({ resource: "Duplicant Labor", rate: 0, unit: "s/s", state: "labor" }, false, "s");
    assert.strictEqual(zeroLabor, "Duplicant Labor: 0 s/s (labor)", "Zero stream rate must format with unsigned 0");

    const tinyLabor = formatStreamLine({ resource: "Duplicant Labor", rate: 0.000025, unit: "s/s", state: "labor" }, false, "s");
    assert.strictEqual(tinyLabor, "Duplicant Labor: 0 s/s (labor)", "Stream rate rounding to 0 must format with unsigned 0, never -0");
  });
});

describe("Net Resource Elision (Roundoff Handling)", () => {
  it("defines NET_RATE_EPSILON as 1e-4 (0.0001)", () => {
    assert.strictEqual(NET_RATE_EPSILON, 1e-4, "NET_RATE_EPSILON must be 1e-4 (0.0001)");
  });

  it("elides synthetic tiny inputs and outputs below NET_RATE_EPSILON", () => {
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
  });

  it("preserves legitimate small resources above NET_RATE_EPSILON", () => {
    // Gear Balm (0.0004167 balm/s)
    const bionicRow = { entityId: "bionic_duplicant", qty: 1, recipeId: "gear_balm", modifiers: [] };
    const bionicEval = evaluateRow(bionicRow, entityMap, elementMap);
    const bionicNet = calculateSystemNet([bionicEval], { elementMap });
    const balmIn = bionicNet.netInputs.find((i) => i.resource === "Gear Balm");
    assert.ok(balmIn, "Gear Balm (0.0004167 balm/s) is above NET_RATE_EPSILON and must NOT be elided");
    assert.strictEqual(balmIn.rate, 0.0004167);

    // Microchips (0.0005556 chips/s)
    const generatorRow = { entityId: "coal_generator", qty: 1, modifiers: ["engie_tuneup"] };
    const genEval = evaluateRow(generatorRow, entityMap, elementMap);
    const genNet = calculateSystemNet([genEval], { elementMap });
    const chipIn = genNet.netInputs.find((i) => i.resource === "Microchip");
    assert.ok(chipIn, "Microchip (0.0005556 chips/s) is above NET_RATE_EPSILON and must NOT be elided");
  });
});
