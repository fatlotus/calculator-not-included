/**
 * Protocol Buffer URL State Serialization and Deserialization for ONI Math.
 * Allows effortless sharing of production systems and builds via query params (?s=...).
 *
 * State shape:
 * {
 *   rateMode: "s" | "c",
 *   strictPipeMatching: boolean,
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
import { formatNumber, getDefaultElementTemp } from "./calculator.js";

/**
 * Protocol Buffer schema definition for state serialization.
 */
export const PROTO_SCHEMA = `
syntax = "proto3";
package onimath;

enum RateMode {
  RATE_MODE_PER_SECOND = 0;
  RATE_MODE_PER_CYCLE = 1;
}

message RowState {
  string entity_id = 1;
  double qty = 2;
  string recipe_id = 3;
  repeated string modifiers = 4;
  string bathroom = 5;
  optional double input_temp = 6;
}

message CalculatorState {
  RateMode rate_mode = 1;
  optional bool strict_pipe_matching = 2;
  repeated RowState rows = 3;
  map<string, double> net_input_temps = 4;
}
`;

// Parse and cache the protobuf message type
const protoRoot = protobuf.parse(PROTO_SCHEMA).root;
const CalculatorStateType = protoRoot.lookupType("onimath.CalculatorState");

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
 * Encode state into a Protocol Buffer binary representation (Uint8Array).
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 * @returns {Uint8Array}
 */
export function encodeStateToProtobuf(state, elementMap = null) {
  if (!state) return new Uint8Array(0);

  const validRows = [];
  for (const row of state.rows || []) {
    if (!row || !row.entityId) continue;
    const qty = Number(row.qty);
    // Sanitize qty: must be finite and non-negative
    const safeQty = (!Number.isFinite(qty) || qty < 0) ? 1 : qty;
    const pbRow = {
      entityId: String(row.entityId).trim(),
      qty: safeQty,
    };
    if (row.recipeId) {
      pbRow.recipeId = String(row.recipeId).trim();
    }
    if (Array.isArray(row.modifiers) && row.modifiers.length > 0) {
      pbRow.modifiers = row.modifiers.filter(Boolean).map(String);
    }
    if (row.bathroom && row.bathroom !== "plumbed") {
      pbRow.bathroom = String(row.bathroom).trim();
    }
    if (row.inputTemp !== undefined && row.inputTemp !== null && Number.isFinite(Number(row.inputTemp))) {
      pbRow.inputTemp = Number(row.inputTemp);
    }
    validRows.push(pbRow);
  }

  const pbNetInputTemps = {};
  if (state.netInputTemps && typeof state.netInputTemps === "object") {
    const seenKeys = new Set();
    for (const [rawKey, val] of Object.entries(state.netInputTemps)) {
      if (val === null || val === undefined || !Number.isFinite(Number(val))) continue;
      // Guard against prototype pollution keys
      if (rawKey === "__proto__" || rawKey === "prototype" || rawKey === "constructor") continue;
      const numVal = Number(val);

      let res = rawKey;
      if (rawKey.includes("||")) {
        res = rawKey.split("||")[0];
      } else if (rawKey.includes("|")) {
        res = rawKey.split("|")[0];
      }

      const defTemp = getDefaultElementTemp(res, elementMap);
      if (Math.abs(numVal - defTemp) > 1e-4) {
        const urlKey = rawKey.replace("||", "|");
        if (!seenKeys.has(urlKey)) {
          seenKeys.add(urlKey);
          pbNetInputTemps[urlKey] = numVal;
        }
      }
    }
  }

  const isCycle = (state.rateMode || state.unit) === "c";
  const payload = {
    rateMode: isCycle ? 1 : 0,
    rows: validRows,
    netInputTemps: pbNetInputTemps,
  };

  // Only store strictPipeMatching if explicitly disabled to keep payload minimal
  if (state.strictPipeMatching === false) {
    payload.strictPipeMatching = false;
  }

  const message = CalculatorStateType.create(payload);
  return CalculatorStateType.encode(message).finish();
}

/**
 * Decode a Protocol Buffer binary representation (Uint8Array) into a state object.
 *
 * @param {Uint8Array} bytes
 * @returns {Object}
 */
