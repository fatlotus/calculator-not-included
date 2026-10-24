/**
 * Pure accounting and resource balance calculation engine for ONI Math.
 * Supports per-second (/s) and per-cycle (/cycle = 600s) rates,
 * recipe selection, entity modifiers, SHC & thermal tracking,
 * iterative temperature resolution from average output streams,
 * and two-stage NET cancellation.
 */

import { ONI_DATASET } from "./dataset.js";

export const SECONDS_PER_CYCLE = 600;

/**
 * Standard epsilon for resource rate cancellation and display elision.
 * Rates with magnitude below this threshold are considered roundoff noise.
 */
export const NET_RATE_EPSILON = 1e-4;

/**
 * Standard mass unit multipliers (in grams).
 */
export const MASS_UNITS = {
  g: 1.0,
  kg: 1000.0,
  Kg: 1000.0,
  t: 1000000.0,
  T: 1000000.0,
  tonne: 1000000.0,
  tonnes: 1000000.0,
};

export const NON_THERMAL_RESOURCES = new Set([
  "Duplicant Labor",
  "Calories",
  "Power",
  "Heat",
  "Microchip",
  "Gear Balm",
  "Tallow Gear Balm",
  "Growth",
]);

export const NON_THERMAL_UNITS = new Set([
  "chips/s",
  "chips/cycle",
  "s/s",
  "s/cycle",
  "kcal/s",
  "kcal/cycle",
  "balm/s",
  "balm/cycle",
  "growth/s",
  "growth/cycle",
  "%/s",
  "%/cycle",
]);

export function isNonThermalResource(resource, unit = "") {
  return NON_THERMAL_RESOURCES.has(resource) || NON_THERMAL_UNITS.has(unit);
}

/**
 * Check if a resource is a solid element or solid resource.
 * Checks elementMap first if provided, then falls back to ONI_DATASET.elements.
 */
export function isSolidResource(resource, elementMap = null) {
  if (!resource) return false;
  if (elementMap) {
    const elem = elementMap instanceof Map ? elementMap.get(resource) : elementMap[resource];
    if (elem?.state) {
      return String(elem.state).toLowerCase() === "solid";
    }
  }
  const elem = ONI_DATASET?.elements?.[resource];
  if (elem?.state) {
    return String(elem.state).toLowerCase() === "solid";
  }
  return false;
}

/**
 * Format a numeric value cleanly with up to maxDecimals (default 4) stripping trailing zeros.
 */
export function formatNumber(val, maxDecimals = 4) {
  if (val === null || val === undefined || isNaN(val)) return "0";
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(val * factor) / factor;
  if (Math.abs(rounded) < 1e-6) return "0";
  return Number(rounded.toFixed(maxDecimals)).toString();
}

/**
 * Format a resource stream line with automatic unit scaling (g, Kg, T).
 * Elides (free) for solid resources since solids cannot go in a pipe in the game.
 */
export function formatStreamLine(stream, isOutput, rateMode = "s", elementMap = null) {
  const sign = isOutput ? "+" : "-";
  const rawRate = Math.abs(stream.rate || 0);
  const rawUnit = stream.unit || "g/s";

  const baseUnitMatch = rawUnit.replace(/\/(s|cycle)$/, "");
  const isMassUnit = MASS_UNITS[baseUnitMatch] !== undefined;

  let displayRate = rawRate;
  let displayUnit = rawUnit;

  if (isMassUnit) {
    // 1. Convert to grams per second
    let gPerSec = rawRate * MASS_UNITS[baseUnitMatch];
    if (rawUnit.endsWith("/cycle")) {
      gPerSec /= SECONDS_PER_CYCLE;
    }

    // 2. Compute grams for active rateMode
    const totalG = rateMode === "c" ? gPerSec * SECONDS_PER_CYCLE : gPerSec;
    const timeSuffix = rateMode === "c" ? "/cycle" : "/s";
    const absG = Math.abs(totalG);

    if (absG >= 1000000.0) {
      displayRate = totalG / 1000000.0;
      displayUnit = `T${timeSuffix}`;
    } else if (absG >= 1000.0) {
      displayRate = totalG / 1000.0;
      displayUnit = `Kg${timeSuffix}`;
    } else {
      displayRate = totalG;
      displayUnit = `g${timeSuffix}`;
    }
  } else {
    // Non-mass units (s/s, kcal/s, chips/s, etc.)
    if (rateMode === "c") {
      if (displayUnit.endsWith("/s")) {
        displayRate *= SECONDS_PER_CYCLE;
        displayUnit = displayUnit.replace(/\/s$/, "/cycle");
      }
    } else {
      if (displayUnit.endsWith("/cycle")) {
        displayRate /= SECONDS_PER_CYCLE;
        displayUnit = displayUnit.replace(/\/cycle$/, "/s");
      }
    }
  }

  const formattedVal = formatNumber(displayRate);
  const displaySign = formattedVal === "0" ? "" : sign;
  let text = `${stream.resource}: ${displaySign}${formattedVal} ${displayUnit}`;
  if (isOutput && stream.temp && !isNonThermalResource(stream.resource, stream.unit)) {
    text += ` ${stream.temp}`;
  }
  if (stream.state) {
    if (stream.state === "free" && isSolidResource(stream.resource, elementMap)) {
      // Elide (free) for solids since solids cannot go in a pipe in the game
    } else {
      text += ` (${stream.state})`;
    }
  }
  return text;
}

