/**
 * Ultra-compact Protocol Buffer URL State Serialization and Deserialization for ONI Math.
 * Encodes system state into compact Protocol Buffers using enums, oneofs, and structured types,
 * stored as URL-safe Base64 in URL query parameters (?s=...).
 *
 * State shape:
 * {
 *   rateMode: "s" | "c",
 *   rows: Array<{
 *     entityId: string,
 *     qty: number,
 *     recipeId?: string | null,
 *     modifiers?: string[],
 *     bathroom?: string | null,
 *     inputTemp?: number | null
 *   }>,
 *   netInputTemps?: { [key: string]: number }
 * }
 */

import protobuf from "./lib/protobuf.js";
import {
  getDefaultElementTemp,
  getResourceDefaultUnit,
  getResourceDefaultState,
  isNonThermalResource,
} from "./calculator.js";
import {
  CalculatorStateType,
  ENTITY_TO_ENUM,
  ENUM_TO_ENTITY,
  RECIPE_TO_ENUM,
  ENUM_TO_RECIPE,
  MODIFIER_TO_ENUM,
  ENUM_TO_MODIFIER,
  ELEMENT_TO_ENUM,
  ENUM_TO_ELEMENT,
  BATHROOM_TO_ENUM,
  ENUM_TO_BATHROOM,
  FOOD_TO_ENUM,
  ENUM_TO_FOOD,
  STREAM_STATE_TO_ENUM,
  ENUM_TO_STREAM_STATE,
  ENTITY_ALIASES,
} from "./proto_catalog.js";

/**
 * Maximum URL parameter string length allowed before rejecting as DoS.
 */
const MAX_PARAM_STRING_LENGTH = 65536;

/**
 * Convert a Uint8Array to a URL-safe Base64 string (no '+', '/', or padding '=').
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ArrayToUrlSafeBase64(bytes) {
  if (!bytes || bytes.length === 0) return "";
  const b64 = protobuf.util.base64.encode(bytes, 0, bytes.length);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Convert a Base64 or URL-safe Base64 string to a Uint8Array.
 * Tolerates missing padding, spaces, URL-safe characters, and URI encoding.
 *
 * @param {string} str
 * @returns {Uint8Array|null}
 */
export function urlSafeBase64ToUint8Array(str) {
  if (!str || typeof str !== "string") return null;
  let clean = str.trim();
  if (clean.includes("%")) {
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // Keep unescaped if URI decoding fails
    }
  }

  // Restore URL-safe characters and handle unencoded '+' turned to ' '
  let b64 = clean.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");

  // Re-pad to multiple of 4
  const pad = b64.length % 4;
  if (pad === 2) b64 += "==";
  else if (pad === 3) b64 += "=";
  else if (pad === 1) return null; // Invalid base64 length

  try {
    const len = protobuf.util.base64.length(b64);
    const target = new Uint8Array(len);
    protobuf.util.base64.decode(b64, target, 0);
    return target;
  } catch {
    return null;
  }
}

/**
 * Encode state into a compact Protocol Buffer binary representation (Uint8Array).
 * Uses enums for all identifiers and oneofs for quantity and configuration.
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 * @returns {Uint8Array}
 */
