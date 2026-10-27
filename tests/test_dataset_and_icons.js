/**
 * Test Suite: Dataset Integrity, Catalog Loader, and Icon Accuracy.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ONI_DATASET } from "../src/dataset.js";
import { buildEntityCatalog, searchEntities } from "../src/data_loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dataset & Catalog Integrity", () => {
  it("validates expected JSON data files exist, are non-empty, and contain valid JSON", () => {
    const expectedFiles = [
      "buildings.json",
      "plants.json",
      "critters.json",
      "duplicants.json",
      "geysers.json",
      "elements.json",
      "dataset.json",
    ];
    const dataDir = path.resolve(__dirname, "../data");

    for (const filename of expectedFiles) {
      const filepath = path.join(dataDir, filename);
      assert.ok(fs.existsSync(filepath), `Expected data file does not exist: ${filepath}`);
      const stat = fs.statSync(filepath);
      assert.ok(stat.size > 0, `Data file is empty (0 bytes): ${filepath}`);

      const raw = fs.readFileSync(filepath, "utf8");
      const parsed = JSON.parse(raw);
      assert.ok(typeof parsed === "object" && parsed !== null, `${filename} root must be list or object`);
    }
  });

  it("validates dataset.json schema and required categories", () => {
    const datasetPath = path.join(__dirname, "../data/dataset.json");
    const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
    const expectedCategories = ["buildings", "plants", "critters", "duplicants", "geysers", "elements"];

    for (const cat of expectedCategories) {
      assert.ok(dataset[cat], `Missing category '${cat}' in dataset.json`);
      assert.ok(
        Array.isArray(dataset[cat]) ? dataset[cat].length > 0 : Object.keys(dataset[cat]).length > 0,
        `Category '${cat}' is empty in dataset.json`
      );
    }
  });

  it("builds entity and element catalog correctly", () => {
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
  });

  it("searches entities across categories and by query", () => {
    const { entities } = buildEntityCatalog(ONI_DATASET);

    const results = searchEntities(entities, "electrolyzer", "All");
    assert.strictEqual(results[0].id, "electrolyzer");

    const plantResults = searchEntities(entities, "arbor", "Plant");
    assert.strictEqual(plantResults[0].id, "plant_arbor_tree");

    const critterResults = searchEntities(entities, "hatch", "Critter");
    assert.ok(critterResults.some((c) => c.id === "critter_hatch"));
  });
});

describe("Icon Integrity and Accuracy", () => {
  it("uses correct machine graphics instead of expansion pack icons", () => {
    const { entityMap } = buildEntityCatalog(ONI_DATASET);

    const expectedMachineIcons = [
      { id: "sublimation_station", icon: "images/icons/Sublimation_Station.png" },
      { id: "peat_burner", icon: "images/icons/Peat_Burner.png" },
      { id: "sludge_press", icon: "images/icons/Sludge_Press.png" },
      { id: "deep_fryer", icon: "images/icons/Deep_Fryer.png" },
      { id: "smoker", icon: "images/icons/Smoker.png" },
      { id: "power_control_station", icon: "images/icons/Power_Control_Station.png" },
    ];

    for (const { id, icon } of expectedMachineIcons) {
      const entity = entityMap.get(id);
      assert.ok(entity, `Entity ${id} must exist`);
      assert.strictEqual(entity.icon, icon, `${id} must use correct machine icon`);
      assert.ok(fs.existsSync(path.resolve(__dirname, "..", entity.icon)), `Icon file for ${id} must exist: ${entity.icon}`);
    }
  });

  it("resolves resource icons in elementMap and verifies icon files exist", () => {
    const { elementMap } = buildEntityCatalog(ONI_DATASET);

    const expectedResourceIcons = [
      { resource: "Reed Fiber", icon: "images/icons/Reed_Fiber.png" },
      { resource: "Polluted Dirt", icon: "images/icons/Polluted_Dirt.png" },
      { resource: "Microchip", icon: "images/icons/Microchip.png" },
      { resource: "Gear Balm", icon: "images/icons/Gear_Balm.png" },
    ];

    for (const { resource, icon } of expectedResourceIcons) {
      const elem = elementMap.get(resource);
      assert.ok(elem, `${resource} must exist in elementMap`);
      assert.strictEqual(elem.icon, icon, `${resource} icon mismatch`);
      assert.ok(fs.existsSync(path.resolve(__dirname, "..", elem.icon)), `Icon file for ${resource} must exist: ${elem.icon}`);
    }
  });

  it("ensures no entity or stream uses an expansion pack icon", () => {
    const { entities, elementMap } = buildEntityCatalog(ONI_DATASET);

    for (const ent of entities) {
      assert.ok(!ent.icon.includes("_icon.png"), `Entity ${ent.name} must not use expansion pack icon (${ent.icon})`);

      const checkStreams = (streams) => {
        if (!streams) return;
        for (const s of streams) {
          const elem = elementMap.get(s.resource);
          assert.ok(elem, `Resource ${s.resource} used in ${ent.name} must resolve in elementMap`);
          assert.ok(elem.icon, `Resource ${s.resource} must have an icon`);
          assert.ok(fs.existsSync(path.resolve(__dirname, "..", elem.icon)), `Icon file ${elem.icon} for resource ${s.resource} must exist`);
          assert.ok(!elem.icon.includes("_icon.png"), `Resource ${s.resource} must not use expansion pack icon (${elem.icon})`);
        }
      };

      checkStreams(ent.inputs);
      checkStreams(ent.outputs);
      if (ent.recipes) {
        for (const r of ent.recipes) {
          checkStreams(r.inputs);
          checkStreams(r.outputs);
        }
      }
    }
  });
});