/**
 * Helper to determine a reasonable default temperature for an element in °C.
 * Uses elem.default_temp if present;
 * else 20 °C if it is within (low_temp, high_temp);
 * else a value safely inside the phase range;
 * else 20 °C.
 */
export function getDefaultElementTemp(resource, elementMap) {
  if (elementMap) {
    const elem = elementMap instanceof Map ? elementMap.get(resource) : elementMap[resource];
    if (elem && typeof elem === "object") {
      if (elem.default_temp !== undefined && elem.default_temp !== null && !isNaN(Number(elem.default_temp))) {
        return Number(elem.default_temp);
      }

      const lowRaw = elem.low_temp;
      const highRaw = elem.high_temp;

      let isKelvin = false;
      const hasLow = lowRaw !== undefined && lowRaw !== null && !isNaN(Number(lowRaw));
      const hasHigh = highRaw !== undefined && highRaw !== null && !isNaN(Number(highRaw));

      if (hasLow || hasHigh) {
        const hasNegative = (hasLow && Number(lowRaw) < 0) || (hasHigh && Number(highRaw) < 0);
        if (!hasNegative) {
          if ((hasLow && Number(lowRaw) > 50) || (hasHigh && Number(highRaw) > 100)) {
            isKelvin = true;
          }
        }
      }

      const lowC = hasLow ? (isKelvin ? Number(lowRaw) - 273.15 : Number(lowRaw)) : null;
      const highC = hasHigh ? (isKelvin ? Number(highRaw) - 273.15 : Number(highRaw)) : null;

      let inRange = true;
      if (lowC !== null && 20.0 <= lowC) inRange = false;
      if (highC !== null && 20.0 >= highC) inRange = false;

      if (inRange) return 20.0;

      if (lowC !== null && highC !== null) {
        return Math.round(((lowC + highC) / 2.0) * 10) / 10;
      } else if (lowC !== null) {
        return Math.round((lowC + 20.0) * 10) / 10;
      } else if (highC !== null) {
        return Math.round((highC - 20.0) * 10) / 10;
      }
    }
  }
  return 20.0;
}

/**
 * Lookup net input temperature from state.netInputTemps with fallbacks.
 */
export function getNetInputTemp(resource, state, netInputTemps, defaultTemp = 20.0) {
  if (!netInputTemps || typeof netInputTemps !== "object") return defaultTemp;
  const keyStrict = `${resource}||${state || "free"}`;
  const keySinglePipe = `${resource}|${state || "free"}`;
  const keyResource = resource;

  if (netInputTemps[keyStrict] !== undefined && !isNaN(Number(netInputTemps[keyStrict]))) {
    return Number(netInputTemps[keyStrict]);
  }
  if (netInputTemps[keySinglePipe] !== undefined && !isNaN(Number(netInputTemps[keySinglePipe]))) {
    return Number(netInputTemps[keySinglePipe]);
  }
  if (netInputTemps[keyResource] !== undefined && !isNaN(Number(netInputTemps[keyResource]))) {
    return Number(netInputTemps[keyResource]);
  }
  return defaultTemp;
}

/**
 * Determine the inlet temperature that feeds a specific machine output stream.
 */
function getOutputInletTemp(outputStream, evaluatedInputs, defaultTemp = 20.0) {
  // 1. If machine has an input with the exact same resource name (e.g. Water in Water Pump / Aquatuner)
  const exact = evaluatedInputs.find((inp) => inp.resource === outputStream.resource && !isNonThermalResource(inp.resource, inp.unit));
  if (exact && exact.tempC !== undefined) return exact.tempC;

  // 2. Liquid purification / conversion: Water <-> Polluted Water / Salt Water / Brine (Water Sieve, Desalinator, Carbon Skimmer)
  if (outputStream.resource.includes("Water") || outputStream.resource === "Brine") {
    const fluidIn = evaluatedInputs.find(
      (inp) => (inp.resource.includes("Water") || inp.resource === "Brine") && !isNonThermalResource(inp.resource, inp.unit)
    );
    if (fluidIn && fluidIn.tempC !== undefined) return fluidIn.tempC;
  }

  // 3. Mass-weighted average across all machine thermal inputs
  let totalMass = 0;
  let totalEnthalpy = 0;
  for (const inp of evaluatedInputs) {
    if (isNonThermalResource(inp.resource, inp.unit)) continue;
    const rate = Math.abs(inp.rate || 0);
    const t = inp.tempC !== undefined ? inp.tempC : defaultTemp;
    totalMass += rate;
    totalEnthalpy += rate * t;
  }
  if (totalMass > 1e-6) {
    return totalEnthalpy / totalMass;
  }

  // 4. Fallback for machines without inputs (geysers, etc.)
  return defaultTemp;
}

