/**
 * Terminal / Text renderer for the Calculator Not Included web UI state.
 * Renders the machine ledger table (Machine | Inputs | Outputs) and the resulting
 * NET System Balance row in a clean, human-readable ASCII table.
 */

import { buildEntityCatalog } from "./data_loader.js";
import { PRESETS } from "./presets.js";
import { decodeStateFromParam } from "./url_state.js";
import {
  resolveTableTemperatures,
  calculateSystemNet,
  formatStreamLine,
  formatNumber,
  getDefaultElementTemp,
  getNetInputTemp,
  isNonThermalResource,
  NET_RATE_EPSILON,
  DUPLICANT_DIETS,
} from "./calculator.js";

/**
 * Attempt to match a state against known built-in presets.
 *
 * @param {Object} state
 * @returns {Object|null} Matching preset or null
 */
export function findMatchingPreset(state) {
  if (!state || !Array.isArray(state.rows)) return null;
  const rateMode = state.rateMode || state.unit || "s";

  for (const preset of PRESETS) {
    const presetRate = preset.rateMode || preset.unit || "s";
    if (presetRate !== rateMode) continue;
    if (preset.rows.length !== state.rows.length) continue;

    let matched = true;
    for (let i = 0; i < preset.rows.length; i++) {
      const pr = preset.rows[i];
      const sr = state.rows[i];
      if (!sr) {
        matched = false;
        break;
      }
      if (pr.entityId !== sr.entityId) {
        matched = false;
        break;
      }
      if (Math.abs(Number(pr.qty || 1) - Number(sr.qty || 1)) > 1e-4) {
        matched = false;
        break;
      }
      if (pr.recipeId && sr.recipeId && pr.recipeId !== sr.recipeId) {
        matched = false;
        break;
      }
      if (pr.bathroom && sr.bathroom && pr.bathroom !== sr.bathroom) {
        matched = false;
        break;
      }
      if (pr.food && sr.food && pr.food !== sr.food) {
        matched = false;
        break;
      }
    }

    if (matched) return preset;
  }
  return null;
}

/**
 * Format human-readable duplicant bathroom mode.
 */
function getDuplicantBathroomName(bathroom) {
  switch (bathroom) {
    case "plumbed":
      return "Plumbed";
    case "outhouse":
      return "Outhouse";
    case "floor":
      return "Peeing on the floor";
    case "none":
      return "None";
    default:
      return bathroom ? bathroom.charAt(0).toUpperCase() + bathroom.slice(1) : "Plumbed";
  }
}

/**
 * Format human-readable duplicant food mode.
 */
function getDuplicantFoodName(food) {
  if (!food || food === "calories") return "Calories";
  if (food === "none") return "None (Fasting)";
  if (DUPLICANT_DIETS[food]?.name) return DUPLICANT_DIETS[food].name;
  return food.charAt(0).toUpperCase() + food.slice(1).replace(/_/g, " ");
}

/**
 * Extract structured rows and NET data for rendering or JSON serialization.
 *
 * @param {Object} state
 * @param {Object} catalog
 * @returns {Object} { rateMode, rowsData, netData, preset }
 */
