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
 * Return the canonical default unit for a resource.
 */
export function getResourceDefaultUnit(resource) {
  switch (resource) {
    case "Power":
      return "W";
    case "Heat":
      return "kDTU/s";
    case "Duplicant Labor":
      return "s/s";
    case "Calories":
      return "kcal/s";
    case "Microchip":
      return "chips/s";
    case "Gear Balm":
    case "Tallow Gear Balm":
      return "balm/s";
    case "Growth":
      return "growth/s";
    default:
      return "g/s";
  }
}

/**
 * Return the canonical default stream state for a resource.
 */
export function getResourceDefaultState(resource) {
  switch (resource) {
    case "Duplicant Labor":
      return "labor";
    case "Microchip":
    case "Gear Balm":
    case "Tallow Gear Balm":
      return "solid";
    default:
      return "free";
  }
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
export function formatStreamLine(stream, isOutput, rateMode = "s", elementMap = null, options = null) {
  const sign = isOutput ? "+" : "-";
  const rawRate = Math.abs(stream.rate || 0);
  if (stream.resource === "Power") {
    const formattedVal = formatNumber(rawRate);
    const displaySign = formattedVal === "0" ? "" : sign;
    return `Power: ${displaySign}${formattedVal} W`;
  }
  const rawUnit = stream.unit || getResourceDefaultUnit(stream.resource);

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
  const showTemp = isOutput || (options && options.showTemp);
  if (showTemp && stream.temp && !isNonThermalResource(stream.resource, stream.unit)) {
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
 * Dynamic label for absorb_heat based on material state.
 */
export function getAbsorbHeatEntityName(materialName, elementMap = null) {
  let elem = null;
  if (elementMap) {
    elem = elementMap instanceof Map ? elementMap.get(materialName) : elementMap[materialName];
  }
  if (!elem && ONI_DATASET?.elements) {
    elem = ONI_DATASET.elements[materialName];
  }
  if (elem?.state === "Gas") {
    return "Absorb heat into gas";
  } else if (elem?.state === "Solid") {
    return "Absorb heat into solid";
  }
  return "Absorb heat into liquid";
}

/**
 * Apply thermal energy and element phase transitions to a material stream.
 *
 * @param {string} resource - Material name (e.g. "Water", "Crude Oil")
 * @param {number} massRate - Mass flow rate in g/s
 * @param {number} startTempC - Inlet temperature in °C
 * @param {number} deltaQkDTU - Thermal energy added (positive for heating, negative for cooling) in kDTU/s
 * @param {string} pipeState - Current delivery state ("free", "in a pipe", "solid")
 * @param {Map<string, Object>|Object|null} elementMap - Element catalog
 * @param {number} depth - Recursion guard for multi-stage transitions (e.g. Solid -> Liquid -> Gas)
 * @returns {Array<{ resource: string, rate: number, unit: string, state: string, tempC: number, temp: string }>}
 */
export function applyHeatAndPhaseChange(
  resource,
  massRate,
  startTempC,
  deltaQkDTU,
  pipeState = "free",
  elementMap = null,
  depth = 0
) {
  if (massRate <= 1e-9 || depth > 2) {
    return [{
      resource,
      rate: massRate,
      unit: "g/s",
      state: pipeState,
      tempC: startTempC,
      temp: `@ ${formatNumber(startTempC)} °C`,
    }];
  }

  let elem = null;
  if (elementMap) {
    elem = elementMap instanceof Map ? elementMap.get(resource) : elementMap[resource];
  }
  if (!elem && ONI_DATASET?.elements) {
    elem = ONI_DATASET.elements[resource];
  }

  if (!elem) {
    return [{
      resource,
      rate: massRate,
      unit: "g/s",
      state: pipeState,
      tempC: startTempC,
      temp: `@ ${formatNumber(startTempC)} °C`,
    }];
  }

  const c = (elem.shc !== undefined && elem.shc !== null && !isNaN(Number(elem.shc))) ? Number(elem.shc) : 1.0;

  if (Math.abs(deltaQkDTU) < 1e-9) {
    const outState = isSolidResource(resource, elementMap) ? "free" : pipeState;
    return [{
      resource,
      rate: massRate,
      unit: "g/s",
      state: outState,
      tempC: startTempC,
      temp: `@ ${formatNumber(startTempC)} °C`,
    }];
  }

  const deltaT = (deltaQkDTU * 1000.0) / (massRate * c);
  const targetTemp = startTempC + deltaT;

  // 1. High-Temp Phase Change Transition (Heating)
  if (
    deltaQkDTU > 0 &&
    elem.high_temp_transition &&
    elem.high_temp !== null &&
    elem.high_temp !== undefined
  ) {
    const tHigh = Number(elem.high_temp);
    if (targetTemp >= tHigh) {
      const qToThreshold = startTempC < tHigh
        ? ((tHigh - startTempC) * massRate * c) / 1000.0
        : 0;
      const qRemaining = Math.max(0, deltaQkDTU - qToThreshold);

      const outputsDef = elem.high_temp_transition.outputs && elem.high_temp_transition.outputs.length > 0
        ? elem.high_temp_transition.outputs
        : [{ element: elem.high_temp_transition.target, ratio: 1.0 }];

      let c_prod = 0;
      for (const out of outputsDef) {
        let outElem = null;
        if (elementMap) {
          outElem = elementMap instanceof Map ? elementMap.get(out.element) : elementMap[out.element];
        }
        if (!outElem && ONI_DATASET?.elements) {
          outElem = ONI_DATASET.elements[out.element];
        }
        const outShc = (outElem && outElem.shc) ? Number(outElem.shc) : c;
        c_prod += out.ratio * outShc;
      }
      if (c_prod <= 0) c_prod = c;

      const tBase = Math.max(startTempC, tHigh);
      const finalTemp = tBase + (qRemaining * 1000.0) / (massRate * c_prod);

      // Multi-stage check: if single output exceeds its own high_temp
      if (outputsDef.length === 1 && depth < 2) {
        const nextElemName = outputsDef[0].element;
        let nextElem = null;
        if (elementMap) {
          nextElem = elementMap instanceof Map ? elementMap.get(nextElemName) : elementMap[nextElemName];
        }
        if (!nextElem && ONI_DATASET?.elements) {
          nextElem = ONI_DATASET.elements[nextElemName];
        }
        if (
          nextElem &&
          nextElem.high_temp_transition &&
          nextElem.high_temp !== null &&
          nextElem.high_temp !== undefined &&
          finalTemp >= nextElem.high_temp
        ) {
          let nextState = pipeState;
          if (nextElem.state !== elem.state || isSolidResource(nextElemName, elementMap)) {
            nextState = "free";
          }
          return applyHeatAndPhaseChange(
            nextElemName,
            massRate * outputsDef[0].ratio,
            tBase,
            qRemaining,
            nextState,
            elementMap,
            depth + 1
          );
        }
      }

      const results = [];
      for (const out of outputsDef) {
        let outElem = null;
        if (elementMap) {
          outElem = elementMap instanceof Map ? elementMap.get(out.element) : elementMap[out.element];
        }
        if (!outElem && ONI_DATASET?.elements) {
          outElem = ONI_DATASET.elements[out.element];
        }
        let outState = pipeState;
        if (depth > 0 || out.element !== resource || !outElem || outElem.state !== elem.state || outElem?.state === "Solid" || isSolidResource(out.element, elementMap)) {
          outState = "free";
        }
        results.push({
          resource: out.element,
          rate: massRate * out.ratio,
          unit: "g/s",
          state: outState,
          tempC: finalTemp,
          temp: `@ ${formatNumber(finalTemp)} °C`,
        });
      }
      return results;
    }
  }

  // 2. Low-Temp Phase Change Transition (Cooling)
  if (
    deltaQkDTU < 0 &&
    elem.low_temp_transition &&
    elem.low_temp !== null &&
    elem.low_temp !== undefined
  ) {
    const tLow = Number(elem.low_temp);
    if (targetTemp <= tLow) {
      const absQ = Math.abs(deltaQkDTU);
      const qToThreshold = startTempC > tLow
        ? ((startTempC - tLow) * massRate * c) / 1000.0
        : 0;
      const qRemaining = Math.max(0, absQ - qToThreshold);

      const outputsDef = elem.low_temp_transition.outputs && elem.low_temp_transition.outputs.length > 0
        ? elem.low_temp_transition.outputs
        : [{ element: elem.low_temp_transition.target, ratio: 1.0 }];

      let c_prod = 0;
      for (const out of outputsDef) {
        let outElem = null;
        if (elementMap) {
          outElem = elementMap instanceof Map ? elementMap.get(out.element) : elementMap[out.element];
        }
        if (!outElem && ONI_DATASET?.elements) {
          outElem = ONI_DATASET.elements[out.element];
        }
        const outShc = (outElem && outElem.shc) ? Number(outElem.shc) : c;
        c_prod += out.ratio * outShc;
      }
      if (c_prod <= 0) c_prod = c;

      const tBase = Math.min(startTempC, tLow);
      const finalTemp = Math.max(-273.15, tBase - (qRemaining * 1000.0) / (massRate * c_prod));

      // Multi-stage check: if single output drops below its own low_temp
      if (outputsDef.length === 1 && depth < 2) {
        const nextElemName = outputsDef[0].element;
        let nextElem = null;
        if (elementMap) {
          nextElem = elementMap instanceof Map ? elementMap.get(nextElemName) : elementMap[nextElemName];
        }
        if (!nextElem && ONI_DATASET?.elements) {
          nextElem = ONI_DATASET.elements[nextElemName];
        }
        if (
          nextElem &&
          nextElem.low_temp_transition &&
          nextElem.low_temp !== null &&
          nextElem.low_temp !== undefined &&
          finalTemp <= nextElem.low_temp
        ) {
          let nextState = pipeState;
          if (nextElem.state !== elem.state || isSolidResource(nextElemName, elementMap)) {
            nextState = "free";
          }
          return applyHeatAndPhaseChange(
            nextElemName,
            massRate * outputsDef[0].ratio,
            tBase,
            -qRemaining,
            nextState,
            elementMap,
            depth + 1
          );
        }
      }

      const results = [];
      for (const out of outputsDef) {
        let outElem = null;
        if (elementMap) {
          outElem = elementMap instanceof Map ? elementMap.get(out.element) : elementMap[out.element];
        }
        if (!outElem && ONI_DATASET?.elements) {
          outElem = ONI_DATASET.elements[out.element];
        }
        let outState = pipeState;
        if (depth > 0 || out.element !== resource || !outElem || outElem.state !== elem.state || outElem?.state === "Solid" || isSolidResource(out.element, elementMap)) {
          outState = "free";
        }
        results.push({
          resource: out.element,
          rate: massRate * out.ratio,
          unit: "g/s",
          state: outState,
          tempC: finalTemp,
          temp: `@ ${formatNumber(finalTemp)} °C`,
        });
      }
      return results;
    }
  }

  // 3. Sensible temperature change without phase transition
  const finalTemp = Math.max(-273.15, targetTemp);
  const outState = isSolidResource(resource, elementMap) ? "free" : pipeState;
  return [{
    resource,
    rate: massRate,
    unit: "g/s",
    state: outState,
    tempC: finalTemp,
    temp: `@ ${formatNumber(finalTemp)} °C`,
  }];
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
  inputTemps = null,
  options = null
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

  // Meta-Machine: Absorb Heat into liquid / gas / solid
  if (row.entityId === "absorb_heat" || entity.id === "absorb_heat") {
    const mat = row.material || "Water";
    const matState = isSolidResource(mat, elementMap) ? "free" : (row.materialState || "free");
    const massRate =
      options?.streamRates?.massRate ??
      options?.streamRates?.rate ??
      row.rate ??
      1000.0;

    let inpTemp = defaultInputTemp;
    if (inputTemps && typeof inputTemps === "object") {
      const k = `${mat}||${matState}`;
      const kSingle = `${mat}|${matState}`;
      if (inputTemps[k] !== undefined) inpTemp = Number(inputTemps[k]);
      else if (inputTemps[kSingle] !== undefined) inpTemp = Number(inputTemps[kSingle]);
      else if (inputTemps[mat] !== undefined) inpTemp = Number(inputTemps[mat]);
      else inpTemp = getDefaultElementTemp(mat, elementMap);
    } else if (row.inputTemp !== undefined && row.inputTemp !== null && !isNaN(Number(row.inputTemp))) {
      inpTemp = Number(row.inputTemp);
    } else {
      inpTemp = getDefaultElementTemp(mat, elementMap);
    }

    const deltaQ = 10.0 * qty;
    const inputs = [
      {
        resource: mat,
        rate: massRate,
        unit: "g/s",
        state: matState,
        tempC: inpTemp,
        temp: `@ ${formatNumber(inpTemp)} °C`,
      },
    ];

    const outputs = applyHeatAndPhaseChange(
      mat,
      massRate,
      inpTemp,
      deltaQ,
      matState,
      elementMap
    );

    const buildingHeat = -10.0 * qty;
    const dynamicEntity = {
      ...entity,
      name: getAbsorbHeatEntityName(mat, elementMap),
    };

    return {
      entity: dynamicEntity,
      qty,
      power: 0,
      heat: buildingHeat,
      buildingHeat,
      inputTemp: inpTemp,
      inputs: qty <= 0 ? [] : inputs,
      outputs: qty <= 0 ? [] : outputs,
      isStateTransferFor: new Set(),
    };
  }

  // Meta-Machine: Counterflow Heat Exchanger
  if (row.entityId === "counterflow_heat_exchanger" || entity.id === "counterflow_heat_exchanger") {
    const hotMat = row.material || "Petroleum";
    const hotState = isSolidResource(hotMat, elementMap) ? "free" : (row.materialState || "free");
    const coldMat = row.coldMaterial || "Crude Oil";
    const coldState = isSolidResource(coldMat, elementMap) ? "free" : (row.coldMaterialState || "in a pipe");

    const elemHot = elementMap instanceof Map ? elementMap.get(hotMat) : elementMap?.[hotMat];
    const elemCold = elementMap instanceof Map ? elementMap.get(coldMat) : elementMap?.[coldMat];
    const shcHot = (elemHot?.shc !== undefined && elemHot?.shc !== null && Number(elemHot.shc) > 0) ? Number(elemHot.shc) : 1.0;
    const shcCold = (elemCold?.shc !== undefined && elemCold?.shc !== null && Number(elemCold.shc) > 0) ? Number(elemCold.shc) : 1.0;

    // Unit rate is 1000 / shc g/s (1 / shc kg/s), scaling with qty
    const hotRate = (1000.0 / shcHot) * qty;
    const coldRate = (1000.0 / shcCold) * qty;

    let tHotIn = defaultInputTemp;
    let tColdIn = defaultInputTemp;

    if (inputTemps && typeof inputTemps === "object") {
      const kHot = `${hotMat}||${hotState}`;
      const kHotSingle = `${hotMat}|${hotState}`;
      if (inputTemps[kHot] !== undefined) tHotIn = Number(inputTemps[kHot]);
      else if (inputTemps[kHotSingle] !== undefined) tHotIn = Number(inputTemps[kHotSingle]);
      else if (inputTemps[hotMat] !== undefined) tHotIn = Number(inputTemps[hotMat]);
      else tHotIn = getDefaultElementTemp(hotMat, elementMap);

      const kCold = `${coldMat}||${coldState}`;
      const kColdSingle = `${coldMat}|${coldState}`;
      if (inputTemps[kCold] !== undefined) tColdIn = Number(inputTemps[kCold]);
      else if (inputTemps[kColdSingle] !== undefined) tColdIn = Number(inputTemps[kColdSingle]);
      else if (inputTemps[coldMat] !== undefined) tColdIn = Number(inputTemps[coldMat]);
      else tColdIn = getDefaultElementTemp(coldMat, elementMap);
    } else {
      tHotIn = getDefaultElementTemp(hotMat, elementMap);
      tColdIn = getDefaultElementTemp(coldMat, elementMap);
    }

    if (row.inputTemp !== undefined && row.inputTemp !== null && !isNaN(Number(row.inputTemp))) {
      tHotIn = Number(row.inputTemp);
    }

    const inputs = [
      {
        resource: hotMat,
        rate: hotRate,
        unit: "g/s",
        state: hotState,
        tempC: tHotIn,
        temp: `@ ${formatNumber(tHotIn)} °C`,
      },
      {
        resource: coldMat,
        rate: coldRate,
        unit: "g/s",
        state: coldState,
        tempC: tColdIn,
        temp: `@ ${formatNumber(tColdIn)} °C`,
      },
    ];

    // Completely swap temperatures while conserving enthalpy
    const outputs = [
      {
        resource: hotMat,
        rate: hotRate,
        unit: "g/s",
        state: hotState,
        tempC: tColdIn,
        temp: `@ ${formatNumber(tColdIn)} °C`,
      },
      {
        resource: coldMat,
        rate: coldRate,
        unit: "g/s",
        state: coldState,
        tempC: tHotIn,
        temp: `@ ${formatNumber(tHotIn)} °C`,
      },
    ];

    return {
      entity,
      qty,
      power: 0,
      heat: 0,
      buildingHeat: 0,
      inputTemp: tHotIn,
      inputs: qty <= 0 ? [] : inputs,
      outputs: qty <= 0 ? [] : outputs,
      isStateTransferFor: new Set(),
    };
  }

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

  // Dynamic Steam Turbine power and heat calculation based on inlet steam temperature
  if (row.entityId === "steam_turbine" || entity.id === "steam_turbine") {
    let inTemp = inputs[0]?.tempC;
    if (inTemp === undefined || inTemp === null || isNaN(inTemp)) {
      inTemp = row.inputTemp !== undefined ? Number(row.inputTemp) : (getDefaultElementTemp("Steam", elementMap) || 126.85);
      if (inputs[0]) inputs[0].tempC = inTemp;
    }
    if (inTemp < 125.0) {
      basePower = 0.0;
      baseHeat = 0.0;
    } else {
      const qRemoved = (2000.0 * 4.179 * (inTemp - 95.0)) / 1000.0;
      basePower = Math.min(850.0, 850.0 * ((inTemp - 95.0) / 105.0));
      baseHeat = 4.0 + 0.10 * qRemoved;
    }
  }

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
 * Resolve element temperatures sequentially from top to bottom across the table rows.
 * Starts with any fixed-temperature streams from Loop Start (options.loops),
 * then propagates available pool mass and temperature top-to-bottom through each row.
 * If a row requires more of a resource than is currently in the upstream pool,
 * the shortfall is drawn from external NET inputs at the NET input temperature.
 */
export function resolveTableTemperatures(rows, entityMap, elementMap = null, options = {}) {
  const netInputTemps = (typeof options === "object" && options.netInputTemps) || {};
  const loops =
    (typeof options === "object" && Array.isArray(options.loops) ? options.loops : rows?._loops) || [];

  if (!rows || rows.length === 0) {
    const empty = [];
    Object.defineProperty(empty, "_loops", { value: loops, enumerable: false, writable: true });
    return empty;
  }

  const getKey = (res, st) => `${res}||${st || "free"}`;

  const getDefNetTemp = (res, st) => {
    const def = getDefaultElementTemp(res, elementMap);
    return getNetInputTemp(res, st, netInputTemps, def);
  };

  // Running top-to-bottom pool: key -> { availRate, availTempC }
  const pool = new Map();

  // 1. Seed pool from Loop Start
  for (const loop of loops) {
    if (!loop || !loop.resource) continue;
    const rate = Number(loop.rate);
    if (!(rate > 0)) continue;
    const unit = loop.unit || getResourceDefaultUnit(loop.resource);
    if (isNonThermalResource(loop.resource, unit)) continue;
    const st = loop.state || getResourceDefaultState(loop.resource);
    const k = getKey(loop.resource, st);
    const loopTemp =
      loop.tempC !== undefined && loop.tempC !== null && !isNaN(Number(loop.tempC))
        ? Number(loop.tempC)
        : getDefNetTemp(loop.resource, st);

    if (!pool.has(k)) {
      pool.set(k, { availRate: rate, availTempC: loopTemp });
    } else {
      const p = pool.get(k);
      const newRate = p.availRate + rate;
      p.availTempC = newRate > 1e-9 ? (p.availRate * p.availTempC + rate * loopTemp) / newRate : loopTemp;
      p.availRate = newRate;
    }
  }

  const evaluatedRows = [];

  // 2. Step sequentially top-to-bottom through machine rows
  for (const row of rows) {
    let streamRates = null;
    if (row.entityId === "absorb_heat") {
      const mat = row.material || "Water";
      const st = isSolidResource(mat, elementMap) ? "free" : (row.materialState || "free");
      const p = pool.get(getKey(mat, st));
      const avail = p ? p.availRate : 0;
      const massRate = avail > 1e-6 ? avail : (row.rate ?? 1000.0);
      streamRates = { massRate, rate: massRate };
    }

    const preEval = evaluateRow(row, entityMap, elementMap, 20.0, null, { streamRates });
    const rowInputTemps = {};

    for (const inp of preEval.inputs) {
      if (isNonThermalResource(inp.resource, inp.unit)) continue;
      const st = inp.state || "free";
      const k = getKey(inp.resource, st);
      const tNet = getDefNetTemp(inp.resource, st);

      if (row.inputTemp !== undefined && row.inputTemp !== null && !isNaN(Number(row.inputTemp))) {
        rowInputTemps[k] = Number(row.inputTemp);
        continue;
      }

      const p = pool.get(k);
      const availRate = p ? p.availRate : 0;
      const availTempC = p ? p.availTempC : tNet;
      const reqRate = Math.abs(inp.rate || 0);

      if (reqRate > 1e-9) {
        const fromPool = Math.min(reqRate, availRate);
        const fromExt = Math.max(0, reqRate - availRate);
        rowInputTemps[k] = (fromPool * availTempC + fromExt * tNet) / reqRate;
      } else {
        rowInputTemps[k] = availRate > 1e-9 ? availTempC : tNet;
      }
    }

    const ev = evaluateRow(row, entityMap, elementMap, 20.0, rowInputTemps, { streamRates });

    // Consume inputs from running pool
    for (const inp of ev.inputs) {
      if (isNonThermalResource(inp.resource, inp.unit)) continue;
      const st = inp.state || "free";
      const k = getKey(inp.resource, st);
      const p = pool.get(k);
      if (p) {
        p.availRate = Math.max(0, p.availRate - Math.abs(inp.rate || 0));
      }
    }

    // Add outputs into running pool
    for (const out of ev.outputs) {
      if (isNonThermalResource(out.resource, out.unit)) continue;
      const outRate = Math.abs(out.rate || 0);
      if (outRate <= 1e-9) continue;
      const st = out.state || "free";
      const k = getKey(out.resource, st);
      const outTemp = out.tempC !== undefined ? out.tempC : getDefNetTemp(out.resource, st);

      if (!pool.has(k)) {
        pool.set(k, { availRate: outRate, availTempC: outTemp });
      } else {
        const p = pool.get(k);
        const newRate = p.availRate + outRate;
        p.availTempC = newRate > 1e-9 ? (p.availRate * p.availTempC + outRate * outTemp) / newRate : outTemp;
        p.availRate = newRate;
      }
    }

    evaluatedRows.push(ev);
  }

  Object.defineProperty(evaluatedRows, "_loops", { value: loops, enumerable: false, writable: true });
  return evaluatedRows;
}

/**
 * Calculate target quantity for each input/output stream of targetRow in top-to-bottom flow:
 * - Input streams match the available unconsumed surplus arriving from rows above targetRow (including Loop Start).
 * - Output streams match the cumulative unmet deficit of rows below targetRow (including Loop End).
 */
export function calculateRowMatchTargets(targetRowIndex, rows, entityMap, options = {}) {
  const targetRow = rows?.[targetRowIndex];
  if (!targetRow) return {};

  const elementMap = options?.elementMap || null;
  const loops =
    (options && Array.isArray(options.loops) ? options.loops : rows?._loops) || [];

  const evaluatedRows =
    options?.evaluatedRows ||
    resolveTableTemperatures(rows, entityMap, elementMap, options);

  const unitRow = evaluateRow({ ...targetRow, qty: 1 }, entityMap, elementMap);
  const currentTargetEval =
    evaluatedRows[targetRowIndex] || evaluateRow(targetRow, entityMap, elementMap);

  // 1. Simulate upstream pool from Loop Start through rows[0 .. targetRowIndex - 1]
  const upstreamPool = new Map();
  let upstreamPower = 0;

  for (const loop of loops) {
    if (!loop || !loop.resource) continue;
    const rate = Number(loop.rate);
    if (!(rate > 0)) continue;
    if (loop.resource === "Power") {
      upstreamPower += rate;
    } else {
      const st = loop.state || getResourceDefaultState(loop.resource);
      const k = `${loop.resource}||${st}`;
      upstreamPool.set(k, (upstreamPool.get(k) || 0) + rate);
    }
  }

  for (let j = 0; j < targetRowIndex; j++) {
    const r = evaluatedRows[j] || evaluateRow(rows[j], entityMap, elementMap);
    if (r.power < 0) {
      upstreamPower = Math.max(0, upstreamPower - Math.abs(r.power));
    }
    for (const inp of r.inputs) {
      const k = `${inp.resource}||${inp.state || "free"}`;
      upstreamPool.set(k, Math.max(0, (upstreamPool.get(k) || 0) - inp.rate));
    }
    for (const out of r.outputs) {
      const k = `${out.resource}||${out.state || "free"}`;
      upstreamPool.set(k, (upstreamPool.get(k) || 0) + out.rate);
    }
    if (r.power > 0) {
      upstreamPower += r.power;
    }
  }

  const matches = {};

  // Match inputs against upstream available pool arriving at targetRowIndex
  for (const inp of unitRow.inputs) {
    const bucketKey = `${inp.resource}||${inp.state || "free"}`;
    const k = `in:${bucketKey}`;
    const surplus = upstreamPool.get(bucketKey) || 0;
    if (surplus >= NET_RATE_EPSILON && inp.rate > 1e-6) {
      const targetQty = surplus / inp.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  if (unitRow.power < -1e-4 && upstreamPower > 1e-4) {
    const targetQty = upstreamPower / Math.abs(unitRow.power);
    matches["in:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  }

  // 2. Simulate downstream deficit from targetRowIndex + 1 through Loop End (with 0 output from targetRow)
  const downstreamPool = new Map(upstreamPool);
  let downstreamPowerPool = upstreamPower;

  // Consume targetRow's own inputs first
  if (currentTargetEval.power < 0) {
    downstreamPowerPool = Math.max(0, downstreamPowerPool - Math.abs(currentTargetEval.power));
  }
  for (const inp of currentTargetEval.inputs) {
    const k = `${inp.resource}||${inp.state || "free"}`;
    downstreamPool.set(k, Math.max(0, (downstreamPool.get(k) || 0) - inp.rate));
  }

  const downstreamDeficit = new Map();
  let downstreamPowerDeficit = 0;

  for (let j = targetRowIndex + 1; j < rows.length; j++) {
    const r = evaluatedRows[j] || evaluateRow(rows[j], entityMap, elementMap);
    if (r.power < 0) {
      const reqP = Math.abs(r.power);
      const fromPoolP = Math.min(reqP, downstreamPowerPool);
      const fromExtP = Math.max(0, reqP - downstreamPowerPool);
      downstreamPowerPool = Math.max(0, downstreamPowerPool - fromPoolP);
      downstreamPowerDeficit += fromExtP;
    }
    for (const inp of r.inputs) {
      const k = `${inp.resource}||${inp.state || "free"}`;
      const avail = downstreamPool.get(k) || 0;
      const fromPool = Math.min(inp.rate, avail);
      const fromExt = Math.max(0, inp.rate - avail);
      downstreamPool.set(k, Math.max(0, avail - fromPool));
      downstreamDeficit.set(k, (downstreamDeficit.get(k) || 0) + fromExt);
    }
    for (const out of r.outputs) {
      const k = `${out.resource}||${out.state || "free"}`;
      downstreamPool.set(k, (downstreamPool.get(k) || 0) + out.rate);
    }
    if (r.power > 0) {
      downstreamPowerPool += r.power;
    }
  }

  // Also consume Loop End demands
  for (const loop of loops) {
    if (!loop || !loop.resource) continue;
    const reqRate = Number(loop.rate);
    if (!(reqRate > 0)) continue;
    if (loop.resource === "Power") {
      const fromPoolP = Math.min(reqRate, downstreamPowerPool);
      const fromExtP = Math.max(0, reqRate - downstreamPowerPool);
      downstreamPowerPool = Math.max(0, downstreamPowerPool - fromPoolP);
      downstreamPowerDeficit += fromExtP;
    } else {
      const st = loop.state || getResourceDefaultState(loop.resource);
      const k = `${loop.resource}||${st}`;
      const avail = downstreamPool.get(k) || 0;
      const fromPool = Math.min(reqRate, avail);
      const fromExt = Math.max(0, reqRate - avail);
      downstreamPool.set(k, Math.max(0, avail - fromPool));
      downstreamDeficit.set(k, (downstreamDeficit.get(k) || 0) + fromExt);
    }
  }

  for (const out of unitRow.outputs) {
    const bucketKey = `${out.resource}||${out.state || "free"}`;
    const k = `out:${bucketKey}`;
    const deficit = downstreamDeficit.get(bucketKey) || 0;
    if (deficit >= NET_RATE_EPSILON && out.rate > 1e-6) {
      const targetQty = deficit / out.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  if (unitRow.power > 1e-4 && downstreamPowerDeficit > 1e-4) {
    const targetQty = downstreamPowerDeficit / unitRow.power;
    matches["out:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  }

  // Special match targets for Meta-Machines:
  if (targetRow.entityId === "absorb_heat") {
    // 1. Balance net system heat produced by other rows
    let otherPositiveHeat = 0;
    for (let j = 0; j < rows.length; j++) {
      if (j !== targetRowIndex) {
        const r = evaluatedRows[j];
        if (r && r.heat > 1e-4) otherPositiveHeat += r.heat;
      }
    }
    if (otherPositiveHeat > 1e-4) {
      const targetQty = otherPositiveHeat / 10.0;
      matches["out:Heat"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }

    // 2. Heat to phase change transition
    const mat = targetRow.material || "Water";
    const elem = elementMap instanceof Map ? elementMap.get(mat) : elementMap?.[mat];
    if (elem?.high_temp_transition && elem.high_temp !== null && elem.high_temp !== undefined) {
      const tIn = currentTargetEval.inputTemp;
      if (tIn < elem.high_temp) {
        const massRate = currentTargetEval.inputs[0]?.rate || 1000.0;
        const c = (elem.shc !== undefined && elem.shc !== null) ? Number(elem.shc) : 1.0;
        const qToThreshold = ((elem.high_temp - tIn) * massRate * c) / 1000.0;
        const targetQty = qToThreshold / 10.0;
        matches["out:phase_change"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
      }
    }
  }

  return matches;
}

/**
 * Compute system-wide NET balance across evaluated rows using top-to-bottom resource flow.
 * Resources (including Power) flow from Loop Start -> evaluatedRows[0..N-1] -> Loop End.
 * Unmet inputs at any step accumulate into NET Inputs; unconsumed outputs remaining after Loop End flow into NET Outputs.
 */
export function calculateSystemNet(evaluatedRows, options = {}) {
  const netInputTemps = options.netInputTemps || {};
  const elementMap = options.elementMap || null;
  const loops =
    (options && Array.isArray(options.loops) ? options.loops : evaluatedRows?._loops) || [];

  let availPower = 0;
  let deficitPower = 0;
  let netHeat = 0;
  const buckets = new Map();

  const getOrCreateBucket = (resource, state, unit) => {
    const st = state || getResourceDefaultState(resource);
    const key = `${resource}||${st}`;
    if (!buckets.has(key)) {
      const defT = getDefaultElementTemp(resource, elementMap);
      const initTemp = getNetInputTemp(resource, st, netInputTemps, defT);
      buckets.set(key, {
        resource,
        state: st,
        unit: unit || getResourceDefaultUnit(resource),
        availRate: 0,
        availTempC: initTemp,
        deficitRate: 0,
      });
    }
    return buckets.get(key);
  };

  const loopStartStreams = [];
  const loopEndStreams = [];

  // 1. Inject Loop Start streams into the top of the table
  for (const loop of loops) {
    if (!loop || !loop.resource) continue;
    const rate = Number(loop.rate);
    if (!(rate > 0)) continue;

    if (loop.resource === "Power") {
      availPower += rate;
      loopStartStreams.push({
        resource: "Power",
        state: "free",
        rate,
        unit: "W",
        temp: null,
        tempC: undefined,
        isPower: true,
      });
      continue;
    }

    const st = loop.state || getResourceDefaultState(loop.resource);
    const unit = loop.unit || getResourceDefaultUnit(loop.resource);
    const isNonThermal = isNonThermalResource(loop.resource, unit);
    const defT = getDefaultElementTemp(loop.resource, elementMap);
    const tempC = !isNonThermal
      ? loop.tempC !== undefined && loop.tempC !== null && !isNaN(Number(loop.tempC))
        ? Number(loop.tempC)
        : getNetInputTemp(loop.resource, st, netInputTemps, defT)
      : undefined;
    const temp = !isNonThermal ? `@ ${formatNumber(tempC)} °C` : null;

    const b = getOrCreateBucket(loop.resource, st, unit);
    if (!isNonThermal && rate > 1e-9) {
      const newRate = b.availRate + rate;
      b.availTempC = newRate > 1e-9 ? (b.availRate * b.availTempC + rate * tempC) / newRate : tempC;
      b.availRate = newRate;
    } else {
      b.availRate += rate;
    }

    loopStartStreams.push({
      resource: loop.resource,
      state: st,
      rate,
      unit,
      temp,
      tempC,
    });
  }

  // 2. Process machine rows sequentially from top to bottom
  for (const row of evaluatedRows || []) {
    netHeat += row.heat !== undefined ? row.heat : 0;

    if (row.power < 0) {
      const reqP = Math.abs(row.power);
      const fromPoolP = Math.min(reqP, availPower);
      const fromExtP = Math.max(0, reqP - availPower);
      availPower = Math.max(0, availPower - fromPoolP);
      deficitPower += fromExtP;
    }

    for (const inp of row.inputs || []) {
      const b = getOrCreateBucket(inp.resource, inp.state || "free", inp.unit);
      const reqRate = Math.abs(inp.rate || 0);
      const fromPool = Math.min(reqRate, b.availRate);
      const fromExt = Math.max(0, reqRate - b.availRate);
      b.availRate = Math.max(0, b.availRate - fromPool);
      b.deficitRate += fromExt;
    }

    for (const out of row.outputs || []) {
      const b = getOrCreateBucket(out.resource, out.state || "free", out.unit);
      const outRate = Math.abs(out.rate || 0);
      if (!isNonThermalResource(out.resource, out.unit) && outRate > 1e-9) {
        const t = out.tempC !== undefined ? out.tempC : 20.0;
        const newRate = b.availRate + outRate;
        b.availTempC = newRate > 1e-9 ? (b.availRate * b.availTempC + outRate * t) / newRate : t;
        b.availRate = newRate;
      } else {
        b.availRate += outRate;
      }
    }

    if (row.power > 0) {
      availPower += row.power;
    }
  }

  // 3. Process Loop End streams at the bottom of the table
  for (const loop of loops) {
    if (!loop || !loop.resource) continue;
    const reqRate = Number(loop.rate);
    if (!(reqRate > 0)) continue;

    if (loop.resource === "Power") {
      const fromPoolP = Math.min(reqRate, availPower);
      const fromExtP = Math.max(0, reqRate - availPower);
      availPower = Math.max(0, availPower - fromPoolP);
      deficitPower += fromExtP;
      loopEndStreams.push({
        resource: "Power",
        state: "free",
        rate: reqRate,
        unit: "W",
        temp: null,
        tempC: undefined,
        isPower: true,
      });
      continue;
    }

    const st = loop.state || getResourceDefaultState(loop.resource);
    const unit = loop.unit || getResourceDefaultUnit(loop.resource);
    const b = getOrCreateBucket(loop.resource, st, unit);
    const isNonThermal = isNonThermalResource(loop.resource, unit);
    const defT = getDefaultElementTemp(loop.resource, elementMap);
    const tNet = getNetInputTemp(loop.resource, st, netInputTemps, defT);

    const fromPool = Math.min(reqRate, b.availRate);
    const fromExt = Math.max(0, reqRate - b.availRate);

    let arrivingTempC = undefined;
    let arrivingTemp = null;
    if (!isNonThermal) {
      arrivingTempC = reqRate > 1e-9 ? (fromPool * b.availTempC + fromExt * tNet) / reqRate : b.availTempC;
      arrivingTemp = `@ ${formatNumber(arrivingTempC)} °C`;
    }

    b.availRate = Math.max(0, b.availRate - fromPool);
    b.deficitRate += fromExt;

    loopEndStreams.push({
      resource: loop.resource,
      state: st,
      rate: reqRate,
      unit,
      temp: arrivingTemp,
      tempC: arrivingTempC,
    });
  }

  // 4. Collect NET Inputs and NET Outputs
  const netInputs = [];
  const netOutputs = [];

  for (const b of buckets.values()) {
    const isNonThermal = isNonThermalResource(b.resource, b.unit);
    if (b.deficitRate >= NET_RATE_EPSILON) {
      let tempC;
      let temp = null;
      if (!isNonThermal) {
        const defT = getDefaultElementTemp(b.resource, elementMap);
        tempC = getNetInputTemp(b.resource, b.state, netInputTemps, defT);
        temp = `@ ${formatNumber(tempC)} °C`;
      }
      netInputs.push({
        resource: b.resource,
        rate: b.deficitRate,
        unit: b.unit,
        state: b.state,
        tempC,
        temp,
      });
    }
    if (b.availRate >= NET_RATE_EPSILON) {
      const avgT = b.availTempC;
      netOutputs.push({
        resource: b.resource,
        rate: b.availRate,
        unit: b.unit,
        state: b.state,
        temp: isNonThermal ? null : `@ ${formatNumber(avgT)} °C`,
        tempC: isNonThermal ? undefined : avgT,
      });
    }
  }

  const netPowerIn = deficitPower >= NET_RATE_EPSILON ? Math.round(deficitPower * 100) / 100 : 0;
  const netPowerOut = availPower >= NET_RATE_EPSILON ? Math.round(availPower * 100) / 100 : 0;
  const netPower = Math.round((availPower - deficitPower) * 100) / 100;

  return {
    netPower,
    netPowerIn,
    netPowerOut,
    netHeat: Math.round(netHeat * 100) / 100,
    netBuildingHeat: Math.round(netHeat * 100) / 100,
    netInputs,
    netOutputs,
    loopStartStreams,
    loopEndStreams,
  };
}