/**
 * Evaluate a single calculator table row into resolved inputs, outputs, power, and thermal delta.
 */
export const ENTITY_ALIASES = {
  water_pump: "liquid_pump",
  geyser_water: "geyser_water_geyser",
  geyser_natural_gas: "geyser_natural_gas_geyser",
};

export const DUPLICANT_BATHROOMS = {
  plumbed: {
    id: "plumbed",
    name: "Plumbed",
    inputs: [
      { resource: "Water", rate: 8.3333, unit: "g/s", state: "in a pipe", temp: null },
    ],
    outputs: [
      { resource: "Polluted Water", rate: 19.5, unit: "g/s", state: "in a pipe", temp: "@ 37 °C" },
    ],
  },
  outhouse: {
    id: "outhouse",
    name: "Outhouse",
    inputs: [
      { resource: "Dirt", rate: 21.6667, unit: "g/s", state: "free", temp: null },
    ],
    outputs: [
      { resource: "Polluted Dirt", rate: 32.8333, unit: "g/s", state: "free", temp: "@ 37 °C" },
    ],
  },
  floor: {
    id: "floor",
    name: "Peeing on the floor",
    inputs: [],
    outputs: [
      { resource: "Polluted Water", rate: 11.1667, unit: "g/s", state: "free", temp: "@ 37 °C" },
    ],
  },
  none: {
    id: "none",
    name: "None (External / Ignored)",
    inputs: [],
    outputs: [],
  },
};

