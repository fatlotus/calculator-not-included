/**
 * Pure accounting and resource balance calculation engine for ONI Math.
 * Supports per-second (/s) and per-cycle (/cycle = 600s) rates,
 * recipe selection, entity modifiers, SHC & thermal tracking, and two-stage NET cancellation.
 */

export const SECONDS_PER_CYCLE = 600;

export const ELEMENT_SHC = {
  Water: 4.179,
  "Polluted Water": 4.179,
  "Salt Water": 4.100,
  Brine: 3.400,
  Oxygen: 1.005,
  Hydrogen: 2.400,
  "Carbon Dioxide": 0.846,
  Steam: 4.179,
  Petroleum: 1.760,
  "Crude Oil": 1.690,
  Ethanol: 2.460,
  Dirt: 1.480,
  "Polluted Dirt": 1.480,
  Sand: 0.830,
  Coal: 0.900,
  "Natural Gas": 2.191,
  Chlorine: 0.480,
  "Chlorine Gas": 0.480,
  Iron: 0.449,
  Copper: 0.386,
  Gold: 0.129,
};

export function getElementShc(resource, elementMap) {
  if (elementMap?.has(resource) && elementMap.get(resource).shc) {
    return Number(elementMap.get(resource).shc);
  }
  return ELEMENT_SHC[resource] || 1.0;
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
 * Format a resource stream line.
 */
export function formatStreamLine(stream, isOutput, rateMode = "s") {
  const sign = isOutput ? "+" : "-";
  let displayRate = Math.abs(stream.rate);
  let displayUnit = stream.unit || "g/s";

  if (rateMode === "c") {
    if (displayUnit === "g/s") {
      displayRate = (displayRate * SECONDS_PER_CYCLE) / 1000;
      displayUnit = "kg/cycle";
    } else if (displayUnit === "kcal/s") {
      displayRate = displayRate * SECONDS_PER_CYCLE;
      displayUnit = "kcal/cycle";
    }
  }

  let text = `${stream.resource}: ${sign}${formatNumber(displayRate)} ${displayUnit}`;
  if (isOutput && stream.temp) {
    text += ` ${stream.temp}`;
  }
  if (stream.state) {
    text += ` (${stream.state})`;
  }
  return text;
}

/**
 * Evaluate a single calculator table row into resolved inputs, outputs, power, and thermal delta.
 */
export function evaluateRow(row, entityMap, elementMap = null, defaultInputTemp = 20.0) {
  const entity = entityMap.get(row.entityId);
  if (!entity) {
    return {
      entity: null,
      qty: row.qty || 0,
      power: 0,
      heat: 0,
      buildingHeat: 0,
      shcHeat: 0,
      totalHeat: 0,
      inputTemp: defaultInputTemp,
      inputs: [],
      outputs: [],
      isStateTransferFor: new Set(),
    };
  }

  const qty = Math.max(0, Number(row.qty) || 0);
  const activeModIds = new Set(row.modifiers || []);
  const inputTemp = row.inputTemp !== undefined && row.inputTemp !== null
    ? Number(row.inputTemp)
    : defaultInputTemp;

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

  const inputs = baseInputs.map((s) => ({ ...s, tempC: inputTemp }));
  const outputs = baseOutputs.map((s) => {
    let outTemp = inputTemp;
    let tempStr = s.temp || null;

    if (s.temp && s.temp.includes("+")) {
      const match = s.temp.match(/([0-9]+(?:\.[0-9]+)?)/);
      const minTemp = match ? parseFloat(match[1]) : 70.0;
      outTemp = Math.max(inputTemp, minTemp);
      tempStr = inputTemp > minTemp ? `@ ${formatNumber(outTemp)} °C` : `@ ${minTemp} °C+`;
    } else if (s.temp && s.temp.includes("@")) {
      const match = s.temp.match(/([0-9]+(?:\.[0-9]+)?)/);
      if (match) outTemp = parseFloat(match[1]);
    } else {
      outTemp = inputTemp;
      tempStr = `@ ${formatNumber(outTemp)} °C`;
    }

    return { ...s, temp: tempStr, tempC: outTemp };
  });

  let power = basePower;
  let heat = baseHeat;

  for (const mod of entity.modifiers || []) {
    if (!activeModIds.has(mod.id)) continue;
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
        if (existing) existing.rate += extra.rate;
        else inputs.push({ ...extra, tempC: inputTemp });
      }
    }
    if (mod.extra_outputs) {
      for (const extra of mod.extra_outputs) {
        const existing = outputs.find((s) => s.resource === extra.resource && s.state === extra.state);
        if (existing) existing.rate += extra.rate;
        else outputs.push({ ...extra, tempC: inputTemp, temp: `@ ${formatNumber(inputTemp)} °C` });
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

  // Compute thermal enthalpy flow: Q = (m * c * T) / 1000 kDTU/s
  let inEnthalpy = 0;
  for (const inp of scaledInputs) {
    const c = getElementShc(inp.resource, elementMap);
    inEnthalpy += (inp.rate * c * inputTemp) / 1000;
  }
  let outEnthalpy = 0;
  for (const out of scaledOutputs) {
    const c = getElementShc(out.resource, elementMap);
    outEnthalpy += (out.rate * c * (out.tempC !== undefined ? out.tempC : inputTemp)) / 1000;
  }
  const shcHeat = Math.round((outEnthalpy - inEnthalpy) * 100) / 100;
  const totalHeat = Math.round((scaledHeat + shcHeat) * 100) / 100;

  const isStateTransferFor = new Set();
  for (const inp of scaledInputs) {
    for (const out of scaledOutputs) {
      if (inp.resource === out.resource && inp.state !== out.state) {
        isStateTransferFor.add(inp.resource);
      }
    }
  }

  return {
    entity,
    qty,
    power: scaledPower,
    heat: scaledHeat,
    buildingHeat: scaledHeat,
    shcHeat,
    totalHeat,
    inputTemp,
    inputs: scaledInputs,
    outputs: scaledOutputs,
    isStateTransferFor,
  };
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
    if (surplus > 1e-5 && inp.rate > 1e-6) {
      const targetQty = surplus / inp.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  for (const out of unitRow.outputs) {
    const k = `out:${out.resource}||${out.state || "free"}`;
    const bucketKey = `${out.resource}||${out.state || "free"}`;
    const deficit = otherBuckets.get(bucketKey) || 0;
    if (deficit < -1e-5 && out.rate > 1e-6) {
      const targetQty = Math.abs(deficit) / out.rate;
      matches[k] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
    }
  }

  if (unitRow.power < -1e-5 && otherNetPower > 1e-5) {
    const targetQty = otherNetPower / Math.abs(unitRow.power);
    matches["in:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  } else if (unitRow.power > 1e-5 && otherNetPower < -1e-5) {
    const targetQty = Math.abs(otherNetPower) / unitRow.power;
    matches["out:Power"] = { targetQty, isMatched: Math.abs(targetQty - targetRow.qty) < 1e-4 };
  }

  return matches;
}

/**
 * Compute system-wide NET balance across evaluated rows.
 */
export function calculateSystemNet(evaluatedRows, options = {}) {
  const strictPipeMatching = options.strictPipeMatching !== undefined ? Boolean(options.strictPipeMatching) : true;

  let netPower = 0;
  let netBuildingHeat = 0;
  let netShcHeat = 0;
  const stateTransferResources = new Set();
  const buckets = new Map();

  for (const row of evaluatedRows) {
    netPower += row.power;
    netBuildingHeat += row.buildingHeat !== undefined ? row.buildingHeat : row.heat;
    netShcHeat += row.shcHeat || 0;

    for (const res of row.isStateTransferFor) {
      stateTransferResources.add(res);
    }

    for (const inp of row.inputs) {
      const key = `${inp.resource}||${inp.state || "free"}`;
      if (!buckets.has(key)) {
        buckets.set(key, { resource: inp.resource, state: inp.state || "free", unit: inp.unit || "g/s", netRate: 0, temp: null });
      }
      buckets.get(key).netRate -= inp.rate;
    }

    for (const out of row.outputs) {
      const key = `${out.resource}||${out.state || "free"}`;
      if (!buckets.has(key)) {
        buckets.set(key, { resource: out.resource, state: out.state || "free", unit: out.unit || "g/s", netRate: 0, temp: out.temp || null });
      }
      const b = buckets.get(key);
      b.netRate += out.rate;
      if (out.temp && !b.temp) b.temp = out.temp;
    }
  }

  const finalBuckets = [];
  const byResource = new Map();

  for (const b of buckets.values()) {
    if (Math.abs(b.netRate) < 1e-5) continue;
    if (!byResource.has(b.resource)) byResource.set(b.resource, []);
    byResource.get(b.resource).push(b);
  }

  for (const [resource, resBuckets] of byResource.entries()) {
    if (strictPipeMatching || stateTransferResources.has(resource) || resBuckets.length === 1) {
      finalBuckets.push(...resBuckets);
    } else {
      let combinedRate = 0;
      let dominantBucket = resBuckets[0];
      let outputTemp = null;
      for (const b of resBuckets) {
        combinedRate += b.netRate;
        if (Math.abs(b.netRate) > Math.abs(dominantBucket.netRate)) dominantBucket = b;
        if (b.netRate > 0 && b.temp) outputTemp = b.temp;
      }
      if (Math.abs(combinedRate) >= 1e-5) {
        finalBuckets.push({
          resource,
          state: dominantBucket.state,
          unit: dominantBucket.unit,
          netRate: combinedRate,
          temp: combinedRate > 0 ? outputTemp : null,
        });
      }
    }
  }

  const netInputs = [];
  const netOutputs = [];

  for (const b of finalBuckets) {
    if (b.netRate < -1e-5) {
      netInputs.push({ resource: b.resource, rate: Math.abs(b.netRate), unit: b.unit, state: b.state, temp: null });
    } else if (b.netRate > 1e-5) {
      netOutputs.push({ resource: b.resource, rate: b.netRate, unit: b.unit, state: b.state, temp: b.temp });
    }
  }

  return {
    netPower: Math.round(netPower * 100) / 100,
    netHeat: Math.round((netBuildingHeat + netShcHeat) * 100) / 100,
    netBuildingHeat: Math.round(netBuildingHeat * 100) / 100,
    netShcHeat: Math.round(netShcHeat * 100) / 100,
    netInputs,
    netOutputs,
  };
}