export function encodeStateToProtobuf(state, elementMap = null) {
  if (!state) return new Uint8Array(0);

  const pbRows = [];
  for (const row of state.rows || []) {
    if (!row || !row.entityId) continue;
    let entityId = String(row.entityId).trim();
    if (ENTITY_ALIASES[entityId]) {
      entityId = ENTITY_ALIASES[entityId];
    }
    const entityEnum = ENTITY_TO_ENUM.get(entityId);
    if (!entityEnum) continue;

    const rawQty = Number(row.qty);
    const safeQty = (!Number.isFinite(rawQty) || rawQty < 0) ? 1 : rawQty;

    const pbRow = {
      entity: entityEnum,
    };

    // oneof count: count_int (if integer >= 0) or count_scaled or count_double
    if (Number.isInteger(safeQty) && safeQty <= 4294967295) {
      pbRow.countInt = safeQty;
    } else if (
      (entityId === "absorb_heat" || entityId === "counterflow_heat_exchanger" || safeQty >= 10) &&
      Math.abs(Math.round(safeQty * 10000) - safeQty * 10000) < 1e-6 &&
      Math.round(safeQty * 10000) <= 4294967295
    ) {
      pbRow.countScaled = Math.round(safeQty * 10000);
    } else {
      pbRow.countDouble = safeQty;
    }

    // Recipe enum
    if (row.recipeId) {
      const rId = String(row.recipeId).trim();
      const isDefaultGlassRecipe = (entityId === "glass_forge" && rId === "molten_glass");
      if (!isDefaultGlassRecipe) {
        const rEnum = RECIPE_TO_ENUM.get(rId);
        if (rEnum) {
          pbRow.recipe = rEnum;
        }
      }
    }

    // Bathroom enum (plumbed is default 0)
    if (row.bathroom && row.bathroom !== "plumbed") {
      const bEnum = BATHROOM_TO_ENUM.get(String(row.bathroom).trim());
      if (bEnum !== undefined && bEnum !== 0) {
        pbRow.bathroom = bEnum;
      }
    }

    // Food enum (calories is default 0)
    if (row.food && row.food !== "calories") {
      const fEnum = FOOD_TO_ENUM.get(String(row.food).trim());
      if (fEnum !== undefined && fEnum !== 0) {
        pbRow.food = fEnum;
      }
    }

    // repeated Modifier
    if (Array.isArray(row.modifiers) && row.modifiers.length > 0) {
      const modEnums = [];
      for (const m of row.modifiers) {
        if (!m) continue;
        const mEnum = MODIFIER_TO_ENUM.get(String(m).trim());
        if (mEnum) modEnums.push(mEnum);
      }
      if (modEnums.length > 0) {
        pbRow.modifiers = modEnums;
      }
    }

    // optional double input_temp
    if (row.inputTemp !== undefined && row.inputTemp !== null && Number.isFinite(Number(row.inputTemp))) {
      pbRow.inputTemp = Number(row.inputTemp);
    }

    // Material and cold material
    if (row.material) {
      const mEnum = ELEMENT_TO_ENUM.get(String(row.material).trim());
      if (mEnum) {
        pbRow.material = mEnum;
      }
    }
    if (row.materialState) {
      const sEnum = STREAM_STATE_TO_ENUM.get(String(row.materialState).trim());
      if (sEnum !== undefined && sEnum !== 0) {
        pbRow.materialState = sEnum;
      }
    }
    if (row.coldMaterial) {
      const cmEnum = ELEMENT_TO_ENUM.get(String(row.coldMaterial).trim());
      if (cmEnum) {
        pbRow.coldMaterial = cmEnum;
      }
    }
    if (row.coldMaterialState) {
      const csEnum = STREAM_STATE_TO_ENUM.get(String(row.coldMaterialState).trim());
      const isDefaultColdState = (entityId === "counterflow_heat_exchanger" && row.coldMaterialState === "in a pipe");
      if (csEnum !== undefined && csEnum !== 0 && !isDefaultColdState) {
        pbRow.coldMaterialState = csEnum;
      }
    }
    if (row.tempDelta !== undefined && row.tempDelta !== null && Number.isFinite(Number(row.tempDelta))) {
      const td = Number(row.tempDelta);
      if (Math.abs(td - 10) > 1e-4) {
        pbRow.tempDelta = td;
      }
    }
    if (row.heatExchange !== undefined && row.heatExchange !== null && Number.isFinite(Number(row.heatExchange))) {
      const hx = Number(row.heatExchange);
      if (Math.abs(hx - 100) > 1e-4) {
        pbRow.heatExchange = hx;
      }
    }

    pbRows.push(pbRow);
  }

  // repeated NetTemperature
  const pbNetTemps = [];
  if (state.netInputTemps && typeof state.netInputTemps === "object") {
    const seenCombos = new Set();
    for (const [rawKey, val] of Object.entries(state.netInputTemps)) {
      if (val === null || val === undefined || !Number.isFinite(Number(val))) continue;
      const numVal = Number(val);

      let res = rawKey;
      let stateName = "free";
      if (rawKey.includes("||")) {
        const parts = rawKey.split("||");
        res = parts[0];
        stateName = parts[1] || "free";
      } else if (rawKey.includes("|")) {
        const parts = rawKey.split("|");
        res = parts[0];
        stateName = parts[1] || "free";
      }

      const elemEnum = ELEMENT_TO_ENUM.get(res);
      if (!elemEnum) continue;

      const comboKey = `${elemEnum}:${stateName}`;
      if (seenCombos.has(comboKey)) continue;

      const defTemp = getDefaultElementTemp(res, elementMap);
      if (Math.abs(numVal - defTemp) > 1e-4) {
        seenCombos.add(comboKey);
        pbNetTemps.push({
          element: elemEnum,
          state: STREAM_STATE_TO_ENUM.get(stateName) ?? 0,
          temperature: numVal,
        });
      }
    }
  }

  // repeated LoopedStream
  const pbLoops = [];
  if (Array.isArray(state.loops)) {
    const seenLoopCombos = new Set();
    for (const loop of state.loops) {
      if (!loop || !loop.resource) continue;
      const rateVal = Number(loop.rate);
      if (!Number.isFinite(rateVal) || rateVal <= 0) continue;

      const elemEnum = ELEMENT_TO_ENUM.get(loop.resource);
      if (!elemEnum) continue;

      const stateName = loop.state || getResourceDefaultState(loop.resource);
      const stateEnum = STREAM_STATE_TO_ENUM.get(stateName) ?? 0;

      const comboKey = `${elemEnum}:${stateEnum}`;
      if (seenLoopCombos.has(comboKey)) continue;
      seenLoopCombos.add(comboKey);

      const pbLoop = {
        element: elemEnum,
        state: stateEnum,
      };

      if (Number.isInteger(rateVal) && rateVal >= 0 && rateVal < 4294967296) {
        pbLoop.rateInt = rateVal;
      } else {
        pbLoop.rateDouble = rateVal;
      }

      const unit = loop.unit || getResourceDefaultUnit(loop.resource);
      const defTemp = getDefaultElementTemp(loop.resource, elementMap);
      if (
        !isNonThermalResource(loop.resource, unit) &&
        loop.tempC !== undefined &&
        loop.tempC !== null &&
        Number.isFinite(Number(loop.tempC)) &&
        Math.abs(Number(loop.tempC) - defTemp) > 1e-4
      ) {
        const numTemp = Number(loop.tempC);
        if (Number.isInteger(numTemp) && numTemp >= -2147483648 && numTemp <= 2147483647) {
          pbLoop.tempInt = numTemp;
        } else {
          pbLoop.tempDouble = numTemp;
        }
      }

      pbLoops.push(pbLoop);
    }
  }

  const isCycle = (state.rateMode || state.unit) === "c";
  const payload = {
    rateMode: isCycle ? 1 : 0,
    rows: pbRows,
    netTemperatures: pbNetTemps,
    loops: pbLoops,
  };

  const message = CalculatorStateType.create(payload);
  return CalculatorStateType.encode(message).finish();
}