export const DUPLICANT_DIETS = {
  calories: {
    id: "calories",
    name: "Calories (1000 kcal/cycle)",
    resource: "Calories",
    rate: 1.6667,
    unit: "kcal/s",
    state: "free",
    temp: null,
  },
  barbecue: {
    id: "barbecue",
    name: "Barbecue (4000 kcal / 250 g/cycle)",
    resource: "Barbecue",
    rate: 0.4167,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  cooked_seafood: {
    id: "cooked_seafood",
    name: "Cooked Seafood (1600 kcal / 625 g/cycle)",
    resource: "Cooked Seafood",
    rate: 1.0417,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  surf_and_turf: {
    id: "surf_and_turf",
    name: "Surf'n'Turf (6000 kcal / 167 g/cycle)",
    resource: "Surf'n'Turf",
    rate: 0.2778,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  frost_burger: {
    id: "frost_burger",
    name: "Frost Burger (6000 kcal / 167 g/cycle)",
    resource: "Frost Burger",
    rate: 0.2778,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  pepper_bread: {
    id: "pepper_bread",
    name: "Pepper Bread (4000 kcal / 250 g/cycle)",
    resource: "Pepper Bread",
    rate: 0.4167,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  spicy_tofu: {
    id: "spicy_tofu",
    name: "Spicy Tofu (4000 kcal / 250 g/cycle)",
    resource: "Spicy Tofu",
    rate: 0.4167,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  stuffed_berry: {
    id: "stuffed_berry",
    name: "Stuffed Berry (4400 kcal / 227 g/cycle)",
    resource: "Stuffed Berry",
    rate: 0.3788,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  mushroom_wrap: {
    id: "mushroom_wrap",
    name: "Mushroom Wrap (4800 kcal / 208 g/cycle)",
    resource: "Mushroom Wrap",
    rate: 0.3472,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  fried_mushroom: {
    id: "fried_mushroom",
    name: "Fried Mushroom (2800 kcal / 357 g/cycle)",
    resource: "Fried Mushroom",
    rate: 0.5952,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  gristle_berry: {
    id: "gristle_berry",
    name: "Gristle Berry (2000 kcal / 500 g/cycle)",
    resource: "Gristle Berry",
    rate: 0.8333,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  frost_bun: {
    id: "frost_bun",
    name: "Frost Bun (1200 kcal / 833 g/cycle)",
    resource: "Frost Bun",
    rate: 1.3889,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  pickled_meal: {
    id: "pickled_meal",
    name: "Pickled Meal (1800 kcal / 556 g/cycle)",
    resource: "Pickled Meal",
    rate: 0.9259,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  mush_fry: {
    id: "mush_fry",
    name: "Mush Fry (1050 kcal / 952 g/cycle)",
    resource: "Mush Fry",
    rate: 1.5873,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  mush_bar: {
    id: "mush_bar",
    name: "Mush Bar (800 kcal / 1250 g/cycle)",
    resource: "Mush Bar",
    rate: 2.0833,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  liceloaf: {
    id: "liceloaf",
    name: "Liceloaf (1700 kcal / 588 g/cycle)",
    resource: "Liceloaf",
    rate: 0.9804,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  tofu: {
    id: "tofu",
    name: "Tofu (3600 kcal / 278 g/cycle)",
    resource: "Tofu",
    rate: 0.4630,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  berry_sludge: {
    id: "berry_sludge",
    name: "Berry Sludge (4000 kcal / 250 g/cycle)",
    resource: "Berry Sludge",
    rate: 0.4167,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  fish_tacos: {
    id: "fish_tacos",
    name: "Fish Tacos (4200 kcal / 238 g/cycle)",
    resource: "Fish Tacos",
    rate: 0.3968,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  squash_fries: {
    id: "squash_fries",
    name: "Squash Fries (5400 kcal / 185 g/cycle)",
    resource: "Squash Fries",
    rate: 0.3086,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  meal_lice: {
    id: "meal_lice",
    name: "Meal Lice (600 kcal / 1667 g/cycle)",
    resource: "Meal Lice",
    rate: 2.7778,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  bristle_berry: {
    id: "bristle_berry",
    name: "Bristle Berry (1600 kcal / 625 g/cycle)",
    resource: "Bristle Berry",
    rate: 1.0417,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  mushroom: {
    id: "mushroom",
    name: "Mushroom (2400 kcal / 417 g/cycle)",
    resource: "Mushroom",
    rate: 0.6944,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  meat: {
    id: "meat",
    name: "Raw Meat (1600 kcal / 625 g/cycle)",
    resource: "Meat",
    rate: 1.0417,
    unit: "g/s",
    state: "free",
    temp: null,
  },
  pacu_fillet: {
    id: "pacu_fillet",
    name: "Raw Pacu Fillet (1000 kcal / 1000 g/cycle)",
    resource: "Pacu Fillet",
    rate: 1.6667,
    unit: "g/s",
    state: "free",
    temp: null,
  },
};

export function evaluateRow(
  row,
  entityMap,
  elementMap = null,
  defaultInputTemp = 20.0,
  inputTemps = null
) {
  let entity = entityMap ? entityMap.get(row.entityId) : null;
  if (!entity && entityMap && ENTITY_ALIASES[row.entityId]) {
    entity = entityMap.get(ENTITY_ALIASES[row.entityId]);
  }
  if (!entity) {
    return {
      entity: null,
      qty: row.qty || 0,
      power: 0,
      heat: 0,
      buildingHeat: 0,
      inputTemp: defaultInputTemp,
      inputs: [],
      outputs: [],
      isStateTransferFor: new Set(),
    };
  }

  const qty = Math.max(0, Number(row.qty) || 0);
  const activeModIds = new Set(
    row.modifiers !== undefined && row.modifiers !== null
      ? row.modifiers
      : (entity.default_modifiers || [])
  );

  let baseInputs = entity.inputs || [];
  let baseOutputs = entity.outputs || [];
  let basePower = Number(entity.power) || 0;
  let baseHeat = Number(entity.heat) || 0;

  if (entity.recipes && entity.recipes.length > 0) {
    const selectedRecipe =
      entity.recipes.find((r) => r.id === row.recipeId) || entity.recipes[0];
    baseInputs = selectedRecipe.inputs || [];
    baseOutputs = selectedRecipe.outputs || [];
    if (selectedRecipe.power !== undefined) basePower = Number(selectedRecipe.power);
    if (selectedRecipe.heat !== undefined) baseHeat = Number(selectedRecipe.heat);
  }

  // Resolve temperature for each input stream
  const inputs = baseInputs.map((s) => {
    if (isNonThermalResource(s.resource, s.unit)) {
      return { ...s, tempC: undefined, temp: null };
    }
    let inpTemp = defaultInputTemp;
    if (inputTemps && typeof inputTemps === "object") {
      const k = `${s.resource}||${s.state || "free"}`;
      const kSingle = `${s.resource}|${s.state || "free"}`;
      if (inputTemps[k] !== undefined) inpTemp = Number(inputTemps[k]);
      else if (inputTemps[kSingle] !== undefined) inpTemp = Number(inputTemps[kSingle]);
      else if (inputTemps[s.resource] !== undefined) inpTemp = Number(inputTemps[s.resource]);
    } else if (row.inputTemp !== undefined && row.inputTemp !== null && !isNaN(Number(row.inputTemp))) {
      inpTemp = Number(row.inputTemp);
    }
    return { ...s, tempC: inpTemp };
  });

  // Resolve temperature for each output stream based on thermal mode
  const outputs = baseOutputs.map((s) => {
    if (isNonThermalResource(s.resource, s.unit)) {
      return { ...s, temp: null, tempC: undefined };
    }
    const inTemp = getOutputInletTemp(s, inputs, defaultInputTemp);
    let outTemp = inTemp;
    let tempStr = s.temp || null;

    if (s.temp && s.temp.includes("+") && s.temp.includes("@")) {
      // Clamped minimum: @ X °C+ -> max(T_in, min)
      const match = s.temp.match(/([+-]?\s*[0-9]+(?:\.[0-9]+)?)/);
      const minTemp = match ? parseFloat(match[1].replace(/\s+/g, "")) : 70.0;
      outTemp = Math.max(inTemp, minTemp);
      tempStr = `@ ${formatNumber(outTemp)} °C`;
    } else if (s.temp && !s.temp.includes("@") && (s.temp.includes("+") || s.temp.includes("-"))) {
      // Temperature shift: e.g. -14 °C -> T_in + delta
      const match = s.temp.match(/([+-]\s*[0-9]+(?:\.[0-9]+)?)/);
      const delta = match ? parseFloat(match[1].replace(/\s+/g, "")) : 0.0;
      outTemp = inTemp + delta;
      tempStr = `@ ${formatNumber(outTemp)} °C`;
    } else if (s.temp && s.temp.includes("@")) {
      // Fixed temp: e.g. @ 95 °C -> fixed
      const match = s.temp.match(/([+-]?\s*[0-9]+(?:\.[0-9]+)?)/);
      outTemp = match ? parseFloat(match[1].replace(/\s+/g, "")) : inTemp;
      tempStr = `@ ${formatNumber(outTemp)} °C`;
    } else {
      // Pass-through: T_in
      outTemp = inTemp;
      tempStr = `@ ${formatNumber(outTemp)} °C`;
    }

    return { ...s, temp: tempStr, tempC: outTemp };
  });

  let power = basePower;
  let heat = baseHeat;

  for (const mod of entity.modifiers || []) {
    if (!activeModIds.has(mod.id)) continue;
    if (
      (row.entityId === "duplicant" || entity.id === "duplicant") &&
      mod.id === "bottomless_stomach"
    ) {
      continue;
    }
    if (mod.input_multiplier !== undefined) for (const s of inputs) s.rate *= mod.input_multiplier;
    if (mod.output_multiplier !== undefined) for (const s of outputs) s.rate *= mod.output_multiplier;
    if (mod.input_multipliers) {
      for (const s of inputs) if (mod.input_multipliers[s.resource] !== undefined) s.rate *= mod.input_multipliers[s.resource];
    }
    if (mod.output_multipliers) {
      for (const s of outputs) if (mod.output_multipliers[s.resource] !== undefined) s.rate *= mod.output_multipliers[s.resource];
    }
    if (mod.power_multiplier !== undefined) power *= mod.power_multiplier;
    if (mod.extra_inputs) {
      for (const extra of mod.extra_inputs) {
        const existing = inputs.find((s) => s.resource === extra.resource && s.state === extra.state);
        if (existing) {
          existing.rate += extra.rate;
        } else {
          if (isNonThermalResource(extra.resource, extra.unit)) {
            inputs.push({ ...extra, tempC: undefined, temp: null });
          } else {
            let inpTemp = defaultInputTemp;
            if (inputTemps && typeof inputTemps === "object") {
              const k = `${extra.resource}||${extra.state || "free"}`;
              const kSingle = `${extra.resource}|${extra.state || "free"}`;
              if (inputTemps[k] !== undefined) inpTemp = Number(inputTemps[k]);
              else if (inputTemps[kSingle] !== undefined) inpTemp = Number(inputTemps[kSingle]);
              else if (inputTemps[extra.resource] !== undefined) inpTemp = Number(inputTemps[extra.resource]);
            }
            inputs.push({ ...extra, tempC: inpTemp });
          }
        }
      }
    }
    if (mod.extra_outputs) {
      for (const extra of mod.extra_outputs) {
        const existing = outputs.find((s) => s.resource === extra.resource && s.state === extra.state);
        if (existing) {
          existing.rate += extra.rate;
        } else {
          if (isNonThermalResource(extra.resource, extra.unit)) {
            outputs.push({ ...extra, tempC: undefined, temp: null });
          } else {
            const inTemp = getOutputInletTemp(extra, inputs, defaultInputTemp);
            outputs.push({ ...extra, tempC: inTemp, temp: `@ ${formatNumber(inTemp)} °C` });
          }
        }
      }
    }
  }

  // Handle regular duplicant food and bathroom inputs and outputs
  if (row.entityId === "duplicant" || entity.id === "duplicant") {
    // Duplicant Food / Diet Selection
    if (row.food !== "none") {
      const foodId = row.food || "calories";
      const diet = DUPLICANT_DIETS[foodId] || DUPLICANT_DIETS.calories;
      const multiplier = activeModIds.has("bottomless_stomach") ? 1.5 : 1.0;
      inputs.push({
        resource: diet.resource,
        rate: diet.rate * multiplier,
        unit: diet.unit,
        state: diet.state,
        temp: null,
        tempC: undefined,
      });
    }

    const bType = row.bathroom || "plumbed";
    const bathroom = DUPLICANT_BATHROOMS[bType] || DUPLICANT_BATHROOMS.plumbed;
    if (bathroom) {
      for (const inp of bathroom.inputs) {
        let inpTemp = defaultInputTemp;
        if (inputTemps && typeof inputTemps === "object") {
          const k = `${inp.resource}||${inp.state || "free"}`;
          const kSingle = `${inp.resource}|${inp.state || "free"}`;
          if (inputTemps[k] !== undefined) inpTemp = Number(inputTemps[k]);
          else if (inputTemps[kSingle] !== undefined) inpTemp = Number(inputTemps[kSingle]);
          else if (inputTemps[inp.resource] !== undefined) inpTemp = Number(inputTemps[inp.resource]);
        }
        inputs.push({ ...inp, tempC: inpTemp });
      }
      for (const out of bathroom.outputs) {
        outputs.push({ ...out, tempC: 37.0, temp: "@ 37 °C" });
      }
    }
  }

  const scaledInputs = inputs
    .map((s) => ({ ...s, rate: s.rate * qty }))
    .filter((s) => Math.abs(s.rate) > 1e-6);
  const scaledOutputs = outputs
    .map((s) => ({ ...s, rate: s.rate * qty }))
    .filter((s) => Math.abs(s.rate) > 1e-6);

  const scaledPower = power * qty;
  const scaledHeat = heat * qty;

  const isStateTransferFor = new Set();
  for (const inp of scaledInputs) {
    for (const out of scaledOutputs) {
      if (inp.resource === out.resource && inp.state !== out.state) {
        isStateTransferFor.add(inp.resource);
      }
    }
  }

  // Representative input temperature for UI
  const thermalInp = scaledInputs.find((s) => s.tempC !== undefined && !isNonThermalResource(s.resource, s.unit));
  const repInputTemp = thermalInp ? thermalInp.tempC : defaultInputTemp;

  return {
    entity,
    qty,
    power: scaledPower,
    heat: scaledHeat,
    buildingHeat: scaledHeat,
    inputTemp: repInputTemp,
    inputs: scaledInputs,
    outputs: scaledOutputs,
    isStateTransferFor,
  };
}

/**
 * Iteratively resolve system-wide element temperatures across the table rows.
 * For each resource key (resource||state with strict pipe matching):
 * - temperature seen by consumers is the rate-weighted average of all output streams of that key.
 * - if key has a net deficit (appears in NET inputs), blend in deficit mass at NET input temperature.
 * - if key has no outputs at all, use NET input temperature.
 * Output streams follow their machine thermal mode.
 * Iterates until convergence (capped at maxPasses, default 10).
 */
export function resolveTableTemperatures(rows, entityMap, elementMap = null, options = {}) {
  const netInputTemps = (typeof options === "object" && options.netInputTemps) || {};
  const maxPasses = (typeof options === "object" && options.maxPasses) || 10;

  if (!rows || rows.length === 0) return [];

  const getKey = (res, st) => `${res}||${st || "free"}`;

  const getDefNetTemp = (res, st) => {
    const def = getDefaultElementTemp(res, elementMap);
    return getNetInputTemp(res, st, netInputTemps, def);
  };

  const currentTemps = {};

  // Pre-seed keys from table rows
  for (const row of rows) {
    const entity = entityMap.get(row.entityId);
    if (!entity) continue;
    let baseInps = entity.inputs || [];
    let baseOuts = entity.outputs || [];
    if (entity.recipes && entity.recipes.length > 0) {
      const rec = entity.recipes.find((r) => r.id === row.recipeId) || entity.recipes[0];
      baseInps = rec.inputs || [];
      baseOuts = rec.outputs || [];
    }
    for (const inp of baseInps) {
      if (isNonThermalResource(inp.resource, inp.unit)) continue;
      const k = getKey(inp.resource, inp.state);
      if (currentTemps[k] === undefined) {
        currentTemps[k] = getDefNetTemp(inp.resource, inp.state);
      }
    }
    for (const out of baseOuts) {
      if (isNonThermalResource(out.resource, out.unit)) continue;
      const k = getKey(out.resource, out.state);
      if (currentTemps[k] === undefined) {
        currentTemps[k] = getDefNetTemp(out.resource, out.state);
      }
    }
    if (row.entityId === "duplicant") {
      const bType = row.bathroom || "plumbed";
      const bObj = DUPLICANT_BATHROOMS[bType] || DUPLICANT_BATHROOMS.plumbed;
      if (bObj) {
        for (const inp of bObj.inputs) {
          if (isNonThermalResource(inp.resource, inp.unit)) continue;
          const k = getKey(inp.resource, inp.state);
          if (currentTemps[k] === undefined) {
            currentTemps[k] = getDefNetTemp(inp.resource, inp.state);
          }
        }
        for (const out of bObj.outputs) {
          if (isNonThermalResource(out.resource, out.unit)) continue;
          const k = getKey(out.resource, out.state);
          if (currentTemps[k] === undefined) {
            currentTemps[k] = getDefNetTemp(out.resource, out.state);
          }
        }
      }
    }
    if (row.modifiers && Array.isArray(row.modifiers)) {
      for (const modId of row.modifiers) {
        const mod = (entity.modifiers || []).find((m) => m.id === modId);
        if (!mod) continue;
        if (mod.extra_inputs) {
          for (const inp of mod.extra_inputs) {
            if (isNonThermalResource(inp.resource, inp.unit)) continue;
            const k = getKey(inp.resource, inp.state);
            if (currentTemps[k] === undefined) {
              currentTemps[k] = getDefNetTemp(inp.resource, inp.state);
            }
          }
        }
        if (mod.extra_outputs) {
          for (const out of mod.extra_outputs) {
            if (isNonThermalResource(out.resource, out.unit)) continue;
            const k = getKey(out.resource, out.state);
            if (currentTemps[k] === undefined) {
              currentTemps[k] = getDefNetTemp(out.resource, out.state);
            }
          }
        }
      }
    }
  }

  let evaluatedRows = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    // 1. Evaluate rows with current temperatures
    evaluatedRows = rows.map((row) =>
      evaluateRow(row, entityMap, elementMap, 20.0, currentTemps)
    );

    // 2. Aggregate production and consumption by key
    const prodMass = {};
    const prodEnthalpy = {};
    const consMass = {};

    for (const r of evaluatedRows) {
      for (const inp of r.inputs) {
        if (isNonThermalResource(inp.resource, inp.unit)) continue;
        const k = getKey(inp.resource, inp.state);
        consMass[k] = (consMass[k] || 0) + inp.rate;
      }
      for (const out of r.outputs) {
        if (isNonThermalResource(out.resource, out.unit)) continue;
        const k = getKey(out.resource, out.state);
        prodMass[k] = (prodMass[k] || 0) + out.rate;
        const outT = out.tempC !== undefined ? out.tempC : 20.0;
        prodEnthalpy[k] = (prodEnthalpy[k] || 0) + out.rate * outT;
      }
    }

    // 3. Compute new blended temperature for each key
    const allKeys = new Set([
      ...Object.keys(currentTemps),
      ...Object.keys(prodMass),
      ...Object.keys(consMass),
    ]);
    let maxDiff = 0;

    for (const k of allKeys) {
      const pM = prodMass[k] || 0;
      const pH = prodEnthalpy[k] || 0;
      const cM = consMass[k] || 0;

      let res = k;
      let st = "free";
      if (k.includes("||")) {
        const parts = k.split("||");
        res = parts[0];
        st = parts[1] || "free";
      }

      const tNet = getDefNetTemp(res, st);
      const deficit = Math.max(0, cM - pM);

      let newT = tNet;
      if (pM + deficit > 1e-6) {
        newT = (pH + deficit * tNet) / (pM + deficit);
      } else if (pM > 1e-6) {
        newT = pH / pM;
      } else {
        newT = tNet;
      }

      const prevT = currentTemps[k] !== undefined ? currentTemps[k] : tNet;
      const diff = Math.abs(newT - prevT);
      if (diff > maxDiff) maxDiff = diff;
      currentTemps[k] = newT;
    }

    if (maxDiff < 1e-4) {
      break;
    }
  }

  // Final evaluation pass with converged temperatures
  evaluatedRows = rows.map((row) =>
    evaluateRow(row, entityMap, elementMap, 20.0, currentTemps)
  );

  return evaluatedRows;
}

/**
 * Calculate target quantity for each input/output stream of targetRow to exactly cancel system net.
 */
export function calculateRowMatchTargets(targetRowIndex, rows, entityMap) {
  const targetRow = rows[targetRowIndex];
  if (!targetRow) return {};

  const unitRow = evaluateRow({ ...targetRow, qty: 1 }, entityMap);
  const otherEvaluated = [];
  for (let j = 0; j < rows.length; j++) {
    if (j === targetRowIndex) continue;
    otherEvaluated.push(evaluateRow(rows[j], entityMap));
  }

  const otherBuckets = new Map();
  let otherNetPower = 0;

  for (const r of otherEvaluated) {
    otherNetPower += r.power;
    for (const inp of r.inputs) {
      const k = `${inp.resource}||${inp.state || "free"}`;
      otherBuckets.set(k, (otherBuckets.get(k) || 0) - inp.rate);
    }
    for (const out of r.outputs) {
      const k = `${out.resource}||${out.state || "free"}`;
      otherBuckets.set(k, (otherBuckets.get(k) || 0) + out.rate);
    }
  }

  const matches = {};

  for (const inp of unitRow.inputs) {
    const k = `in:${inp.resource}||${inp.state || "free"}`;
    const bucketKey = `${inp.resource}||${inp.state || "free"}`;
    const surplus = otherBuckets.get(bucketKey) || 0;
    if (surplus >= NET_RATE_EPSILON && inp.rate > 1e-6) {
      const targetQty = surplus / inp.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  for (const out of unitRow.outputs) {
    const k = `out:${out.resource}||${out.state || "free"}`;
    const bucketKey = `${out.resource}||${out.state || "free"}`;
    const deficit = otherBuckets.get(bucketKey) || 0;
    if (deficit <= -NET_RATE_EPSILON && out.rate > 1e-6) {
      const targetQty = Math.abs(deficit) / out.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  if (unitRow.power < -1e-4 && otherNetPower > 1e-4) {
    const targetQty = otherNetPower / Math.abs(unitRow.power);
    matches["in:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  } else if (unitRow.power > 1e-4 && otherNetPower < -1e-4) {
    const targetQty = Math.abs(otherNetPower) / unitRow.power;
    matches["out:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  }

  return matches;
}

/**
 * Compute system-wide NET balance across evaluated rows.
 */
export function calculateSystemNet(evaluatedRows, options = {}) {
  const netInputTemps = options.netInputTemps || {};
  const elementMap = options.elementMap || null;

  let netPower = 0;
  let netHeat = 0;
  const buckets = new Map();

  for (const row of evaluatedRows) {
    netPower += row.power;
    netHeat += row.heat !== undefined ? row.heat : 0;

    for (const inp of row.inputs) {
      const key = `${inp.resource}||${inp.state || "free"}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          resource: inp.resource,
          state: inp.state || "free",
          unit: inp.unit || "g/s",
          netRate: 0,
          temp: null,
          tempEnthalpy: 0,
          totalOutRate: 0,
        });
      }
      buckets.get(key).netRate -= inp.rate;
    }

    for (const out of row.outputs) {
      const key = `${out.resource}||${out.state || "free"}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          resource: out.resource,
          state: out.state || "free",
          unit: out.unit || "g/s",
          netRate: 0,
          temp: null,
          tempEnthalpy: 0,
          totalOutRate: 0,
        });
      }
      const b = buckets.get(key);
      b.netRate += out.rate;
      if (!isNonThermalResource(out.resource, out.unit)) {
        const t = out.tempC !== undefined ? out.tempC : 20.0;
        b.tempEnthalpy += out.rate * t;
        b.totalOutRate += out.rate;
        if (out.temp && !b.temp) b.temp = out.temp;
      }
    }
  }

  for (const b of buckets.values()) {
    if (isNonThermalResource(b.resource, b.unit)) {
      b.tempC = undefined;
      b.temp = null;
    } else if (b.totalOutRate > 0) {
      const avgT = b.tempEnthalpy / b.totalOutRate;
      b.tempC = avgT;
      b.temp = `@ ${formatNumber(avgT)} °C`;
    }
  }

  const finalBuckets = [];
  for (const b of buckets.values()) {
    if (Math.abs(b.netRate) >= NET_RATE_EPSILON) {
      finalBuckets.push(b);
    }
  }

  const netInputs = [];
  const netOutputs = [];

  for (const b of finalBuckets) {
    const isNonThermal = isNonThermalResource(b.resource, b.unit);
    if (b.netRate <= -NET_RATE_EPSILON) {
      let tempC;
      let temp = null;
      if (!isNonThermal) {
        const defT = getDefaultElementTemp(b.resource, elementMap);
        tempC = getNetInputTemp(b.resource, b.state, netInputTemps, defT);
        temp = `@ ${formatNumber(tempC)} °C`;
      }
      netInputs.push({
        resource: b.resource,
        rate: Math.abs(b.netRate),
        unit: b.unit,
        state: b.state,
        tempC,
        temp,
      });
    } else if (b.netRate >= NET_RATE_EPSILON) {
      netOutputs.push({
        resource: b.resource,
        rate: b.netRate,
        unit: b.unit,
        state: b.state,
        temp: isNonThermal ? null : b.temp,
        tempC: isNonThermal ? undefined : b.tempC,
      });
    }
  }

  return {
    netPower: Math.round(netPower * 100) / 100,
    netHeat: Math.round(netHeat * 100) / 100,
    netBuildingHeat: Math.round(netHeat * 100) / 100,
    netInputs,
    netOutputs,
  };
}
