/**
 * Test Suite: Built-in Presets and System Balances.
 * Tests preset configurations, fractional ratios, closed loops,
 * and full system resource balance calculations.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { ONI_DATASET } from "../src/dataset.js";
import { evaluateRow, resolveTableTemperatures, calculateSystemNet, calculateRowMatchTargets } from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import { PRESETS, getPresetById } from "../src/presets.js";

const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Presets & System Balances", () => {
  it("verifies built-in preset definitions exist", () => {
    assert.ok(PRESETS.length >= 5, "Should have at least 5 presets defined");
    for (const preset of PRESETS) {
      assert.ok(preset.id, "Preset must have an id");
      assert.ok(preset.name, "Preset must have a name");
      assert.ok(Array.isArray(preset.rows), "Preset must have rows array");
    }
  });

  it("evaluates Hydra SPOM preset net balance and match targets", () => {
    const hydra = getPresetById("hydra_spom");
    assert.strictEqual(hydra.name, "Hydra SPOM");
    assert.strictEqual(hydra.rows.length, 5);

    const evaluatedHydra = resolveTableTemperatures(hydra.rows, entityMap, elementMap, {
      netInputTemps: hydra.netInputTemps,
    });
    const net = calculateSystemNet(evaluatedHydra, {
      elementMap,
      netInputTemps: hydra.netInputTemps,
    });

    assert.strictEqual(net.netPower, 698.24);
    assert.strictEqual(net.netBuildingHeat, 6.38);
    assert.strictEqual(net.netInputs.length, 2);

    const freeWaterIn = net.netInputs.find((i) => i.resource === "Water" && i.state === "free");
    const pipeWaterIn = net.netInputs.find((i) => i.resource === "Water" && i.state === "in a pipe");
    assert.strictEqual(freeWaterIn.rate, 1000);
    assert.strictEqual(Math.round(pipeWaterIn.rate * 100) / 100, 66.67);

    assert.strictEqual(net.netOutputs.length, 4);
    assert.strictEqual(net.netOutputs.find((o) => o.resource === "Oxygen").rate, 88);
    assert.strictEqual(net.netOutputs.find((o) => o.resource === "Duplicant Labor").rate, 6);
    assert.strictEqual(net.netOutputs.find((o) => o.resource === "Carbon Dioxide").rate, 16);
    assert.strictEqual(net.netOutputs.find((o) => o.resource === "Polluted Water").rate, 156);

    // Match targets for Gas Pump (index 2)
    const matches = calculateRowMatchTargets(2, hydra.rows, entityMap, {
      elementMap,
      netInputTemps: hydra.netInputTemps,
      evaluatedRows: evaluatedHydra,
    });
    assert.strictEqual(matches["in:Hydrogen||free"].isMatched, true);
    assert.strictEqual(matches["in:Hydrogen||free"].targetQty, 0.224);
    assert.strictEqual(matches["out:Hydrogen||in a pipe"].isMatched, true);
  });

  it("evaluates Oil Refinery + Petroleum Loop preset and verifies labor roundoff elision", () => {
    const oilPreset = getPresetById("oil_refinery_petroleum_loop");
    assert.ok(oilPreset);
    assert.strictEqual(oilPreset.rows.length, 6);

    const evalOil = resolveTableTemperatures(oilPreset.rows, entityMap, elementMap, {
      netInputTemps: oilPreset.netInputTemps,
    });
    const oilNet = calculateSystemNet(evalOil, {
      elementMap,
      netInputTemps: oilPreset.netInputTemps,
    });

    assert.ok(oilNet.netPower > 5000, "Power plant should produce > 5000 W net");

    // Duplicant labor roundoff residual (-0.000025 s/s) is elided
    assert.strictEqual(oilNet.netInputs.find((i) => i.resource === "Duplicant Labor"), undefined);
    assert.strictEqual(oilNet.netOutputs.find((o) => o.resource === "Duplicant Labor"), undefined);

    // Legitimate inputs remain
    assert.ok(oilNet.netInputs.some((i) => i.resource === "Crude Oil"));
    assert.ok(oilNet.netInputs.some((i) => i.resource === "Oxygen"));
    assert.ok(oilNet.netInputs.some((i) => i.resource === "Water"));
  });

  it("evaluates Glossy Drecko Plastic preset (Growth cancels out completely)", () => {
    const dreckoPreset = getPresetById("glossy_drecko_plastic");
    assert.ok(dreckoPreset);
    assert.strictEqual(dreckoPreset.rows.length, 2);

    const evalDrecko = resolveTableTemperatures(dreckoPreset.rows, entityMap, elementMap, {
      netInputTemps: dreckoPreset.netInputTemps,
    });
    const dreckoNet = calculateSystemNet(evalDrecko, {
      elementMap,
      netInputTemps: dreckoPreset.netInputTemps,
    });

    const plasticOut = dreckoNet.netOutputs.find((o) => o.resource === "Plastic");
    assert.ok(plasticOut);
    assert.ok(plasticOut.rate > 80);

    // Net growth completely cancelled
    assert.strictEqual(dreckoNet.netInputs.find((i) => i.resource === "Growth"), undefined);
    assert.strictEqual(dreckoNet.netOutputs.find((o) => o.resource === "Growth"), undefined);

    // Net inputs require in-pipe Water, outputs Phosphorite
    assert.ok(dreckoNet.netInputs.some((i) => i.resource === "Water" && i.state === "in a pipe"));
    assert.ok(dreckoNet.netOutputs.some((o) => o.resource === "Phosphorite"));
  });

  it("evaluates Regular Drecko Balm Lily preset (Zero-Resource Reed Fiber)", () => {
    const regularDreckoPreset = getPresetById("drecko_reed_fiber_balm_lily");
    assert.ok(regularDreckoPreset);
    assert.strictEqual(regularDreckoPreset.rows.length, 2);

    const evalRegularDrecko = resolveTableTemperatures(regularDreckoPreset.rows, entityMap, elementMap, {
      netInputTemps: regularDreckoPreset.netInputTemps,
    });
    const regularDreckoNet = calculateSystemNet(evalRegularDrecko, {
      elementMap,
      netInputTemps: regularDreckoPreset.netInputTemps,
    });

    const reedFiberOut = regularDreckoNet.netOutputs.find((o) => o.resource === "Reed Fiber");
    assert.ok(reedFiberOut);
    assert.ok(reedFiberOut.rate > 0.4);
    assert.ok(regularDreckoNet.netOutputs.some((o) => o.resource === "Phosphorite"));

    // Balm Lily requires 0 inputs and growth cancels -> 0 net inputs
    assert.strictEqual(regularDreckoNet.netInputs.length, 0);
  });

  it("evaluates Coal Generator + Carbon Skimmer Loop preset", () => {
    const coalPreset = getPresetById("coal_skimmer_loop");
    assert.ok(coalPreset);
    assert.strictEqual(coalPreset.rows.length, 4);

    const evalCoal = resolveTableTemperatures(coalPreset.rows, entityMap, elementMap, {
      netInputTemps: coalPreset.netInputTemps,
    });
    const coalNet = calculateSystemNet(evalCoal, {
      elementMap,
      netInputTemps: coalPreset.netInputTemps,
    });

    assert.strictEqual(coalNet.netPower, 8712);
    // Intermediate resources cancel out
    assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Carbon Dioxide"), undefined);
    assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Carbon Dioxide"), undefined);
    assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Water"), undefined);
    assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Water"), undefined);
    assert.strictEqual(coalNet.netOutputs.find((o) => o.resource === "Polluted Water"), undefined);
    assert.strictEqual(coalNet.netInputs.find((i) => i.resource === "Polluted Water"), undefined);
  });

  it("evaluates Arbor Tree Ethanol Power Loop preset", () => {
    const arborPreset = getPresetById("arbor_ethanol_loop");
    assert.ok(arborPreset);
    assert.strictEqual(arborPreset.rows.length, 5);

    const evalArbor = resolveTableTemperatures(arborPreset.rows, entityMap, elementMap, {
      netInputTemps: arborPreset.netInputTemps,
    });
    const arborNet = calculateSystemNet(evalArbor, {
      elementMap,
      netInputTemps: arborPreset.netInputTemps,
    });
    assert.strictEqual(arborNet.netOutputs.find((o) => o.resource === "Carbon Dioxide" && o.state === "in a pipe"), undefined);
  });

  it("evaluates Natural Gas Geyser Power preset (fractional ratios)", () => {
    const ngPreset = getPresetById("natural_gas_geyser_power");
    assert.ok(ngPreset);
    assert.strictEqual(ngPreset.rows.length, 3);

    const evalNG = resolveTableTemperatures(ngPreset.rows, entityMap, elementMap, {
      netInputTemps: ngPreset.netInputTemps,
    });
    const ngNet = calculateSystemNet(evalNG, {
      elementMap,
      netInputTemps: ngPreset.netInputTemps,
    });

    assert.ok(ngNet.netPower > 850);
    assert.strictEqual(ngNet.netOutputs.find((o) => o.resource === "Natural Gas" && o.state === "free"), undefined);
    assert.strictEqual(ngNet.netOutputs.find((o) => o.resource === "Natural Gas" && o.state === "in a pipe"), undefined);

    const ngGasIn = ngNet.netInputs.find((i) => i.resource === "Natural Gas");
    const ngGasInRate = ngGasIn ? ngGasIn.rate : 0;
    assert.ok(ngGasInRate < 0.01);
  });

  it("evaluates Industrial Sauna preset and verifies automated heat and water loops", () => {
    const saunaPreset = getPresetById("industrial_sauna");
    assert.ok(saunaPreset);
    assert.strictEqual(saunaPreset.rows.length, 6);

    const evalSauna = resolveTableTemperatures(saunaPreset.rows, entityMap, elementMap, {
      netInputTemps: saunaPreset.netInputTemps,
    });
    const saunaNet = calculateSystemNet(evalSauna, {
      elementMap,
      netInputTemps: saunaPreset.netInputTemps,
    });

    assert.ok(evalSauna._loops.some((l) => l.resource === "Polluted Water"));
    assert.ok(evalSauna._loops.some((l) => l.resource === "Water"));
    assert.strictEqual(saunaNet.netInputs.find((i) => i.resource === "Polluted Water"), undefined);
  });

  it("evaluates Petroleum Boiler preset and verifies automated petroleum counterflow loop", () => {
    const boilerPreset = getPresetById("petroleum_boiler");
    assert.ok(boilerPreset);
    assert.strictEqual(boilerPreset.rows.length, 3);

    const evalBoiler = resolveTableTemperatures(boilerPreset.rows, entityMap, elementMap, {
      netInputTemps: boilerPreset.netInputTemps,
    });
    const boilerNet = calculateSystemNet(evalBoiler, {
      elementMap,
      netInputTemps: boilerPreset.netInputTemps,
    });

    const petLoop = evalBoiler._loops.find((l) => l.resource === "Petroleum");
    assert.ok(petLoop, "Must auto-loop petroleum at 405 °C");
    assert.strictEqual(Math.round(petLoop.tempC), 405);
    assert.strictEqual(boilerNet.netInputs.find((i) => i.resource === "Petroleum"), undefined);
    assert.strictEqual(boilerNet.netInputs.find((i) => i.resource === "Crude Oil").rate, 10000);
  });

  it("evaluates Research Reactor Power Plant preset and verifies heat, steam, power, and closed water loop", () => {
    const rxPreset = getPresetById("research_reactor_power");
    assert.ok(rxPreset, "research_reactor_power preset must exist");
    assert.strictEqual(rxPreset.rows.length, 3);

    const evalRx = resolveTableTemperatures(rxPreset.rows, entityMap, elementMap, {
      netInputTemps: rxPreset.netInputTemps,
    });
    const rxNet = calculateSystemNet(evalRx, {
      elementMap,
      netInputTemps: rxPreset.netInputTemps,
    });

    // 5x Steam Turbines @ 237.98 °C produce 5 * 850 = 4250 W
    assert.strictEqual(rxNet.netPower, 4250);

    // Water is automatically closed-loop at 95 °C (10 kg/s)
    const waterLoop = evalRx._loops.find((l) => l.resource === "Water" && l.state === "in a pipe");
    assert.ok(waterLoop, "Water stream must automatically loop");
    assert.strictEqual(waterLoop.rate, 10000);
    assert.strictEqual(waterLoop.tempC, 95);
    assert.strictEqual(rxNet.netInputs.find((i) => i.resource === "Water"), undefined);

    // Fuel input and waste output
    const uIn = rxNet.netInputs.find((i) => i.resource === "Enriched Uranium");
    assert.ok(uIn, "Must have Enriched Uranium net input");
    assert.strictEqual(uIn.rate, 16.6667);

    const wasteOut = rxNet.netOutputs.find((o) => o.resource === "Liquid Nuclear Waste");
    assert.ok(wasteOut, "Must have Liquid Nuclear Waste net output");
    assert.strictEqual(wasteOut.rate, 1666.67);
  });
});
