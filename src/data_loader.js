/**
 * Data loader and entity catalog index for ONI Resource Calculator.
 * Merges buildings, plants, critters, duplicants, and geysers into a unified catalog
 * and provides fast typeahead autocomplete search with category filtering.
 */

import { ONI_DATASET } from "./dataset.js";

/**
 * Standard fallback icons for non-element resources (Heat, Power, Food).
 */
export const SYNTHETIC_ELEMENTS = {
  Power: {
    name: "Power",
    icon: "images/icons/Power.png",
    state: "Power",
  },
  Heat: {
    name: "Heat",
    icon: "images/icons/Heat.png",
    state: "Thermal Energy",
  },
  Calories: {
    name: "Calories",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  Meat: {
    name: "Meat",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Pacu Fillet": {
    name: "Pacu Fillet",
    icon: "images/icons/Pacu.png",
    state: "Food",
  },
  Barbecue: {
    name: "Barbecue",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Cooked Seafood": {
    name: "Cooked Seafood",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Fried Mushroom": {
    name: "Fried Mushroom",
    icon: "images/icons/Mushroom.png",
    state: "Food",
  },
  "Gristle Berry": {
    name: "Gristle Berry",
    icon: "images/icons/Bristle_Berry.png",
    state: "Food",
  },
  "Frost Bun": {
    name: "Frost Bun",
    icon: "images/icons/Sleet_Wheat_Grain.png",
    state: "Food",
  },
  "Pickled Meal": {
    name: "Pickled Meal",
    icon: "images/icons/Meal_Lice.png",
    state: "Food",
  },
  "Mush Fry": {
    name: "Mush Fry",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Mush Bar": {
    name: "Mush Bar",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  Liceloaf: {
    name: "Liceloaf",
    icon: "images/icons/Meal_Lice.png",
    state: "Food",
  },
  Tofu: {
    name: "Tofu",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Berry Sludge": {
    name: "Berry Sludge",
    icon: "images/icons/Bristle_Berry.png",
    state: "Food",
  },
  "Surf'n'Turf": {
    name: "Surf'n'Turf",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Stuffed Berry": {
    name: "Stuffed Berry",
    icon: "images/icons/Bristle_Berry.png",
    state: "Food",
  },
  "Mushroom Wrap": {
    name: "Mushroom Wrap",
    icon: "images/icons/Mushroom.png",
    state: "Food",
  },
  "Pepper Bread": {
    name: "Pepper Bread",
    icon: "images/icons/Sleet_Wheat_Grain.png",
    state: "Food",
  },
  "Spicy Tofu": {
    name: "Spicy Tofu",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Frost Burger": {
    name: "Frost Burger",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Fish Tacos": {
    name: "Fish Tacos",
    icon: "images/icons/Pacu.png",
    state: "Food",
  },
  "Squash Fries": {
    name: "Squash Fries",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Duplicant Labor": {
    name: "Duplicant Labor",
    icon: "images/icons/Duplicants_preview.png",
    state: "Labor",
  },
  Microchip: {
    name: "Microchip",
    icon: "images/icons/Microchip.png",
    state: "Solid",
  },
  "Gear Balm": {
    name: "Gear Balm",
    icon: "images/icons/Gear_Balm.png",
    state: "Solid",
  },
  "Tallow Gear Balm": {
    name: "Tallow Gear Balm",
    icon: "images/icons/Tallow.png",
    state: "Solid",
  },
  Growth: {
    name: "Growth",
    icon: "images/icons/Mealwood.png",
    state: "free",
  },
  "Reed Fiber": {
    name: "Reed Fiber",
    icon: "images/icons/Reed_Fiber.png",
    state: "Solid",
  },
  "Egg Shell": {
    name: "Egg Shell",
    icon: "images/icons/Egg_Shell.png",
    state: "Solid",
  },
  "Meal Lice": {
    name: "Meal Lice",
    icon: "images/icons/Meal_Lice.png",
    state: "Food",
  },
  "Bristle Berry": {
    name: "Bristle Berry",
    icon: "images/icons/Bristle_Berry.png",
    state: "Food",
  },
  Mushroom: {
    name: "Mushroom",
    icon: "images/icons/Mushroom.png",
    state: "Food",
  },
  "Sleet Wheat Grain": {
    name: "Sleet Wheat Grain",
    icon: "images/icons/Sleet_Wheat_Grain.png",
    state: "Food",
  },
  Lettuce: {
    name: "Lettuce",
    icon: "images/icons/Lettuce.png",
    state: "Food",
  },
  "Nosh Bean": {
    name: "Nosh Bean",
    icon: "images/icons/Nosh_Bean.png",
    state: "Food",
  },
  "Pincha Peppernut": {
    name: "Pincha Peppernut",
    icon: "images/icons/Pincha_Peppernut.png",
    state: "Food",
  },
  "Megafrond Grain": {
    name: "Megafrond Grain",
    icon: "images/icons/Megafrond.png",
    state: "Food",
  },
  "Bog Jelly": {
    name: "Bog Jelly",
    icon: "images/icons/Bog_Jelly.png",
    state: "Food",
  },
  Grubfruit: {
    name: "Grubfruit",
    icon: "images/icons/Grubfruit.png",
    state: "Food",
  },
  "Spindly Grubfruit": {
    name: "Spindly Grubfruit",
    icon: "images/icons/Spindly_Grubfruit.png",
    state: "Food",
  },
  "Balm Lily Flower": {
    name: "Balm Lily Flower",
    icon: "images/icons/Balm_Lily_Flower.png",
    state: "Solid",
  },
  "Rot Pile": {
    name: "Rot Pile",
    icon: "images/icons/Polluted_Dirt.png",
    state: "Solid",
  },
  Seeds: {
    name: "Seeds",
    icon: "images/icons/Seeds.png",
    state: "Solid",
  },
  Compostable: {
    name: "Compostable",
    icon: "images/icons/Polluted_Dirt.png",
    state: "Solid",
  },
  Pikeapple: {
    name: "Pikeapple",
    icon: "images/icons/Pikeapple_Bush.png",
    state: "Food",
  },
  "Plume Squash": {
    name: "Plume Squash",
    icon: "images/icons/Plume_Squash_Plant.png",
    state: "Food",
  },
  Sweatcorn: {
    name: "Sweatcorn",
    icon: "images/icons/Sweatcorn_Stalk.png",
    state: "Food",
  },
  Mimika: {
    name: "Mimika",
    icon: "images/icons/Mimika_Bud.png",
    state: "Food",
  },
  "Salty Sticks": {
    name: "Salty Sticks",
    icon: "images/icons/Sodicane.png",
    state: "Food",
  },
  "Plant Husk": {
    name: "Plant Husk",
    icon: "images/icons/Gas_Grass.png",
    state: "Solid",
  },
  Dewdrip: {
    name: "Dewdrip",
    icon: "images/icons/Dew_Dripper.png",
    state: "Liquid",
  },
  Pinpoki: {
    name: "Pinpoki",
    icon: "images/icons/Pinpoket.png",
    state: "Food",
  },
  "Seakomb Leaf": {
    name: "Seakomb Leaf",
    icon: "images/icons/Seakomb.png",
    state: "Food",
  },
  Caviar: {
    name: "Caviar",
    icon: "images/icons/Food.png",
    state: "Food",
  },
  "Wood (per branch) Nectar": {
    name: "Wood (per branch) Nectar",
    icon: "images/icons/Bonbon_Tree.png",
    state: "free",
  },
  "Plant Meat 900.1 g Hydrogen": {
    name: "Plant Meat 900.1 g Hydrogen",
    icon: "images/icons/Saturn_Critter_Trap.png",
    state: "free",
  },
  "Kelpole (Per \"Branch\")": {
    name: "Kelpole (Per \"Branch\")",
    icon: "images/icons/Seakomb.png",
    state: "free",
  },
  "or Ovolene": {
    name: "or Ovolene",
    icon: "images/icons/Ovolene.png",
    state: "free",
  },
};

/**
 * Compatibility alias map for legacy entity IDs (used in bookmark URLs and presets).
 */
export const ENTITY_ALIASES = {
  water_pump: "liquid_pump",
  geyser_water: "geyser_water_geyser",
  geyser_natural_gas: "geyser_natural_gas_geyser",
};

/**
 * Build a unified entity catalog and lookup maps.
 *
 * @param {Object} dataset - The raw ONI_DATASET object
 * @returns {{ entities: Array, entityMap: Map<string, Object>, elementMap: Map<string, Object> }}
 */
export function buildEntityCatalog(dataset = ONI_DATASET) {
  const entities = [];
  const entityMap = new Map();
  const elementMap = new Map();

  // Populate synthetic elements first
  for (const [name, info] of Object.entries(SYNTHETIC_ELEMENTS)) {
    elementMap.set(name, info);
  }

  // Populate elements from dataset
  if (dataset.elements) {
    if (Array.isArray(dataset.elements)) {
      for (const elem of dataset.elements) {
        if (elem && elem.name) {
          elementMap.set(elem.name, elem);
        }
      }
    } else if (typeof dataset.elements === "object") {
      for (const [name, elem] of Object.entries(dataset.elements)) {
        if (elem) {
          elementMap.set(name, elem);
        }
      }
    }
  }

  // Merge all entity collections
  const categories = ["buildings", "plants", "critters", "duplicants", "geysers"];
  for (const catKey of categories) {
    const list = dataset[catKey];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || !item.id) continue;
        entities.push(item);
        entityMap.set(item.id, item);
      }
    }
  }

  // Register backward-compatibility aliases in entityMap only (without duplicating items in entities)
  for (const [aliasId, canonicalId] of Object.entries(ENTITY_ALIASES)) {
    if (!entityMap.has(aliasId) && entityMap.has(canonicalId)) {
      entityMap.set(aliasId, entityMap.get(canonicalId));
    }
  }

  return {
    entities,
    entityMap,
    elementMap,
  };
}