export function computeStateData(state, catalog = null) {
  if (!catalog) {
    catalog = buildEntityCatalog();
  }

  const rateMode = state?.rateMode || state?.unit || "s";
  const rows = state?.rows || [];
  const netInputTemps = state?.netInputTemps || {};

  const evaluatedRows = resolveTableTemperatures(rows, catalog.entityMap, catalog.elementMap, {
    netInputTemps,
  });

  const net = calculateSystemNet(evaluatedRows, {
    elementMap: catalog.elementMap,
    netInputTemps,
  });

  const rowsData = evaluatedRows.map((ev, i) => {
    const row = rows[i] || {};
    const entity = ev.entity || catalog.entityMap.get(row.entityId) || { name: row.entityId || "Unknown" };

    const machineLines = [`${formatNumber(row.qty)}× ${entity.name}`];

    if (entity.recipes && entity.recipes.length > 0) {
      const curRecipe = entity.recipes.find((r) => r.id === row.recipeId) || entity.recipes[0];
      if (curRecipe && (entity.recipes.length > 1 || row.recipeId)) {
        machineLines.push(`  [Mode: ${curRecipe.name}]`);
      }
    }

    if (row.entityId === "duplicant") {
      const bName = getDuplicantBathroomName(row.bathroom);
      const fName = getDuplicantFoodName(row.food);
      machineLines.push(`  [Bathroom: ${bName}, Food: ${fName}]`);
    }

    if (Array.isArray(row.modifiers) && row.modifiers.length > 0) {
      const modNames = row.modifiers.map((mId) => {
        const mod = entity.modifiers?.find((m) => m.id === mId);
        return mod?.name || mId;
      });
      machineLines.push(`  [Modifiers: ${modNames.join(", ")}]`);
    }

    // Inputs
    const inputLines = [];
    if (ev.power < -1e-4) {
      inputLines.push(`Power: -${formatNumber(Math.abs(ev.power))} W`);
    }
    for (const stream of ev.inputs || []) {
      inputLines.push(formatStreamLine(stream, false, rateMode, catalog.elementMap));
    }
    if (inputLines.length === 0) {
      inputLines.push("—");
    }

    // Outputs
    const outputLines = [];
    if (Math.abs(ev.heat) > 1e-4) {
      outputLines.push(`Heat: ${ev.heat > 0 ? "+" : ""}${formatNumber(ev.heat)} kDTU/s`);
    }
    for (const stream of ev.outputs || []) {
      outputLines.push(formatStreamLine(stream, true, rateMode, catalog.elementMap));
    }
    if (ev.power > 1e-4) {
      outputLines.push(`Power: +${formatNumber(ev.power)} W`);
    }
    if (outputLines.length === 0) {
      outputLines.push("—");
    }

    return {
      entityId: row.entityId,
      name: entity.name,
      qty: row.qty,
      machineLines,
      inputLines,
      outputLines,
      evaluated: ev,
    };
  });

  // NET Summary
  const netMachineLines = ["NET", "System Balance"];

  const netInputLines = [];
  if (net.netPower < -1e-4) {
    netInputLines.push(`Power: -${formatNumber(Math.abs(net.netPower))} W`);
  }
  for (const stream of net.netInputs || []) {
    if (Math.abs(stream.rate || 0) < NET_RATE_EPSILON) continue;
    const streamText = formatStreamLine(stream, false, rateMode, catalog.elementMap);
    if (streamText.includes(": 0 ") || streamText.endsWith(": 0") || streamText.includes(": -0 ") || streamText.endsWith(": -0")) {
      continue;
    }
    const defaultT = getDefaultElementTemp(stream.resource, catalog.elementMap);
    const currentTemp = stream.tempC !== undefined
      ? stream.tempC
      : getNetInputTemp(stream.resource, stream.state, netInputTemps, defaultT);
    const isThermal = !isNonThermalResource(stream.resource, stream.unit);
    netInputLines.push(isThermal ? `${streamText} @ ${formatNumber(currentTemp)} °C` : streamText);
  }
  if (netInputLines.length === 0) {
    netInputLines.push("None (0 net input required)");
  }

  const netOutputLines = [];
  if (Math.abs(net.netHeat) > 1e-4) {
    netOutputLines.push(`Heat: ${net.netHeat > 0 ? "+" : ""}${formatNumber(net.netHeat)} kDTU/s`);
  }
  for (const stream of net.netOutputs || []) {
    if (Math.abs(stream.rate || 0) < NET_RATE_EPSILON) continue;
    const streamText = formatStreamLine(stream, true, rateMode, catalog.elementMap);
    if (streamText.includes(": 0 ") || streamText.endsWith(": 0") || streamText.includes(": +0 ") || streamText.endsWith(": +0")) {
      continue;
    }
    netOutputLines.push(streamText);
  }
  if (net.netPower > 1e-4) {
    netOutputLines.push(`Power: +${formatNumber(net.netPower)} W`);
  }
  if (netOutputLines.length === 0) {
    netOutputLines.push("None (0 net surplus)");
  }

  const netData = {
    machineLines: netMachineLines,
    inputLines: netInputLines,
    outputLines: netOutputLines,
    net,
  };

  const preset = findMatchingPreset(state);

  return {
    rateMode,
    rowsData,
    netData,
    preset,
  };
}