/**
 * Decode a compact Protocol Buffer binary representation (Uint8Array) into a state object.
 *
 * @param {Uint8Array} bytes
 * @returns {Object}
 */
export function decodeStateFromProtobuf(bytes) {
  const defaultState = {
    rateMode: "s",
    unit: "s",
    rows: [],
    netInputTemps: {},
    loops: [],
  };

  if (!bytes || bytes.length === 0) {
    return defaultState;
  }

  let decoded;
  try {
    decoded = CalculatorStateType.decode(bytes);
  } catch {
    return defaultState;
  }

  const isCycle = decoded.rateMode === 1;
  const rateMode = isCycle ? "c" : "s";

  const rows = [];
  for (const r of decoded.rows || []) {
    const entityId = ENUM_TO_ENTITY[r.entity];
    if (!entityId) continue;

    let qty = 1;
    if (r.count === "countInt" && typeof r.countInt === "number") {
      qty = r.countInt;
    } else if (r.count === "countScaled" && typeof r.countScaled === "number") {
      qty = r.countScaled / 10000;
    } else if (r.count === "countDouble" && typeof r.countDouble === "number" && Number.isFinite(r.countDouble)) {
      qty = r.countDouble;
    } else if (typeof r.countScaled === "number" && r.countScaled > 0) {
      qty = r.countScaled / 10000;
    } else if (typeof r.countInt === "number" && r.countInt > 0) {
      qty = r.countInt;
    } else if (typeof r.countDouble === "number" && Number.isFinite(r.countDouble)) {
      qty = r.countDouble;
    }

    let recipeId = null;
    let bathroom = null;
    let food = null;
    if (r.recipe && ENUM_TO_RECIPE[r.recipe]) {
      recipeId = ENUM_TO_RECIPE[r.recipe];
    } else if (entityId === "glass_forge") {
      recipeId = "molten_glass";
    }
    if (r.bathroom && ENUM_TO_BATHROOM[r.bathroom]) {
      bathroom = ENUM_TO_BATHROOM[r.bathroom];
    }
    if (r.food !== undefined && r.food !== null && ENUM_TO_FOOD[r.food]) {
      food = ENUM_TO_FOOD[r.food];
    }

    const modifiers = [];
    if (Array.isArray(r.modifiers)) {
      for (const m of r.modifiers) {
        const modId = ENUM_TO_MODIFIER[m];
        if (modId) modifiers.push(modId);
      }
    }

    const rowObj = {
      entityId,
      qty,
      recipeId,
      modifiers,
    };

    if (entityId === "duplicant") {
      rowObj.bathroom = bathroom || "plumbed";
      if (food) {
        rowObj.food = food;
      }
    } else {
      if (bathroom) rowObj.bathroom = bathroom;
      if (food) rowObj.food = food;
    }

    if (r.inputTemp !== undefined && r.inputTemp !== null && Number.isFinite(Number(r.inputTemp))) {
      rowObj.inputTemp = Number(r.inputTemp);
    }

    if (r.material && ENUM_TO_ELEMENT[r.material]) {
      rowObj.material = ENUM_TO_ELEMENT[r.material];
      rowObj.materialState =
        ENUM_TO_STREAM_STATE[r.materialState] || getResourceDefaultState(rowObj.material);
    }
    if (r.coldMaterial && ENUM_TO_ELEMENT[r.coldMaterial]) {
      rowObj.coldMaterial = ENUM_TO_ELEMENT[r.coldMaterial];
      rowObj.coldMaterialState =
        (r.coldMaterialState && ENUM_TO_STREAM_STATE[r.coldMaterialState]) ||
        (entityId === "counterflow_heat_exchanger" ? "in a pipe" : getResourceDefaultState(rowObj.coldMaterial));
    }
    if (r.tempDelta !== undefined && r.tempDelta !== null && Number.isFinite(Number(r.tempDelta))) {
      rowObj.tempDelta = Number(r.tempDelta);
    } else if (entityId === "absorb_heat") {
      rowObj.tempDelta = 10;
    }
    if (r.heatExchange !== undefined && r.heatExchange !== null && Number.isFinite(Number(r.heatExchange))) {
      rowObj.heatExchange = Number(r.heatExchange);
    } else if (entityId === "counterflow_heat_exchanger") {
      rowObj.heatExchange = 100;
    }

    if (entityId === "absorb_heat") {
      if (!rowObj.material) rowObj.material = "Water";
      if (!rowObj.materialState) rowObj.materialState = "free";
    }
    if (entityId === "counterflow_heat_exchanger") {
      rowObj.material = rowObj.material || "Water";
      rowObj.materialState = rowObj.materialState || "free";
      rowObj.coldMaterial = rowObj.coldMaterial || "Polluted Water";
      rowObj.coldMaterialState = rowObj.coldMaterialState || "in a pipe";
    }

    rows.push(rowObj);
  }

  const netInputTemps = {};
  if (Array.isArray(decoded.netTemperatures)) {
    for (const entry of decoded.netTemperatures) {
      const elementName = ENUM_TO_ELEMENT[entry.element];
      if (!elementName) continue;
      const pipeState = ENUM_TO_STREAM_STATE[entry.state] || "free";
      const tempVal = Number(entry.temperature);
      if (Number.isFinite(tempVal)) {
        netInputTemps[`${elementName}||${pipeState}`] = tempVal;
        netInputTemps[`${elementName}|${pipeState}`] = tempVal;
      }
    }
  }

  const loops = [];
  if (Array.isArray(decoded.loops)) {
    for (const entry of decoded.loops) {
      const elementName = ENUM_TO_ELEMENT[entry.element];
      if (!elementName) continue;
      let rateVal = 0;
      if (entry.flow_rate === "rateInt" || entry.flowRate === "rateInt") {
        rateVal = Number(entry.rateInt);
      } else if (entry.flow_rate === "rateDouble" || entry.flowRate === "rateDouble") {
        rateVal = Number(entry.rateDouble);
      } else if (entry.rate !== undefined && entry.rate !== null) {
        rateVal = Number(entry.rate);
      } else if (typeof entry.rateInt === "number" && entry.rateInt > 0) {
        rateVal = entry.rateInt;
      } else if (typeof entry.rateDouble === "number" && Number.isFinite(entry.rateDouble)) {
        rateVal = entry.rateDouble;
      }
      if (!Number.isFinite(rateVal) || rateVal <= 0) continue;
      const pipeState = ENUM_TO_STREAM_STATE[entry.state] || getResourceDefaultState(elementName);
      const unit = getResourceDefaultUnit(elementName);
      const loopObj = {
        resource: elementName,
        state: pipeState,
        rate: rateVal,
        unit,
      };

      let tempVal = undefined;
      if (entry.temp === "tempInt" && typeof entry.tempInt === "number") {
        tempVal = entry.tempInt;
      } else if (entry.temp === "tempDouble" && typeof entry.tempDouble === "number" && Number.isFinite(entry.tempDouble)) {
        tempVal = entry.tempDouble;
      } else if (entry.temperature !== undefined && entry.temperature !== null && Number.isFinite(Number(entry.temperature))) {
        tempVal = Number(entry.temperature);
      }

      if (!isNonThermalResource(elementName, unit)) {
        if (tempVal !== undefined && Number.isFinite(tempVal)) {
          loopObj.tempC = tempVal;
        } else {
          loopObj.tempC = getDefaultElementTemp(elementName, null);
        }
      }
      loops.push(loopObj);
    }
  }

  Object.defineProperty(rows, "_loops", { value: loops, enumerable: false, writable: true });

  return {
    rateMode,
    unit: rateMode,
    rows,
    netInputTemps,
    loops,
  };
}