/**
 * Fast typeahead search with scoring and category filter.
 *
 * @param {Array} entities - Unified entity list
 * @param {string} query - Search string
 * @param {string} categoryFilter - "All" or a specific category ("Machine", "Plant", "Critter", "Duplicant", "Geyser")
 * @returns {Array} Filtered and ranked entities
 */
export function searchEntities(entities, query = "", categoryFilter = "All") {
  if (!Array.isArray(entities)) return [];

  // Filter by category
  let pool = entities;
  if (categoryFilter && categoryFilter.toLowerCase() !== "all") {
    const filterLower = categoryFilter.toLowerCase();
    pool = pool.filter(
      (e) => e.category && e.category.toLowerCase() === filterLower
    );
  }

  const q = (query || "").trim().toLowerCase();
  if (!q) {
    // Return all in current category
    return pool;
  }

  const scored = [];

  for (const entity of pool) {
    const name = (entity.name || "").toLowerCase();
    const id = (entity.id || "").toLowerCase();
    const sub = (entity.subcategory || "").toLowerCase();

    let score = 0;

    if (name === q) {
      score = 100;
    } else if (name.startsWith(q)) {
      score = 80;
    } else if (name.includes(q)) {
      score = 60;
    } else if (id.startsWith(q)) {
      score = 50;
    } else if (id.includes(q)) {
      score = 40;
    } else if (sub.includes(q)) {
      score = 30;
    }

    // Match aliases (e.g. "Water Pump" -> Liquid Pump)
    if (Array.isArray(entity.aliases)) {
      for (const alias of entity.aliases) {
        const a = alias.toLowerCase();
        if (a === q) score = Math.max(score, 95);
        else if (a.startsWith(q)) score = Math.max(score, 75);
        else if (a.includes(q)) score = Math.max(score, 55);
      }
    }

    // Match input / output resource names
    if (score === 0) {
      const inputs = entity.inputs || [];
      const outputs = entity.outputs || [];
      const recipes = entity.recipes || [];

      for (const inp of inputs) {
        if ((inp.resource || "").toLowerCase().includes(q)) {
          score = Math.max(score, 25);
          break;
        }
      }
      for (const out of outputs) {
        if ((out.resource || "").toLowerCase().includes(q)) {
          score = Math.max(score, 25);
          break;
        }
      }
      for (const r of recipes) {
        if ((r.name || "").toLowerCase().includes(q) || (r.id || "").toLowerCase().includes(q)) {
          score = Math.max(score, 20);
          break;
        }
      }
    }

    if (score > 0) {
      scored.push({ entity, score });
    }
  }

  // Sort by score descending, then alphabetically by name
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entity.name.localeCompare(b.entity.name);
  });

  return scored.map((s) => s.entity);
}