/**
 * Format structured table data into a clean ASCII table.
 *
 * @param {Array} rowsData
 * @param {Object} netData
 * @param {string} rateMode
 * @param {Object} [headerInfo]
 * @returns {string}
 */
export function formatAsciiTable(rowsData, netData, rateMode, headerInfo = {}) {
  const colNames = ["Machine", "Inputs", "Outputs"];
  let w0 = colNames[0].length;
  let w1 = colNames[1].length;
  let w2 = colNames[2].length;

  const allRows = [...rowsData, netData];
  for (const r of allRows) {
    for (const line of r.machineLines || []) w0 = Math.max(w0, line.length);
    for (const line of r.inputLines || []) w1 = Math.max(w1, line.length);
    for (const line of r.outputLines || []) w2 = Math.max(w2, line.length);
  }

  w0 = Math.max(w0, 20);
  w1 = Math.max(w1, 20);
  w2 = Math.max(w2, 20);

  const thinBorder = `+${"-".repeat(w0 + 2)}+${"-".repeat(w1 + 2)}+${"-".repeat(w2 + 2)}+`;
  const thickBorder = `+${"=".repeat(w0 + 2)}+${"=".repeat(w1 + 2)}+${"=".repeat(w2 + 2)}+`;
  const pad = (str, len) => str + " ".repeat(Math.max(0, len - str.length));

  const lines = [];

  if (headerInfo.title) {
    lines.push(`Preset: ${headerInfo.title}`);
  }
  if (headerInfo.description) {
    lines.push(`Description: ${headerInfo.description}`);
  }
  lines.push(`Rate Mode: per ${rateMode === "c" ? "cycle (600s)" : "second (/s)"}`);
  lines.push(thickBorder);
  lines.push(`| ${pad(colNames[0], w0)} | ${pad(colNames[1], w1)} | ${pad(colNames[2], w2)} |`);
  lines.push(thickBorder);

  if (rowsData.length === 0) {
    const emptyMsg = "(No machines configured in system)";
    lines.push(`| ${pad(emptyMsg, w0)} | ${pad("—", w1)} | ${pad("—", w2)} |`);
    lines.push(thinBorder);
  } else {
    for (const r of rowsData) {
      const maxL = Math.max(r.machineLines.length, r.inputLines.length, r.outputLines.length);
      for (let i = 0; i < maxL; i++) {
        const m = r.machineLines[i] || "";
        const inp = r.inputLines[i] || "";
        const out = r.outputLines[i] || "";
        lines.push(`| ${pad(m, w0)} | ${pad(inp, w1)} | ${pad(out, w2)} |`);
      }
      lines.push(thinBorder);
    }
  }

  lines.push(thickBorder);
  const maxNetL = Math.max(netData.machineLines.length, netData.inputLines.length, netData.outputLines.length);
  for (let i = 0; i < maxNetL; i++) {
    const m = netData.machineLines[i] || "";
    const inp = netData.inputLines[i] || "";
    const out = netData.outputLines[i] || "";
    lines.push(`| ${pad(m, w0)} | ${pad(inp, w1)} | ${pad(out, w2)} |`);
  }
  lines.push(thickBorder);

  return lines.join("\n");
}

/**
 * Render a calculator state object to a formatted text table.
 *
 * @param {Object} state
 * @param {Object} [options]
 * @param {Object} [options.catalog]
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {boolean} [options.showPresetInfo=true]
 * @returns {string}
 */
export function renderStateToText(state, options = {}) {
  const { catalog, title, description, showPresetInfo = true } = options;
  const data = computeStateData(state, catalog);

  const headerInfo = {};
  if (title) {
    headerInfo.title = title;
  } else if (showPresetInfo && data.preset?.name) {
    headerInfo.title = data.preset.name;
  }

  if (description) {
    headerInfo.description = description;
  } else if (showPresetInfo && data.preset?.description) {
    headerInfo.description = data.preset.description;
  }

  return formatAsciiTable(data.rowsData, data.netData, data.rateMode, headerInfo);
}

/**
 * Render a base64 or URL parameter string to a formatted text table.
 *
 * @param {string} paramStr
 * @param {Object} [options]
 * @returns {string}
 */
export function renderParamToText(paramStr, options = {}) {
  const state = decodeStateFromParam(paramStr);
  return renderStateToText(state, options);
}