/**
 * Encode state into a URL parameter string using compact Protocol Buffers and Base64.
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 * @returns {string}
 */
export function encodeStateToParam(state, elementMap = null) {
  if (!state) return "";

  const hasRows = Array.isArray(state.rows) && state.rows.some((r) => r && r.entityId);
  const hasCustomTemps = state.netInputTemps && Object.keys(state.netInputTemps).length > 0;
  const hasLoops = Array.isArray(state.loops) && state.loops.some((l) => l && l.resource && Number(l.rate) > 0);
  const isCycle = (state.rateMode || state.unit) === "c";
  if (!hasRows && !hasCustomTemps && !hasLoops && !isCycle) {
    return "";
  }

  const bytes = encodeStateToProtobuf(state, elementMap);
  return uint8ArrayToUrlSafeBase64(bytes);
}

/**
 * Decode state from a parameter string (e.g. from ?s=... or full URL).
 * Only supports the new compact Protocol Buffer Base64 scheme.
 *
 * @param {string} paramStr
 * @returns {Object}
 */
export function decodeStateFromParam(paramStr) {
  const defaultState = {
    rateMode: "s",
    unit: "s",
    rows: [],
    netInputTemps: {},
    loops: [],
  };

  if (!paramStr || typeof paramStr !== "string") {
    return defaultState;
  }

  let cleanStr = paramStr.trim();
  if (cleanStr.length > MAX_PARAM_STRING_LENGTH) {
    return defaultState;
  }

  if (cleanStr.includes("%")) {
    try {
      cleanStr = decodeURIComponent(cleanStr);
    } catch {
      // Keep original if URI decoding fails
    }
  }

  // Handle full URL extraction: e.g. "https://example.com/?s=..." or "s=..."
  if (cleanStr.includes("?s=")) {
    cleanStr = cleanStr.slice(cleanStr.indexOf("?s=") + 3);
  } else if (cleanStr.includes("&s=")) {
    cleanStr = cleanStr.slice(cleanStr.indexOf("&s=") + 3);
  } else if (cleanStr.startsWith("?")) {
    cleanStr = cleanStr.slice(1);
  }
  if (cleanStr.startsWith("s=")) {
    cleanStr = cleanStr.slice(2);
  }

  // Strip subsequent URL query params or fragment if a full query was passed
  if (cleanStr.includes("&")) {
    cleanStr = cleanStr.split("&")[0];
  }
  if (cleanStr.includes("#")) {
    cleanStr = cleanStr.split("#")[0];
  }

  cleanStr = cleanStr.trim();
  if (!cleanStr) return defaultState;

  // Optional "pb:" prefix
  if (cleanStr.startsWith("pb:")) {
    cleanStr = cleanStr.slice(3);
  }

  const bytes = urlSafeBase64ToUint8Array(cleanStr);
  if (!bytes || bytes.length === 0) {
    return defaultState;
  }

  return decodeStateFromProtobuf(bytes);
}

/**
 * Synchronize state to the browser address bar with window.history.replaceState.
 * Preserves other existing query parameters and hash, and handles Safari rate limiting safely.
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 */
export function syncStateToUrl(state, elementMap = null) {
  if (typeof window === "undefined" || !window.history || !window.location) return;
  try {
    const param = encodeStateToParam(state, elementMap);
    const searchParams = new URLSearchParams(window.location.search);
    if (param) {
      searchParams.set("s", param);
    } else {
      searchParams.delete("s");
    }
    const query = searchParams.toString();
    const hash = window.location.hash || "";
    const newUrl = query
      ? `${window.location.pathname}?${query}${hash}`
      : `${window.location.pathname}${hash}`;
    window.history.replaceState(null, "", newUrl);
  } catch {
    // Gracefully ignore rate-limiting (e.g. WebKit SecurityError) or sandboxed iframes
  }
}

/**
 * Read and decode state from window.location.search.
 *
 * @returns {Object|null}
 */
export function loadStateFromUrl() {
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("s")) return null;
  const s = params.get("s");
  return decodeStateFromParam(s);
}
