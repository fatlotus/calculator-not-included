/**
 * Test Suite: Thermal Propagation, Closed Loop Matching, and Meta-Machines.
 * Tests thermodynamic heat transfer, phase changes, thermal clamping,
 * closed-loop system balancing, and dynamic steam turbine simulations.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  resolveTableTemperatures,
  calculateSystemNet,
  calculateRowMatchTargets,
  applyHeatAndPhaseChange,
  getAbsorbHeatEntityName,
} from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import { getPresetById } from "../src/presets.js";

const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Thermal Propagation & Producer Averaging", () => {
  it("propagates feed temperatures from inputs through machines (Hydra SPOM)", () => {
    const hydra = getPresetById("hydra_spom");

    // A. Default 20 °C -> Electrolyzer outputs @ 70 °C, Gas Pump @ 70 °C
    const resolvedDefault = resolveTableTemperatures(hydra.rows, entityMap, elementMap, { loops: hydra.loops });
    const elResolved = resolvedDefault[1];
    const o2Out = elResolved.outputs.find((o) => o.resource === "Oxygen");
    const h2Out = elResolved.outputs.find((o) => o.resource === "Hydrogen");
    assert.strictEqual(o2Out.tempC, 70);
    assert.strictEqual(h2Out.tempC, 70);

    const gpResolved = resolvedDefault[2];
    assert.strictEqual(gpResolved.outputs[0].tempC, 70);

    // B. NET input Water set to 95 °C -> outputs @ 95 °C
    const resolved95 = resolveTableTemperatures(hydra.rows, entityMap, elementMap, {
      netInputTemps: { "Water||free": 95, "Water||in a pipe": 95 },
      loops: hydra.loops,
    });
    const wpResolved95 = resolved95[0];
    assert.strictEqual(wpResolved95.outputs[0].tempC, 95);
    const elResolved95 = resolved95[1];
    const o2Out95 = elResolved95.outputs.find((o) => o.resource === "Oxygen");
    const h2Out95 = elResolved95.outputs.find((o) => o.resource === "Hydrogen");
    assert.strictEqual(o2Out95.tempC, 95);
    assert.strictEqual(h2Out95.tempC, 95);
  });

  it("averages output temperatures correctly across multiple producers", () => {
    const customEntityMap = new Map([
      ["p1", { id: "p1", name: "P1", inputs: [], outputs: [{ resource: "Water", rate: 100, unit: "g/s", state: "in a pipe", temp: "@ 20 °C" }] }],
      ["p2", { id: "p2", name: "P2", inputs: [], outputs: [{ resource: "Water", rate: 300, unit: "g/s", state: "in a pipe", temp: "@ 60 °C" }] }],
      ["c1", { id: "c1", name: "C1", inputs: [{ resource: "Water", rate: 400, unit: "g/s", state: "in a pipe" }], outputs: [] }],
    ]);
    const rows = [{ entityId: "p1", qty: 1 }, { entityId: "p2", qty: 1 }, { entityId: "c1", qty: 1 }];
    const resolved = resolveTableTemperatures(rows, customEntityMap);
    // (100*20 + 300*60) / 400 = 50 °C
    assert.strictEqual(resolved[2].inputs[0].tempC, 50);
  });

  it("enforces strict pipe state matching (free vs piped)", () => {
    // Water Geyser produces free water; Electrolyzer consumes in-pipe water.
    // Without a pump, they do NOT cancel.
    const testRows = [
      { entityId: "geyser_water_geyser", qty: 1 },
      { entityId: "electrolyzer", qty: 1 },
    ];
    const evalTestRows = testRows.map((r) => evaluateRow(r, entityMap, elementMap));
    const testNet = calculateSystemNet(evalTestRows);
    const pipeWaterInput = testNet.netInputs.find((s) => s.resource === "Water" && s.state === "in a pipe");
    const freeWaterOutput = testNet.netOutputs.find((s) => s.resource === "Water" && s.state === "free");
    assert.ok(pipeWaterInput);
    assert.strictEqual(pipeWaterInput.rate, 1000);
    assert.ok(freeWaterOutput);
    assert.strictEqual(freeWaterOutput.rate, 3000);

    // Adding a liquid pump satisfies in-pipe water
    const pumpRows = [
      { entityId: "geyser_water_geyser", qty: 1 },
      { entityId: "liquid_pump", qty: 0.1, recipeId: "water" },
      { entityId: "electrolyzer", qty: 1 },
    ];
    const evalPumpRows = pumpRows.map((r) => evaluateRow(r, entityMap, elementMap));
    const pumpNet = calculateSystemNet(evalPumpRows);
    const matchedPipeInput = pumpNet.netInputs.find((s) => s.resource === "Water" && s.state === "in a pipe");
    const remainingFreeOutput = pumpNet.netOutputs.find((s) => s.resource === "Water" && s.state === "free");
    assert.strictEqual(matchedPipeInput, undefined);
    assert.strictEqual(remainingFreeOutput.rate, 2000);
  });
});

describe("Closed Loop Matching & Thermal Isolation", () => {
  it("passes inlet water temperature through Carbon Skimmer to Polluted Water output", () => {
    const csRow = { entityId: "carbon_skimmer", qty: 1 };
    const csInputsWithTemps = {
      "Water||in a pipe": 20.0,
      "Carbon Dioxide||in a pipe": 110.0,
    };
    const csEval = evaluateRow(csRow, entityMap, elementMap, 20.0, csInputsWithTemps);
    const pwOut = csEval.outputs.find((o) => o.resource === "Polluted Water");
    assert.ok(pwOut);
    assert.strictEqual(pwOut.tempC, 20.0, "Carbon skimmer Polluted Water output inherits inlet Water temp (20 °C)");
  });

  it("balances end-to-end 7-machine closed loop with 100% match precision and thermal stability", () => {
    const loopRows = [
      { entityId: "critter_stone_hatch", qty: 1, recipeId: "igneous_rock", modifiers: [], food: "calories" },
      { entityId: "coal_generator", qty: 1, recipeId: null, modifiers: [], food: "calories" },
      { entityId: "electric_grill", qty: 1, recipeId: "barbecue", modifiers: [], food: "calories" },
      { entityId: "duplicant", qty: 1, recipeId: null, modifiers: [], bathroom: "none", food: "barbecue" },
      { entityId: "gas_pump", qty: 1, recipeId: "carbon_dioxide", modifiers: [], food: "calories" },
      { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [], food: "calories" },
      { entityId: "water_sieve", qty: 1, recipeId: "sand", modifiers: [], food: "calories" },
    ];

    loopRows[0].qty = calculateRowMatchTargets(0, loopRows, entityMap)["out:Coal||free"].targetQty;
    loopRows[2].qty = calculateRowMatchTargets(2, loopRows, entityMap)["in:Meat||free"].targetQty;
    loopRows[3].qty = calculateRowMatchTargets(3, loopRows, entityMap)["in:Barbecue||free"].targetQty;
    loopRows[4].qty = calculateRowMatchTargets(4, loopRows, entityMap)["in:Carbon Dioxide||free"].targetQty;
    loopRows[5].qty = calculateRowMatchTargets(5, loopRows, entityMap)["in:Carbon Dioxide||in a pipe"].targetQty;
    loopRows[6].qty = calculateRowMatchTargets(6, loopRows, entityMap)["in:Polluted Water||in a pipe"].targetQty;

    const closedLoops = [
      { resource: "Water", state: "in a pipe", rate: 5000.0 * loopRows[6].qty, unit: "g/s", tempC: 20.0 },
      { resource: "Duplicant Labor", state: "labor", rate: 1.0 * loopRows[2].qty, unit: "s/s" },
    ];

    const evaluatedLoop = resolveTableTemperatures(loopRows, entityMap, elementMap, {}, { loops: closedLoops });
    const netLoop = calculateSystemNet(evaluatedLoop, { loops: closedLoops, elementMap });

    // Intermediate resources completely cancel
    for (const res of ["Coal", "Meat", "Barbecue", "Carbon Dioxide", "Water", "Polluted Water"]) {
      assert.strictEqual(netLoop.netInputs.find((i) => i.resource === res), undefined);
      assert.strictEqual(netLoop.netOutputs.find((o) => o.resource === res), undefined);
    }

    // Match targets report isMatched: true for intermediate loop streams
    const finalMatches0 = calculateRowMatchTargets(0, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches0["out:Coal||free"].isMatched, true);
    assert.strictEqual(finalMatches0["out:Meat||free"].isMatched, true);

    const finalMatches1 = calculateRowMatchTargets(1, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches1["in:Coal||free"].isMatched, true);
    assert.strictEqual(finalMatches1["out:Carbon Dioxide||free"].isMatched, true);

    const finalMatches2 = calculateRowMatchTargets(2, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches2["in:Meat||free"].isMatched, true);
    assert.strictEqual(finalMatches2["out:Barbecue||free"].isMatched, true);

    const finalMatches3 = calculateRowMatchTargets(3, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches3["in:Barbecue||free"].isMatched, true);
    assert.strictEqual(finalMatches3["out:Carbon Dioxide||free"].isMatched, true);

    const finalMatches4 = calculateRowMatchTargets(4, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches4["in:Carbon Dioxide||free"].isMatched, true);
    assert.strictEqual(finalMatches4["out:Carbon Dioxide||in a pipe"].isMatched, true);

    const finalMatches5 = calculateRowMatchTargets(5, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches5["in:Water||in a pipe"].isMatched, true);
    assert.strictEqual(finalMatches5["in:Carbon Dioxide||in a pipe"].isMatched, true);
    assert.strictEqual(finalMatches5["out:Polluted Water||in a pipe"].isMatched, true);

    const finalMatches6 = calculateRowMatchTargets(6, loopRows, entityMap, { loops: closedLoops });
    assert.strictEqual(finalMatches6["in:Polluted Water||in a pipe"].isMatched, true);
    assert.strictEqual(finalMatches6["out:Water||in a pipe"].isMatched, true);

    // Water loop thermal stability
    const csWaterIn = evaluatedLoop[5].inputs.find((i) => i.resource === "Water");
    const csPwOut = evaluatedLoop[5].outputs.find((o) => o.resource === "Polluted Water");
    assert.strictEqual(Math.round(csWaterIn.tempC * 10) / 10, 20.0);
    assert.strictEqual(Math.round(csPwOut.tempC * 10) / 10, 20.0);
  });

  it("enforces top-to-bottom order sensitivity without loops", () => {
    // Placing consumer above producer without loop leaves both in net
    const reversedCoalRows = [
      evaluateRow({ entityId: "coal_generator", qty: 1 }, entityMap, elementMap),
      evaluateRow({ entityId: "critter_stone_hatch", qty: 8.5714, recipeId: "igneous_rock" }, entityMap, elementMap),
    ];
    const reversedNet = calculateSystemNet(reversedCoalRows);
    assert.ok(reversedNet.netInputs.some((i) => i.resource === "Coal"));
    assert.ok(reversedNet.netOutputs.some((o) => o.resource === "Coal"));
  });
});

describe("Meta-Machines: Absorb Heat & Phase Change", () => {
  it("dynamically generates entity label based on material phase", () => {
    assert.strictEqual(getAbsorbHeatEntityName("Water", elementMap), "Absorb heat into liquid");
    assert.strictEqual(getAbsorbHeatEntityName("Oxygen", elementMap), "Absorb heat into gas");
    assert.strictEqual(getAbsorbHeatEntityName("Dirt", elementMap), "Absorb heat into solid");
    assert.strictEqual(getAbsorbHeatEntityName("Sand", elementMap), "Absorb heat into solid");
    assert.strictEqual(getAbsorbHeatEntityName("Molten Iron", elementMap), "Absorb heat into liquid");

    const evWater = evaluateRow({ entityId: "absorb_heat", qty: 1, material: "Water" }, entityMap, elementMap);
    assert.strictEqual(evWater.entity.name, "Absorb heat into liquid");
  });

  it("performs sensible heating without phase change", () => {
    // 1000 g/s Water @ 20 °C absorbing 10 kDTU/s: deltaT = 10000 / (1000 * 4.179) = 2.3929 °C -> 22.39 °C
    const sensibleOut = applyHeatAndPhaseChange("Water", 1000, 20, 10, "in a pipe", elementMap);
    assert.strictEqual(sensibleOut.length, 1);
    assert.strictEqual(sensibleOut[0].resource, "Water");
    assert.strictEqual(sensibleOut[0].rate, 1000);
    assert.strictEqual(sensibleOut[0].state, "in a pipe");
    assert.strictEqual(Math.round(sensibleOut[0].tempC * 100) / 100, 22.39);
  });

  it("simulates high-temp phase changes (Water, Polluted Water, Crude Oil, Dirt, Polluted Dirt)", () => {
    // Water -> Steam @ 139.65 °C (transitions to free)
    const waterBoil = applyHeatAndPhaseChange("Water", 1000, 20, 500, "in a pipe", elementMap);
    assert.strictEqual(waterBoil.length, 1);
    assert.strictEqual(waterBoil[0].resource, "Steam");
    assert.strictEqual(waterBoil[0].rate, 1000);
    assert.strictEqual(waterBoil[0].state, "free");
    assert.strictEqual(Math.round(waterBoil[0].tempC * 100) / 100, 139.65);

    // Polluted Water -> 99% Steam + 1% Dirt with 100% mass conservation
    const pwBoil = applyHeatAndPhaseChange("Polluted Water", 1000, 20, 500, "in a pipe", elementMap);
    assert.strictEqual(pwBoil.length, 2);
    const pwSteam = pwBoil.find((o) => o.resource === "Steam");
    const pwDirt = pwBoil.find((o) => o.resource === "Dirt");
    assert.strictEqual(pwSteam.rate, 990);
    assert.strictEqual(pwDirt.rate, 10);
    assert.strictEqual(pwSteam.rate + pwDirt.rate, 1000);
    assert.strictEqual(Math.round(pwSteam.tempC * 100) / 100, 139.78);

    // Crude Oil -> Petroleum
    const oilBoil = applyHeatAndPhaseChange("Crude Oil", 10000, 370, 600, "free", elementMap);
    assert.strictEqual(oilBoil[0].resource, "Petroleum");
    assert.strictEqual(Math.round(oilBoil[0].tempC * 100) / 100, 405.28);

    // Dirt heats into Sand at 326.85 °C (NOT Glass!)
    const dirtTrans = applyHeatAndPhaseChange("Dirt", 1000, 20, 600, "free", elementMap);
    assert.strictEqual(dirtTrans[0].resource, "Sand");

    // Polluted Dirt heats into Molten Glass at 1712.85 °C
    const pdTrans = applyHeatAndPhaseChange("Polluted Dirt", 1000, 20, 1450, "free", elementMap);
    assert.strictEqual(pdTrans[0].resource, "Molten Glass");

    // Multi-stage high-temp transition: Polluted Dirt -> Molten Glass -> Rock Gas (> 2356.85 °C)
    const pdMultiTrans = applyHeatAndPhaseChange("Polluted Dirt", 1000, 20, 2000, "free", elementMap);
    assert.strictEqual(pdMultiTrans[0].resource, "Rock Gas");
  });
});

describe("Meta-Machines: Counterflow Heat Exchanger", () => {
  it("calculates heat transfer between hot and cold streams", () => {
    const rowExchanger = {
      entityId: "counterflow_heat_exchanger",
      qty: 5,
      material: "Petroleum",
      materialState: "free",
      coldMaterial: "Crude Oil",
      coldMaterialState: "in a pipe",
    };
    const evExchanger = evaluateRow(
      rowExchanger,
      entityMap,
      elementMap,
      20.0,
      { "Petroleum||free": 400, "Crude Oil||in a pipe": 100 }
    );
    assert.strictEqual(evExchanger.heat, 0);
    assert.strictEqual(evExchanger.power, 0);

    const petOut = evExchanger.outputs.find((o) => o.resource === "Petroleum");
    const oilOut = evExchanger.outputs.find((o) => o.resource === "Crude Oil");
    assert.strictEqual(Math.round(petOut.tempC * 100) / 100, 371.59);
    assert.strictEqual(Math.round(oilOut.tempC * 100) / 100, 129.59);
  });

  it("enforces thermodynamic clamping preventing stream temperatures from crossing", () => {
    const rowHuge = {
      entityId: "counterflow_heat_exchanger",
      qty: 5000,
      material: "Petroleum",
      materialState: "free",
      coldMaterial: "Crude Oil",
      coldMaterialState: "in a pipe",
    };
    const evHuge = evaluateRow(
      rowHuge,
      entityMap,
      elementMap,
      20.0,
      { "Petroleum||free": 400, "Crude Oil||in a pipe": 100 }
    );
    const hotOutClamped = evHuge.outputs[0];
    const coldOutClamped = evHuge.outputs[1];

    assert.ok(coldOutClamped.tempC <= 400.0 + 1e-4);
    assert.ok(hotOutClamped.tempC >= 100.0 - 1e-4);
    assert.strictEqual(Math.round(hotOutClamped.tempC * 100) / 100, 111.93);
    assert.strictEqual(Math.round(coldOutClamped.tempC * 100) / 100, 400);
  });

  it("calculates heat match target Q_max for counterflow heat exchanger", () => {
    const rowExchanger = {
      entityId: "counterflow_heat_exchanger",
      qty: 5,
      material: "Petroleum",
      materialState: "free",
      coldMaterial: "Crude Oil",
      coldMaterialState: "in a pipe",
    };
    const matchTargets = calculateRowMatchTargets(0, [rowExchanger], entityMap, {
      elementMap,
      netInputTemps: { "Petroleum||free": 400, "Crude Oil||in a pipe": 100 },
    });
    assert.ok(matchTargets["out:Heat"], "Counterflow heat exchanger must provide heat match target for Q_max");
    // Q_max = (400 - 100) * 1690 / 1000 = 507.0 kDTU/s -> targetQty = 50.70x
    assert.strictEqual(Math.round(matchTargets["out:Heat"].targetQty * 100) / 100, 50.7);
  });
});

describe("Meta-Machines: Dynamic Steam Turbine", () => {
  it("produces 0 W below minimum operating threshold (< 125 °C)", () => {
    const evCold = evaluateRow({ entityId: "steam_turbine", qty: 1, inputTemp: 100 }, entityMap, elementMap);
    assert.strictEqual(evCold.power, 0);
    assert.strictEqual(evCold.heat, 0);
  });

  it("simulates dynamic power and heat at 125 °C and 200 °C", () => {
    // 125 °C
    const ev125 = evaluateRow({ entityId: "steam_turbine", qty: 1, inputTemp: 125 }, entityMap, elementMap);
    assert.strictEqual(Math.round(ev125.power * 100) / 100, 242.86);
    assert.strictEqual(Math.round(ev125.heat * 100) / 100, 29.07);
    assert.strictEqual(ev125.outputs[0].resource, "Water");
    assert.strictEqual(ev125.outputs[0].tempC, 95);

    // 200 °C
    const ev200 = evaluateRow({ entityId: "steam_turbine", qty: 1, inputTemp: 200 }, entityMap, elementMap);
    assert.strictEqual(ev200.power, 850);
    assert.strictEqual(Math.round(ev200.heat * 100) / 100, 91.76);
  });

  it("caps electrical power at 850 W at 500 °C while heat emission rises", () => {
    const ev500 = evaluateRow({ entityId: "steam_turbine", qty: 1, inputTemp: 500 }, entityMap, elementMap);
    assert.strictEqual(ev500.power, 850);
    assert.strictEqual(Math.round(ev500.heat * 100) / 100, 342.50);
  });

  it("boosts turbine electrical output by +50% with Engie's Tune-Up", () => {
    const evTuneUp = evaluateRow(
      { entityId: "steam_turbine", qty: 1, inputTemp: 200, modifiers: ["engie_tuneup"] },
      entityMap,
      elementMap
    );
    assert.strictEqual(evTuneUp.power, 1275);
  });

  it("integrates boiler with steam turbine in resolveTableTemperatures", () => {
    const systemRows = [
      { entityId: "absorb_heat", qty: 150.444, material: "Water", materialState: "free", rate: 2000 },
      { entityId: "steam_turbine", qty: 1 },
    ];
    const evalSystem = resolveTableTemperatures(systemRows, entityMap, elementMap);
    assert.strictEqual(Math.round(evalSystem[0].outputs[0].tempC), 200);
    assert.strictEqual(evalSystem[1].inputs[0].resource, "Steam");
    assert.strictEqual(Math.round(evalSystem[1].inputs[0].tempC), 200);
    assert.strictEqual(Math.round(evalSystem[1].power), 850);
  });
});
