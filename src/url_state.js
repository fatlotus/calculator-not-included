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
import { getDefaultElementTemp } from "./calculator.js";
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

    // oneof count: count_int (if integer >= 0) or count_double
    if (Number.isInteger(safeQty) && safeQty <= 4294967295) {
      pbRow.countInt = safeQty;
    } else {
      pbRow.countDouble = safeQty;
    }

    // Recipe enum
    if (row.recipeId) {
      const rId = String(row.recipeId).trim();
      const rEnum = RECIPE_TO_ENUM.get(rId);
      if (rEnum) {
        pbRow.recipe = rEnum;
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
          state: stateName === "in a pipe" ? 1 : 0,
          temperature: numVal,
        });
      }
    }
  }

  const isCycle = (state.rateMode || state.unit) === "c";
  const payload = {
    rateMode: isCycle ? 1 : 0,
    rows: pbRows,
    netTemperatures: pbNetTemps,
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
    } else if (r.count === "countDouble" && typeof r.countDouble === "number" && Number.isFinite(r.countDouble)) {
      qty = r.countDouble;
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

    rows.push(rowObj);
  }

  const netInputTemps = {};
  if (Array.isArray(decoded.netTemperatures)) {
    for (const entry of decoded.netTemperatures) {
      const elementName = ENUM_TO_ELEMENT[entry.element];
      if (!elementName) continue;
      const pipeState = entry.state === 1 ? "in a pipe" : "free";
      const tempVal = Number(entry.temperature);
      if (Number.isFinite(tempVal)) {
        netInputTemps[`${elementName}||${pipeState}`] = tempVal;
        netInputTemps[`${elementName}|${pipeState}`] = tempVal;
      }
    }
  }

  return {
    rateMode,
    unit: rateMode,
    rows,
    netInputTemps,
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
  const isCycle = (state.rateMode || state.unit) === "c";
  if (!hasRows && !hasCustomTemps && !isCycle) {
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