export function decodeStateFromProtobuf(bytes) {
  const defaultState = {
    rateMode: "s",
    unit: "s",
    strictPipeMatching: true,
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

  const isCycle = decoded.rateMode === 1 || decoded.rateMode === "RATE_MODE_PER_CYCLE";
  const rateMode = isCycle ? "c" : "s";
  const strictPipeMatching = decoded.strictPipeMatching !== false;

  const rows = [];
  for (const r of decoded.rows || []) {
    const entityId = r.entityId ? String(r.entityId).trim() : "";
    if (!entityId) continue;

    const rowObj = {
      entityId,
      qty: (typeof r.qty === "number" && Number.isFinite(r.qty) && r.qty >= 0) ? r.qty : 1,
      recipeId: r.recipeId ? String(r.recipeId).trim() : null,
      modifiers: Array.isArray(r.modifiers) ? r.modifiers.filter((m) => typeof m === "string" && m.length > 0) : [],
    };

    if (entityId === "duplicant") {
      rowObj.bathroom = r.bathroom ? String(r.bathroom).trim() : "plumbed";
    } else if (r.bathroom) {
      rowObj.bathroom = String(r.bathroom).trim();
    }

    if (r.inputTemp !== undefined && r.inputTemp !== null && Number.isFinite(Number(r.inputTemp))) {
      rowObj.inputTemp = Number(r.inputTemp);
    }

    rows.push(rowObj);
  }

  const netInputTemps = {};
  if (decoded.netInputTemps && typeof decoded.netInputTemps === "object") {
    for (const [k, v] of Object.entries(decoded.netInputTemps)) {
      if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
      const num = Number(v);
      if (Number.isFinite(num)) {
        netInputTemps[k] = num;
        if (k.includes("|") && !k.includes("||")) {
          netInputTemps[k.replace("|", "||")] = num;
        } else if (k.includes("||")) {
          netInputTemps[k.replace("||", "|")] = num;
        }
      }
    }
  }

  return {
    rateMode,
    unit: rateMode,
    strictPipeMatching,
    rows,
    netInputTemps,
  };
}

/**
 * Encode state into a URL parameter string using Protocol Buffers and Base64.
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 * @returns {string}
 */
export function encodeStateToParam(state, elementMap = null) {
  if (!state) return "";

  // If state is completely default and empty, return empty string
  const hasRows = Array.isArray(state.rows) && state.rows.some((r) => r && r.entityId);
  const hasCustomTemps = state.netInputTemps && Object.keys(state.netInputTemps).length > 0;
  const isCycle = (state.rateMode || state.unit) === "c";
  if (!hasRows && !hasCustomTemps && !isCycle && state.strictPipeMatching !== false) {
    return "";
  }

  const bytes = encodeStateToProtobuf(state, elementMap);
  return uint8ArrayToUrlSafeBase64(bytes);
}

/**
 * Decode state from a parameter string (e.g. from ?s=..., full URL, or legacy query).
 * Supports Protocol Buffer base64, URL-safe base64, legacy human-readable format,
 * legacy base64 JSON, and raw JSON.
 *
 * @param {string} paramStr
 * @returns {Object}
 */
export function decodeStateFromParam(paramStr) {
  const defaultState = {
    rateMode: "s",
    unit: "s",
    strictPipeMatching: true,
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

  // 1. Legacy Base64 fallback (b64:...)
  if (cleanStr.startsWith("b64:")) {
    const rawB64 = cleanStr.slice(4);
    // Try protobuf decoding first in case a protobuf token was prefixed with b64:
    const bytes = urlSafeBase64ToUint8Array(rawB64);
    if (bytes && bytes.length > 0) {
      const pbState = decodeStateFromProtobuf(bytes);
      if (
        pbState.rows.length > 0 ||
        pbState.rateMode === "c" ||
        pbState.strictPipeMatching === false ||
        Object.keys(pbState.netInputTemps).length > 0
      ) {
        return pbState;
      }
    }

    try {
      const b64 = rawB64.replace(/-/g, "+").replace(/_/g, "/");
      const jsonStr = typeof atob === "function"
        ? decodeURIComponent(escape(atob(b64)))
        : Buffer.from(b64, "base64").toString("utf8");
      const parsed = JSON.parse(jsonStr);
      return normalizeJsonState(parsed);
    } catch {
      return defaultState;
    }
  }

  // 2. Legacy human-readable format: "u:s_r:electrolyzer~..." or "r:..."
  if (
    cleanStr.startsWith("u:") ||
    cleanStr.startsWith("r:") ||
    cleanStr.includes("_r:") ||
    cleanStr.includes("_t:")
  ) {
    return decodeLegacyString(cleanStr);
  }

  // 3. Optional "pb:" prefix
  if (cleanStr.startsWith("pb:")) {
    cleanStr = cleanStr.slice(3);
  }

  // 4. Raw JSON string
  if (cleanStr.startsWith("{") && cleanStr.endsWith("}")) {
    try {
      const parsed = JSON.parse(cleanStr);
      return normalizeJsonState(parsed);
    } catch {
      return defaultState;
    }
  }

  // 5. Protobuf Base64 decoding
  const bytes = urlSafeBase64ToUint8Array(cleanStr);
  if (bytes && bytes.length > 0) {
    const pbState = decodeStateFromProtobuf(bytes);
    if (
      pbState.rows.length > 0 ||
      pbState.rateMode === "c" ||
      pbState.strictPipeMatching === false ||
      Object.keys(pbState.netInputTemps).length > 0
    ) {
      return pbState;
    }
  }

  // 6. Final fallback: try legacy string parser
  const legacyResult = decodeLegacyString(cleanStr);
  if (legacyResult.rows.length > 0) {
    return legacyResult;
  }

  return defaultState;
}

/**
 * Normalize a parsed JSON state object.
 */
function normalizeJsonState(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { rateMode: "s", unit: "s", strictPipeMatching: true, rows: [], netInputTemps: {} };
  }
  const rateMode = (parsed.rateMode || parsed.unit) === "c" ? "c" : "s";
  return {
    rateMode,
    unit: rateMode,
    strictPipeMatching: true,
    rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    netInputTemps: parsed.netInputTemps && typeof parsed.netInputTemps === "object" ? parsed.netInputTemps : {},
  };
}

/**
 * Decode legacy parameter string format (e.g. u:s_r:electrolyzer~water_pump:water*0.1_t:Water|free=95).
 */
export function decodeLegacyString(cleanStr) {
  let rateMode = "s";
  let strictPipeMatching = true;
  let rows = [];
  let netInputTemps = {};

  const sections = cleanStr.split(/_(?=[uprt]:)/);
  for (const sec of sections) {
    if (sec.startsWith("u:")) {
      rateMode = sec.slice(2) === "c" ? "c" : "s";
    } else if (sec.startsWith("r:")) {
      const rowTokens = sec.slice(2).split("~").filter(Boolean);
      rows = rowTokens.map(decodeRow).filter(Boolean);
    } else if (sec.startsWith("t:")) {
      const tokens = sec.slice(2).split(/[~,]/).filter(Boolean);
      for (const tok of tokens) {
        const eqIdx = tok.indexOf("=");
        if (eqIdx !== -1) {
          const k = tok.slice(0, eqIdx);
          if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
          const v = parseFloat(tok.slice(eqIdx + 1));
          if (Number.isFinite(v)) {
            netInputTemps[k] = v;
            if (k.includes("|") && !k.includes("||")) {
              netInputTemps[k.replace("|", "||")] = v;
            } else if (k.includes("||")) {
              netInputTemps[k.replace("||", "|")] = v;
            }
          }
        }
      }
    }
  }

  return {
    rateMode,
    unit: rateMode,
    strictPipeMatching,
    rows,
    netInputTemps,
  };
}

/**
 * Encode a single table row into a compact string token (legacy format).
 * Format: entityId[:recipeId][*qty][+mod1,mod2][!bathroom]
 */
export function encodeRow(row) {
  if (!row || !row.entityId) return "";
  let token = row.entityId;

  if (row.recipeId) {
    token += `:${row.recipeId}`;
  }

  const qty = Number(row.qty);
  if (!isNaN(qty) && qty !== 1) {
    token += `*${qty}`;
  }

  if (Array.isArray(row.modifiers) && row.modifiers.length > 0) {
    token += `+${row.modifiers.join(",")}`;
  }

  if (row.bathroom && row.bathroom !== "plumbed") {
    token += `!${row.bathroom}`;
  }

  return token;
}

/**
 * Decode a compact string token into a table row object (legacy format).
 */
export function decodeRow(token) {
  if (!token) return null;

  let str = token.trim();
  let modifiers = [];
  let recipeId = null;
  let qty = 1;
  let inputTemp = null;
  let bathroom = null;

  const exclIdx = str.indexOf("!");
  if (exclIdx !== -1) {
    bathroom = str.slice(exclIdx + 1);
    str = str.slice(0, exclIdx);
  }

  const plusIdx = str.indexOf("+");
  if (plusIdx !== -1) {
    const modStr = str.slice(plusIdx + 1);
    modifiers = modStr ? modStr.split(",").filter(Boolean) : [];
    str = str.slice(0, plusIdx);
  }

  const atMatch = str.match(/@(-?[0-9]+(?:\.[0-9]+)?)/);
  if (atMatch) {
    inputTemp = parseFloat(atMatch[1]);
    str = str.replace(atMatch[0], "");
  }

  const qtyMatch = str.match(/\*([0-9]+(?:\.[0-9]+)?)/);
  if (qtyMatch) {
    qty = parseFloat(qtyMatch[1]) || 1;
    str = str.replace(qtyMatch[0], "");
  }

  const colonMatch = str.match(/:([a-zA-Z0-9_\-]+)/);
  if (colonMatch) {
    recipeId = colonMatch[1];
    str = str.replace(colonMatch[0], "");
  }

  const entityId = str.trim();
  if (!entityId) return null;

  if (!bathroom) {
    if (modifiers.includes("lavatory")) {
      bathroom = "plumbed";
    } else if (modifiers.includes("outhouse")) {
      bathroom = "outhouse";
    }
  }
  modifiers = modifiers.filter((m) => m !== "lavatory" && m !== "outhouse" && m !== "exhale_co2");

  const result = {
    entityId,
    qty,
    recipeId: recipeId || null,
    modifiers,
  };
  if (entityId === "duplicant") {
    result.bathroom = bathroom || "plumbed";
  } else if (bathroom) {
    result.bathroom = bathroom;
  }
  if (inputTemp !== null) {
    result.inputTemp = inputTemp;
  }
  return result;
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
