/**
 * Test Suite: Buildings & Industrial Recipes.
 * Tests geotuners, generators with Engie's tune-up, refining machines,
 * material synthesizers, and temperature clampings.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import { ONI_DATASET } from "../src/dataset.js";
import {
  evaluateRow,
  calculateSystemNet,
} from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";

const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Geotuners by Geyser Type", () => {
  it("evaluates Geotuned Water Geyser consuming Bleach Stone with scaled output", () => {
    const water1 = evaluateRow({ entityId: "geyser_water_geyser", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
    const bsIn1 = water1.inputs.find((i) => i.resource === "Bleach Stone");
    assert.ok(bsIn1, "1x Geotuned Water Geyser requires Bleach Stone");
    assert.strictEqual(bsIn1.rate, 25.0);
    const waterOut1 = water1.outputs.find((o) => o.resource === "Water");
    assert.strictEqual(waterOut1.rate, 3600.0, "1x Geotuner gives +20% output (3000 * 1.2 = 3600 g/s)");

    const water5 = evaluateRow({ entityId: "geyser_water_geyser", qty: 1, modifiers: ["geotuned_5"] }, entityMap, elementMap);
    const bsIn5 = water5.inputs.find((i) => i.resource === "Bleach Stone");
    assert.strictEqual(bsIn5.rate, 125.0);
    const waterOut5 = water5.outputs.find((o) => o.resource === "Water");
    assert.strictEqual(waterOut5.rate, 6000.0, "5x Geotuner gives +100% output (3000 * 2 = 6000 g/s)");
  });

  it("evaluates Geotuned Metal Volcano consuming Refined Phosphorus", () => {
    const ironGeotuned = evaluateRow({ entityId: "geyser_iron_volcano", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
    const phosIn = ironGeotuned.inputs.find((i) => i.resource === "Refined Phosphorus");
    assert.ok(phosIn, "Geotuned Iron Volcano requires Refined Phosphorus");
    assert.strictEqual(phosIn.rate, 25.0);
  });

  it("evaluates Geotuned Gas Vent consuming Salt", () => {
    const chlorineGeotuned = evaluateRow({ entityId: "geyser_chlorine_gas_vent", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
    const saltIn = chlorineGeotuned.inputs.find((i) => i.resource === "Salt");
    assert.ok(saltIn, "Geotuned Chlorine Vent requires Salt");
    assert.strictEqual(saltIn.rate, 25.0);
  });

  it("evaluates Extreme / Magma Vents consuming Abyssalite", () => {
    const h2Geotuned = evaluateRow({ entityId: "geyser_hydrogen_vent", qty: 1, modifiers: ["geotuned_1"] }, entityMap, elementMap);
    const abyssaliteIn = h2Geotuned.inputs.find((i) => i.resource === "Abyssalite");
    assert.ok(abyssaliteIn);
    assert.strictEqual(abyssaliteIn.rate, 25.0);

    const volcanoGeotuned = evaluateRow({ entityId: "geyser_volcano", qty: 1, modifiers: ["geotuned_5"] }, entityMap, elementMap);
    const abyssaliteIn5 = volcanoGeotuned.inputs.find((i) => i.resource === "Abyssalite");
    assert.strictEqual(abyssaliteIn5.rate, 125.0);
  });
});

describe("Generator Tune-Ups (Microchips)", () => {
  it("evaluates Manual Generator tune-up (+50% power, Microchip input)", () => {
    const tunedMg = evaluateRow({ entityId: "manual_generator", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
    assert.strictEqual(tunedMg.power, 600);
    const mgChip = tunedMg.inputs.find((i) => i.resource === "Microchip");
    assert.ok(mgChip, "Tuned manual generator must consume Microchips");
    assert.strictEqual(mgChip.unit, "chips/s");
  });

  it("evaluates Coal Generator tune-up", () => {
    const tunedCg = evaluateRow({ entityId: "coal_generator", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
    assert.strictEqual(tunedCg.power, 900);
    const cgChip = tunedCg.inputs.find((i) => i.resource === "Microchip");
    assert.ok(cgChip);
    assert.strictEqual(cgChip.rate, 0.0005555556);
  });
});

describe("Refining & Production Buildings", () => {
  it("evaluates Sludge Press recipes (Mud, Polluted Mud)", () => {
    const sludgePress = entityMap.get("sludge_press");
    assert.ok(sludgePress);
    assert.strictEqual(sludgePress.recipes.length, 2);

    // Default (Mud)
    const defaultEval = evaluateRow({ entityId: "sludge_press", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.power, -120);
    assert.strictEqual(defaultEval.heat, 4.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Mud").rate, 7500.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Dirt").rate, 3000.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Water").rate, 4500.0);

    // Polluted Mud
    const pmudEval = evaluateRow({ entityId: "sludge_press", qty: 1, recipeId: "polluted_mud" }, entityMap, elementMap);
    assert.strictEqual(pmudEval.inputs.find((i) => i.resource === "Polluted Mud").rate, 7500.0);
    assert.strictEqual(pmudEval.outputs.find((o) => o.resource === "Polluted Dirt").rate, 3000.0);
    assert.strictEqual(pmudEval.outputs.find((o) => o.resource === "Polluted Water").rate, 4500.0);
  });

  it("evaluates Compost recipes and minimum 75°C output temperature clamping", () => {
    const compost = entityMap.get("compost");
    assert.ok(compost);
    assert.ok(compost.recipes.length >= 6);

    const defaultEval = evaluateRow({ entityId: "compost", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.power, 0.0);
    assert.strictEqual(defaultEval.heat, 1.125);
    const dirtOut = defaultEval.outputs.find((o) => o.resource === "Dirt");
    assert.strictEqual(dirtOut.tempC, 75.0, "Clamped minimum output temp @ 75 °C");

    // Low inlet temp (20 °C) clamped to 75 °C
    const lowEval = evaluateRow({ entityId: "compost", qty: 1, inputTemp: 20.0 }, entityMap, elementMap);
    assert.strictEqual(lowEval.outputs.find((o) => o.resource === "Dirt").tempC, 75.0);

    // High inlet temp (85 °C) passes through
    const highEval = evaluateRow({ entityId: "compost", qty: 1, inputTemp: 85.0 }, entityMap, elementMap);
    assert.strictEqual(highEval.outputs.find((o) => o.resource === "Dirt").tempC, 85.0);

    // Recipes: rot_pile, meal_lice, bristle_berry, mushroom, seeds
    for (const recId of ["rot_pile", "meal_lice", "bristle_berry", "mushroom", "seeds"]) {
      const recEval = evaluateRow({ entityId: "compost", qty: 1, recipeId: recId }, entityMap, elementMap);
      assert.strictEqual(recEval.outputs.find((o) => o.resource === "Dirt").rate, 100.0);
    }
  });

  it("evaluates Peat Burner power, heat, and Engie's Tune-Up", () => {
    const defaultEval = evaluateRow({ entityId: "peat_burner", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.power, 480.0);
    assert.strictEqual(defaultEval.heat, 4.5);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Peat").rate, 1000.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Carbon Dioxide").rate, 40.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Carbon Dioxide").tempC, 110.0);

    const tunedEval = evaluateRow({ entityId: "peat_burner", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
    assert.strictEqual(tunedEval.power, 720.0);
    assert.strictEqual(tunedEval.inputs.find((i) => i.resource === "Microchip").rate, 0.0005555556);
  });

  it("evaluates Gleaner recipes (Brackene, Ovolene)", () => {
    const gleaner = entityMap.get("brackwax_gleaner");
    assert.ok(gleaner);
    assert.strictEqual(gleaner.recipes.length, 2);

    const defaultEval = evaluateRow({ entityId: "brackwax_gleaner", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.power, -480.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Brackene").rate, 1000.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Brackwax").rate, 90.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Brine").rate, 810.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Carbon Dioxide").rate, 100.0);

    const ovoleneEval = evaluateRow({ entityId: "brackwax_gleaner", qty: 1, recipeId: "ovolene" }, entityMap, elementMap);
    assert.strictEqual(ovoleneEval.inputs.find((i) => i.resource === "Ovolene").rate, 1000.0);
    assert.strictEqual(ovoleneEval.outputs.find((o) => o.resource === "Caviar").rate, 90.0);
    assert.strictEqual(ovoleneEval.outputs.find((o) => o.resource === "Mucin").rate, 810.0);
  });

  it("evaluates Glass Forge recipe (Sand -> Molten Glass @ 1750 °C)", () => {
    const defaultEval = evaluateRow({ entityId: "glass_forge", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.power, -1200.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Sand").rate, 2500.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Duplicant Labor").rate, 1.0);
    const glassOut = defaultEval.outputs.find((o) => o.resource === "Molten Glass");
    assert.strictEqual(glassOut.rate, 625.0);
    assert.strictEqual(glassOut.tempC, 1750.0);
  });

  it("evaluates Bleach Stone Hopper recipes (Gold & Gold Amalgam)", () => {
    const defaultEval = evaluateRow({ entityId: "bleach_stone_hopper", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Salt").rate, 750.0);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Gold").rate, 12.5);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Bleach Stone").rate, 250.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Sand").rate, 500.0);

    const amalgamEval = evaluateRow(
      { entityId: "bleach_stone_hopper", qty: 2, recipeId: "bleach_stone_gold_amalgam" },
      entityMap,
      elementMap
    );
    assert.strictEqual(amalgamEval.inputs.find((i) => i.resource === "Gold Amalgam").rate, 25.0);
    assert.strictEqual(amalgamEval.outputs.find((o) => o.resource === "Bleach Stone").rate, 500.0);
  });

  it("evaluates Molecular Forge recipes (Thermium, Super Coolant, Visco-Gel, Insulite, Plastium)", () => {
    const forge = entityMap.get("molecular_forge");
    assert.ok(forge);
    assert.strictEqual(forge.recipes.length, 5);

    // Thermium (default)
    const thermiumEval = evaluateRow({ entityId: "molecular_forge", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(thermiumEval.outputs.find((o) => o.resource === "Thermium").rate, 1250.0);
    assert.strictEqual(thermiumEval.outputs.find((o) => o.resource === "Thermium").tempC, 40.0);

    // Super Coolant
    const scEval = evaluateRow({ entityId: "molecular_forge", qty: 1, recipeId: "super_coolant" }, entityMap, elementMap);
    assert.strictEqual(scEval.inputs.find((i) => i.resource === "Fullerene").rate, 12.5);
    assert.strictEqual(scEval.outputs.find((o) => o.resource === "Super Coolant").rate, 1250.0);

    // Visco-Gel Fluid
    const vgEval = evaluateRow({ entityId: "molecular_forge", qty: 1, recipeId: "visco_gel_fluid" }, entityMap, elementMap);
    assert.strictEqual(vgEval.inputs.find((i) => i.resource === "Isosap").rate, 437.5);
    assert.strictEqual(vgEval.outputs.find((o) => o.resource === "Visco-Gel Fluid").rate, 1250.0);

    // Insulite
    const insEval = evaluateRow({ entityId: "molecular_forge", qty: 1, recipeId: "insulite" }, entityMap, elementMap);
    assert.strictEqual(insEval.inputs.find((i) => i.resource === "Abyssalite").rate, 1000.0);
    assert.strictEqual(insEval.outputs.find((o) => o.resource === "Insulite").rate, 1250.0);

    // Plastium
    const plEval = evaluateRow({ entityId: "molecular_forge", qty: 1, recipeId: "plastium" }, entityMap, elementMap);
    assert.strictEqual(plEval.inputs.find((i) => i.resource === "Plastic").rate, 875.0);
    assert.strictEqual(plEval.outputs.find((o) => o.resource === "Plastium").rate, 1250.0);
  });

  it("evaluates Plant Pulverizer recipes (brackene & phyto oil)", () => {
    const pulverizer = entityMap.get("plant_pulverizer");
    assert.ok(pulverizer);
    assert.strictEqual(pulverizer.recipes.length, 5);

    const defaultEval = evaluateRow({ entityId: "plant_pulverizer", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Sleet Wheat Grain").rate, 0.25);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Brackene").rate, 500.0);

    const slimeEval = evaluateRow({ entityId: "plant_pulverizer", qty: 1, recipeId: "phyto_oil_slime" }, entityMap, elementMap);
    assert.strictEqual(slimeEval.inputs.find((i) => i.resource === "Slime").rate, 2500.0);
    assert.strictEqual(slimeEval.outputs.find((o) => o.resource === "Phyto Oil").rate, 1750.0);
    assert.strictEqual(slimeEval.outputs.find((o) => o.resource === "Dirt").rate, 750.0);
  });

  it("evaluates Thermo Regulator gas cooling by 14°C across all gas recipes", () => {
    const defaultEval = evaluateRow({ entityId: "thermo_regulator", qty: 1 }, entityMap, elementMap);
    const h2Out = defaultEval.outputs.find((o) => o.resource === "Hydrogen");
    assert.strictEqual(h2Out.tempC, 6.0, "Cooled by 14 °C (20 - 14 = 6 °C)");

    // Custom inlet temp (30 °C -> 16 °C)
    const co2Eval = evaluateRow(
      { entityId: "thermo_regulator", qty: 2, recipeId: "carbon_dioxide" },
      entityMap,
      elementMap,
      20.0,
      { "Carbon Dioxide||in a pipe": 30.0 }
    );
    const co2Out = co2Eval.outputs.find((o) => o.resource === "Carbon Dioxide");
    assert.strictEqual(co2Out.tempC, 16.0);
  });

  it("evaluates Rock Crusher rock-to-sand and metal ore recipes", () => {
    const defaultEval = evaluateRow({ entityId: "rock_crusher", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Fossil").rate, 2500.0);
    assert.strictEqual(defaultEval.outputs.find((o) => o.resource === "Lime").rate, 125.0);

    const rockRecipes = [
      { recipeId: "sandstone_sand", resource: "Sandstone" },
      { recipeId: "granite_sand", resource: "Granite" },
      { recipeId: "igneous_rock_sand", resource: "Igneous Rock" },
      { recipeId: "obsidian_sand", resource: "Obsidian" },
      { recipeId: "sedimentary_rock_sand", resource: "Sedimentary Rock" },
      { recipeId: "mafic_rock_sand", resource: "Mafic Rock" },
    ];

    for (const { recipeId, resource } of rockRecipes) {
      const rockEval = evaluateRow({ entityId: "rock_crusher", qty: 1, recipeId }, entityMap, elementMap);
      assert.strictEqual(rockEval.inputs.find((i) => i.resource === resource).rate, 2500.0);
      assert.strictEqual(rockEval.outputs.find((o) => o.resource === "Sand").rate, 2500.0);
    }

    const copperEval = evaluateRow({ entityId: "rock_crusher", qty: 1, recipeId: "crushed_copper" }, entityMap, elementMap);
    assert.strictEqual(copperEval.inputs.find((i) => i.resource === "Copper Ore").rate, 2500.0);
    assert.strictEqual(copperEval.outputs.find((o) => o.resource === "Copper").rate, 1250.0);
    assert.strictEqual(copperEval.outputs.find((o) => o.resource === "Sand").rate, 1250.0);
  });

  it("evaluates Metal Refinery recipes (Aluminum, Cobalt, Tungsten @ 40°C)", () => {
    const alEval = evaluateRow({ entityId: "metal_refinery", qty: 1, recipeId: "aluminum" }, entityMap, elementMap);
    const alOut = alEval.outputs.find((o) => o.resource === "Aluminum");
    assert.strictEqual(alOut.rate, 2500.0);
    assert.strictEqual(alOut.temp, "@ 40 °C");

    const coEval = evaluateRow({ entityId: "metal_refinery", qty: 2, recipeId: "cobalt" }, entityMap, elementMap);
    const coOut = coEval.outputs.find((o) => o.resource === "Cobalt");
    assert.strictEqual(coOut.rate, 5000.0);
    assert.strictEqual(coOut.temp, "@ 40 °C");

    const tuEval = evaluateRow({ entityId: "metal_refinery", qty: 1, recipeId: "tungsten" }, entityMap, elementMap);
    const tuOut = tuEval.outputs.find((o) => o.resource === "Tungsten");
    assert.strictEqual(tuOut.rate, 2500.0);
    assert.strictEqual(tuOut.temp, "@ 40 °C");
  });

  it("evaluates Ice Maker freezing water to ice @ -20°C", () => {
    const defaultEval = evaluateRow({ entityId: "ice_maker", qty: 1 }, entityMap, elementMap);
    assert.strictEqual(defaultEval.inputs.find((i) => i.resource === "Water").rate, 500.0);
    const iceOut = defaultEval.outputs.find((o) => o.resource === "Ice");
    assert.strictEqual(iceOut.rate, 500.0);
    assert.strictEqual(iceOut.tempC, -20.0);
  });

  it("evaluates Thermo Aquatuner with all liquid elements", () => {
    const aquatuner = entityMap.get("thermo_aquatuner");
    assert.strictEqual(aquatuner.recipes.length, 52, "Thermo Aquatuner should have 52 recipes for all liquid elements");

    // Test Crude Oil recipe: SHC = 1.69, heat = 140 * 1.69 = 236.6 kDTU/s
    const crudeEval = evaluateRow(
      { entityId: "thermo_aquatuner", qty: 1, recipeId: "crude_oil" },
      entityMap,
      elementMap,
      20.0,
      { "Crude Oil||in a pipe": 80.0 }
    );
    const crudeIn = crudeEval.inputs.find((i) => i.resource === "Crude Oil");
    const crudeOut = crudeEval.outputs.find((o) => o.resource === "Crude Oil");
    assert.strictEqual(crudeIn.rate, 10000.0);
    assert.strictEqual(crudeOut.rate, 10000.0);
    assert.strictEqual(crudeOut.tempC, 66.0, "Cools incoming Crude Oil by -14 °C (80 - 14 = 66 °C)");
    assert.strictEqual(crudeEval.heat, 236.6);
    assert.strictEqual(crudeEval.power, -1200);

    // Test Petroleum recipe: SHC = 1.76, heat = 140 * 1.76 = 246.4 kDTU/s
    const petroEval = evaluateRow(
      { entityId: "thermo_aquatuner", qty: 1, recipeId: "petroleum" },
      entityMap,
      elementMap,
      20.0,
      { "Petroleum||in a pipe": 200.0 }
    );
    const petroOut = petroEval.outputs.find((o) => o.resource === "Petroleum");
    assert.strictEqual(petroOut.tempC, 186.0, "Cools incoming Petroleum by -14 °C (200 - 14 = 186 °C)");
    assert.strictEqual(petroEval.heat, 246.4);

    // Test Ethanol recipe: SHC = 2.46, heat = 140 * 2.46 = 344.4 kDTU/s
    const ethEval = evaluateRow(
      { entityId: "thermo_aquatuner", qty: 2, recipeId: "ethanol" },
      entityMap,
      elementMap,
      20.0,
      { "Ethanol||in a pipe": -20.0 }
    );
    const ethOut = ethEval.outputs.find((o) => o.resource === "Ethanol");
    assert.strictEqual(ethOut.rate, 20000.0);
    assert.strictEqual(ethOut.tempC, -34.0, "Cools incoming Ethanol by -14 °C (-20 - 14 = -34 °C)");
    assert.strictEqual(ethEval.heat, 688.8, "2x Aquatuner produces 2 * 344.4 = 688.8 kDTU/s");
    assert.strictEqual(ethEval.power, -2400);
  });
});
