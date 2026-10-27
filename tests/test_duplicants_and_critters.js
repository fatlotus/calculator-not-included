/**
 * Test Suite: Duplicants, Critters, and Food Chains.
 * Tests regular duplicant bathroom options and diets, bionic duplicant augmentations and fuels,
 * non-thermal resources (Labor, Calories, Growth), critter yields, and food chain balance.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  calculateSystemNet,
  formatStreamLine,
} from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";

const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Regular Duplicants: Bathrooms & Breathing", () => {
  it("evaluates default / plumbed bathroom and exhaled CO2", () => {
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
  });

  it("evaluates outhouse bathroom option (Dirt input, Polluted Dirt output)", () => {
    const outhouseRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "outhouse" }, entityMap, elementMap);
    const oDirtIn = outhouseRow.inputs.find((i) => i.resource === "Dirt" && i.state === "free");
    const oPollutedDirtOut = outhouseRow.outputs.find((o) => o.resource === "Polluted Dirt" && o.state === "free");

    assert.ok(oDirtIn, "Outhouse duplicant must consume free dirt");
    assert.strictEqual(oDirtIn.rate, 21.6667);
    assert.ok(oPollutedDirtOut, "Outhouse duplicant must produce free polluted dirt");
    assert.strictEqual(oPollutedDirtOut.rate, 32.8333);
  });

  it("evaluates floor bathroom option (produces free Polluted Water with zero inputs)", () => {
    const floorRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "floor" }, entityMap, elementMap);
    const fPollutedWaterOut = floorRow.outputs.find((o) => o.resource === "Polluted Water" && o.state === "free");

    assert.strictEqual(floorRow.inputs.some((i) => i.resource === "Water" || i.resource === "Dirt"), false);
    assert.ok(fPollutedWaterOut, "Floor peeing must produce free polluted water");
    assert.strictEqual(fPollutedWaterOut.rate, 11.1667);
  });

  it("evaluates none (external) bathroom option (zero bathroom inputs and outputs)", () => {
    const noneRow = evaluateRow({ entityId: "duplicant", qty: 1, bathroom: "none" }, entityMap, elementMap);
    assert.strictEqual(noneRow.inputs.some((i) => i.resource === "Water" || i.resource === "Dirt"), false);
    assert.strictEqual(noneRow.outputs.some((o) => o.resource === "Polluted Water" || o.resource === "Polluted Dirt"), false);
  });

  it("scales oxygen consumption and exhaled CO2 with Diver's Lungs modifier (-25%)", () => {
    const dupBase = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: [] }, entityMap, elementMap);
    const dupMod = evaluateRow({ entityId: "duplicant", qty: 1, modifiers: ["divers_lungs"] }, entityMap, elementMap);
    assert.strictEqual(dupBase.inputs[0].rate, 100);
    assert.strictEqual(dupMod.inputs[0].rate, 75);

    const co2Base = dupBase.outputs.find((o) => o.resource === "Carbon Dioxide");
    const co2Mod = dupMod.outputs.find((o) => o.resource === "Carbon Dioxide");
    assert.ok(co2Base);
    assert.strictEqual(co2Base.rate, 2.0);
    assert.strictEqual(co2Mod.rate, 1.5, "Diver's Lungs scales CO2 output to 1.5 g/s");
  });
});

describe("Duplicant Diets & Food", () => {
  it("evaluates barbecue diet replacing generic Calories", () => {
    const bbqRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "barbecue" }, entityMap, elementMap);
    const bbqIn = bbqRow.inputs.find((i) => i.resource === "Barbecue");
    assert.ok(bbqIn, "Duplicant eating Barbecue must consume Barbecue");
    assert.strictEqual(bbqIn.rate, 0.4167, "Duplicant consumes 0.4167 g/s Barbecue (250 g/cycle = 1000 kcal)");
    assert.strictEqual(bbqRow.inputs.find((i) => i.resource === "Calories"), undefined, "Eating Barbecue removes generic Calories input");
  });

  it("evaluates cooked seafood diet", () => {
    const seafoodRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "cooked_seafood" }, entityMap, elementMap);
    const seafoodIn = seafoodRow.inputs.find((i) => i.resource === "Cooked Seafood");
    assert.ok(seafoodIn, "Duplicant eating Cooked Seafood must consume Cooked Seafood");
    assert.strictEqual(seafoodIn.rate, 1.0417, "Duplicant consumes 1.0417 g/s Cooked Seafood (625 g/cycle = 1000 kcal)");
  });

  it("evaluates fasting duplicant with no food and no calorie input", () => {
    const fastingRow = evaluateRow({ entityId: "duplicant", qty: 1, food: "none" }, entityMap, elementMap);
    assert.strictEqual(fastingRow.inputs.find((i) => i.resource === "Barbecue" || i.resource === "Calories"), undefined);
  });

  it("scales food consumption by 1.5x with bottomless stomach modifier", () => {
    const bottomlessBbq = evaluateRow(
      { entityId: "duplicant", qty: 1, food: "barbecue", modifiers: ["bottomless_stomach"] },
      entityMap,
      elementMap
    );
    const bBbqIn = bottomlessBbq.inputs.find((i) => i.resource === "Barbecue");
    assert.ok(bBbqIn);
    assert.strictEqual(Math.round(bBbqIn.rate * 10000) / 10000, 0.6251);
  });
});

describe("Bionic Duplicants", () => {
  it("evaluates default crude oil fuel recipe", () => {
    const crudeEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "crude_oil" }, entityMap, elementMap);
    const crudeIn = crudeEval.inputs.find((i) => i.resource === "Crude Oil");
    assert.ok(crudeIn, "Default Bionic should consume Crude Oil");
    assert.strictEqual(crudeIn.rate, 33.33);
  });

  it("evaluates gear balm and tallow gear balm fuel recipes", () => {
    const balmEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "gear_balm" }, entityMap, elementMap);
    const balmIn = balmEval.inputs.find((i) => i.resource === "Gear Balm");
    assert.ok(balmIn);
    assert.strictEqual(balmIn.rate, 0.0004167);
    assert.strictEqual(balmIn.unit, "balm/s");

    const tallowEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, recipeId: "tallow_gear_balm" }, entityMap, elementMap);
    const tallowIn = tallowEval.inputs.find((i) => i.resource === "Tallow Gear Balm");
    assert.ok(tallowIn);
    assert.strictEqual(tallowIn.rate, 0.0004167);
    assert.strictEqual(tallowIn.unit, "balm/s");
  });

  it("evaluates defragmentation modifier producing microchips", () => {
    const defragEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["defragment"] }, entityMap, elementMap);
    const chipOut = defragEval.outputs.find((o) => o.resource === "Microchip");
    assert.ok(chipOut, "Defragment modifier should produce Microchips");
    assert.strictEqual(chipOut.rate, 0.00055, "Defragment rate should be 0.00055 chips/s (0.33 chips/cycle)");
    assert.strictEqual(formatStreamLine(chipOut, true, "c"), "Microchip: +0.33 chips/cycle (solid)");
  });

  it("evaluates bionic diver's lungs and confirms bionics consume no calories", () => {
    const dlEval = evaluateRow({ entityId: "bionic_duplicant", qty: 1, modifiers: ["divers_lungs"] }, entityMap, elementMap);
    const o2In = dlEval.inputs.find((i) => i.resource === "Oxygen");
    assert.strictEqual(o2In.rate, 75.0);

    const bionicBase = evaluateRow({ entityId: "bionic_duplicant", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(bionicBase.inputs.find((i) => i.resource === "Calories"), undefined, "Bionics must never consume calories");
  });
});

describe("Non-Thermal Resources & Food Chains", () => {
  it("verifies Duplicant Labor, Calories, and Plant Growth have no temperature", () => {
    const evaluatedDupe = evaluateRow({ entityId: "duplicant", qty: 1 }, entityMap, elementMap);

    const calIn = evaluatedDupe.inputs.find((i) => i.resource === "Calories");
    assert.ok(calIn);
    assert.strictEqual(calIn.tempC, undefined);
    assert.strictEqual(calIn.temp, null);
    const calText = formatStreamLine(calIn, false, "c");
    assert.strictEqual(calText.includes("°C"), false);
    assert.strictEqual(calText, "Calories: -1000.02 kcal/cycle (free)");

    const laborOut = evaluatedDupe.outputs.find((o) => o.resource === "Duplicant Labor");
    assert.ok(laborOut);
    assert.strictEqual(laborOut.tempC, undefined);
    assert.strictEqual(laborOut.temp, null);
    const laborText = formatStreamLine(laborOut, true, "s");
    assert.strictEqual(laborText.includes("°C"), false);
    assert.strictEqual(laborText, "Duplicant Labor: +0.75 s/s (labor)");

    const evaluatedMealwoodGrowth = evaluateRow({ entityId: "plant_mealwood", qty: 1, recipeId: "growth" }, entityMap, elementMap);
    const growthOut = evaluatedMealwoodGrowth.outputs.find((o) => o.resource === "Growth");
    assert.ok(growthOut);
    assert.strictEqual(growthOut.rate, 1.0);
    assert.strictEqual(growthOut.tempC, undefined);
    assert.strictEqual(growthOut.temp, null);
    assert.strictEqual(formatStreamLine(growthOut, true, "s"), "Growth: +1 growth/s (free)");
  });

  it("verifies Drecko-harvestable plants output Growth and Drecko critters consume Growth", () => {
    for (const plantId of ["plant_mealwood", "plant_bristle_blossom", "plant_balm_lily", "plant_pincha_pepper"]) {
      const plant = entityMap.get(plantId);
      assert.ok(plant);
      assert.ok(plant.recipes && plant.recipes.length >= 2);
      const gRec = plant.recipes.find((r) => r.id === "growth");
      assert.ok(gRec);
      assert.ok(gRec.outputs.some((o) => o.resource === "Growth" && o.rate === 1.0));
    }

    for (const critterId of ["critter_drecko", "critter_glossy_drecko"]) {
      const critter = entityMap.get(critterId);
      assert.ok(critter);
      for (const r of critter.recipes) {
        assert.ok(r.inputs.some((i) => i.resource === "Growth" && i.rate === 1.0));
      }
    }
  });

  it("evaluates critter meat and pacu fillet production rates", () => {
    const evalHatch = evaluateRow({ entityId: "critter_hatch", qty: 1 }, entityMap, elementMap);
    const hatchMeat = evalHatch.outputs.find((o) => o.resource === "Meat");
    assert.ok(hatchMeat);
    assert.strictEqual(hatchMeat.rate, 0.5556, "Hatch produces 0.5556 g/s Meat");

    const evalPacu = evaluateRow({ entityId: "critter_pacu", qty: 1 }, entityMap, elementMap);
    const pacuFillet = evalPacu.outputs.find((o) => o.resource === "Pacu Fillet");
    assert.ok(pacuFillet);
    assert.strictEqual(pacuFillet.rate, 1.1111, "Pacu produces 1.1111 g/s Pacu Fillet");

    const evalVole = evaluateRow({ entityId: "critter_shove_vole", qty: 1 }, entityMap, elementMap);
    const voleMeat = evalVole.outputs.find((o) => o.resource === "Meat");
    assert.ok(voleMeat);
    assert.strictEqual(voleMeat.rate, 2.7778, "Shove Vole produces 2.7778 g/s Meat");

    const evalWildHatch = evaluateRow({ entityId: "critter_hatch", qty: 1, modifiers: ["wild"] }, entityMap, elementMap);
    const wildMeat = evalWildHatch.outputs.find((o) => o.resource === "Meat");
    assert.strictEqual(Math.round(wildMeat.rate * 10000) / 10000, 0.1389);
  });

  it("ensures all food-cooking buildings require Duplicant Labor across all recipes", () => {
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
  });

  it("balances end-to-end Ranch -> Grill -> Duplicant food chain", () => {
    // 12 Stone Hatches produce 12 * 0.5556 = 6.6672 g/s Meat
    // 0.16668 Electric Grills consume 0.16668 * 40 = 6.6672 g/s Meat and produce 3.3336 g/s Barbecue
    // 8 Duplicants consume 8 * 0.4167 = 3.3336 g/s Barbecue
    const evalHatches12 = evaluateRow({ entityId: "critter_stone_hatch", qty: 12, recipeId: "igneous_rock" }, entityMap, elementMap);
    const evalGrillMatched = evaluateRow({ entityId: "electric_grill", qty: 0.16668, recipeId: "barbecue" }, entityMap, elementMap);
    const evalDupes8 = evaluateRow({ entityId: "duplicant", qty: 8, food: "barbecue" }, entityMap, elementMap);

    const foodNet = calculateSystemNet([evalHatches12, evalGrillMatched, evalDupes8], {
      loops: [{ resource: "Duplicant Labor", state: "labor", rate: 0.16668, unit: "s/s" }],
    });

    const netMeatRemain = foodNet.netInputs.find((i) => i.resource === "Meat") || foodNet.netOutputs.find((o) => o.resource === "Meat");
    const netBbqRemain = foodNet.netInputs.find((i) => i.resource === "Barbecue") || foodNet.netOutputs.find((o) => o.resource === "Barbecue");
    assert.ok(!netMeatRemain || Math.abs(netMeatRemain.rate) < 0.001, "Meat completely balances out");
    assert.ok(!netBbqRemain || Math.abs(netBbqRemain.rate) < 0.001, "Barbecue completely balances out");

    const netLabor = foodNet.netOutputs.find((o) => o.resource === "Duplicant Labor");
    assert.ok(netLabor);
    assert.strictEqual(Math.round(netLabor.rate * 10000) / 10000, 5.8333, "8 Duplicants minus 0.16668 Grill leaves 5.8333 s/s net labor");
  });
});
