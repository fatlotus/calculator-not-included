/**
 * Compact URL State Serialization and Deserialization for ONI Math.
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
 *     modifiers?: string[]
 *   }>,
 *   netInputTemps?: { [key: string]: number }
 * }
 */

import { formatNumber, getDefaultElementTemp } from "./calculator.js";

/**
 * Encode a single table row into a compact string token.
 * Format: entityId[:recipeId][*qty][+mod1,mod2]
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
 * Decode a compact string token into a table row object.
 * Robustly parses tokens in any order:
 * e.g. "electrolyzer", "water_pump:water", "duplicant*8+divers_lungs", "gas_pump:hydrogen*0.224"
 * Maintains backward compatibility with legacy @inputTemp tokens.
 */
export function decodeRow(token) {
  if (!token) return null;

  let str = token.trim();
  let modifiers = [];
  let recipeId = null;
  let qty = 1;
  let inputTemp = null;
  let bathroom = null;

  // Extract bathroom (!plumbed, !outhouse, !floor)
  const exclIdx = str.indexOf("!");
  if (exclIdx !== -1) {
    bathroom = str.slice(exclIdx + 1);
    str = str.slice(0, exclIdx);
  }

  // Extract modifiers (+mod1,mod2)
  const plusIdx = str.indexOf("+");
  if (plusIdx !== -1) {
    const modStr = str.slice(plusIdx + 1);
    modifiers = modStr ? modStr.split(",").filter(Boolean) : [];
    str = str.slice(0, plusIdx);
  }

  // Extract legacy @inputTemp for backward compatibility
  const atMatch = str.match(/@(-?[0-9]+(?:\.[0-9]+)?)/);
  if (atMatch) {
    inputTemp = parseFloat(atMatch[1]);
    str = str.replace(atMatch[0], "");
  }

  // Extract *qty with regex so order with :recipeId does not matter
  const qtyMatch = str.match(/\*([0-9]+(?:\.[0-9]+)?)/);
  if (qtyMatch) {
    qty = parseFloat(qtyMatch[1]) || 1;
    str = str.replace(qtyMatch[0], "");
  }

  // Extract :recipeId
  const colonMatch = str.match(/:([a-zA-Z0-9_\-]+)/);
  if (colonMatch) {
    recipeId = colonMatch[1];
    str = str.replace(colonMatch[0], "");
  }

  const entityId = str.trim();
  if (!entityId) return null;

  // Handle legacy bathroom modifiers
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
 * Encode state into a compact parameter string:
 * e.g. "u:s_r:electrolyzer~gas_pump:hydrogen*0.224~water_pump:water*0.1_t:Water|free=95"
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 * @returns {string}
 */
export function encodeStateToParam(state, elementMap = null) {
  if (!state) return "";
  const rateMode = (state.rateMode || state.unit) === "c" ? "c" : "s";
  const rows = (state.rows || []).map(encodeRow).filter(Boolean);

  const parts = [`u:${rateMode}`];

  if (rows.length > 0) {
    parts.push(`r:${rows.join("~")}`);
  }

  if (state.netInputTemps && typeof state.netInputTemps === "object") {
    const tempTokens = [];
    const seenKeys = new Set();
    for (const [rawKey, val] of Object.entries(state.netInputTemps)) {
      if (val === null || val === undefined || isNaN(Number(val))) continue;
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
          tempTokens.push(`${urlKey}=${formatNumber(numVal)}`);
        }
      }
    }
    if (tempTokens.length > 0) {
      parts.push(`t:${tempTokens.join("~")}`);
    }
  }

  return parts.join("_");
}

/**
 * Decode state from a parameter string (e.g. from ?s=...).
 * Supports compact format, Base64 fallback (b64:...), and JSON string.
 * Defaults strictPipeMatching to true unless p:0 is explicitly present.
 *
 * @param {string} paramStr
 * @returns {Object}
 */
export function decodeStateFromParam(paramStr) {
  if (!paramStr || typeof paramStr !== "string") {
    return { rateMode: "s", strictPipeMatching: true, rows: [], netInputTemps: {} };
  }

  let cleanStr = decodeURIComponent(paramStr.trim());
  if (cleanStr.startsWith("?s=")) cleanStr = cleanStr.slice(3);
  if (cleanStr.startsWith("s=")) cleanStr = cleanStr.slice(2);

  // Base64 fallback (b64:...)
  if (cleanStr.startsWith("b64:")) {
    try {
      const b64 = cleanStr.slice(4).replace(/-/g, "+").replace(/_/g, "/");
      const jsonStr = typeof atob === "function"
        ? decodeURIComponent(escape(atob(b64)))
        : Buffer.from(b64, "base64").toString("utf8");
      const parsed = JSON.parse(jsonStr);
      return {
        rateMode: (parsed.rateMode || parsed.unit) === "c" ? "c" : "s",
        strictPipeMatching: true,
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
        netInputTemps: parsed.netInputTemps && typeof parsed.netInputTemps === "object" ? parsed.netInputTemps : {},
      };
    } catch {
      return { rateMode: "s", strictPipeMatching: true, rows: [], netInputTemps: {} };
    }
  }

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
          const v = parseFloat(tok.slice(eqIdx + 1));
          if (!isNaN(v)) {
            netInputTemps[k] = v;
            if (k.includes("|") && !k.includes("||")) {
              netInputTemps[k.replace("|", "||")] = v;
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
 * Synchronize state to the browser address bar with window.history.replaceState.
 *
 * @param {Object} state
 * @param {Map<string, Object>|Object|null} elementMap
 */
export function syncStateToUrl(state, elementMap = null) {
  if (typeof window === "undefined" || !window.history || !window.location) return;
  const param = encodeStateToParam(state, elementMap);
  const newUrl = param
    ? `${window.location.pathname}?s=${encodeURIComponent(param)}`
    : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

/**
 * Read and decode state from window.location.search.
 *
 * @returns {Object|null}
 */
export function loadStateFromUrl() {
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search);
  const s = params.get("s");
  if (!s) return null;
  return decodeStateFromParam(s);
}
