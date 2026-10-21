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
 *     modifiers?: string[],
 *     inputTemp?: number | null
 *   }>
 * }
 */

/**
 * Encode a single table row into a compact string token.
 * Format: entityId[:recipeId][*qty][@inputTemp][+mod1,mod2]
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

  if (row.inputTemp !== undefined && row.inputTemp !== null && !isNaN(Number(row.inputTemp))) {
    token += `@${Number(row.inputTemp)}`;
  }

  if (Array.isArray(row.modifiers) && row.modifiers.length > 0) {
    token += `+${row.modifiers.join(",")}`;
  }

  return token;
}

/**
 * Decode a compact string token into a table row object.
 * Robustly parses tokens in any order:
 * e.g. "electrolyzer", "water_pump:water", "duplicant*8+divers_lungs", "gas_pump:hydrogen*0.224"
 */
export function decodeRow(token) {
  if (!token) return null;

  let str = token.trim();
  let modifiers = [];
  let recipeId = null;
  let qty = 1;
  let inputTemp = null;

  // Extract modifiers (+mod1,mod2)
  const plusIdx = str.indexOf("+");
  if (plusIdx !== -1) {
    const modStr = str.slice(plusIdx + 1);
    modifiers = modStr ? modStr.split(",").filter(Boolean) : [];
    str = str.slice(0, plusIdx);
  }

  // Extract @inputTemp
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

  return {
    entityId,
    qty,
    recipeId: recipeId || null,
    modifiers,
    inputTemp,
  };
}

/**
 * Encode state into a compact parameter string:
 * e.g. "u:s_r:electrolyzer~gas_pump:hydrogen*0.224~water_pump:water*0.1"
 *
 * @param {Object} state
 * @returns {string}
 */
export function encodeStateToParam(state) {
  if (!state) return "";
  const rateMode = (state.rateMode || state.unit) === "c" ? "c" : "s";
  const rows = (state.rows || []).map(encodeRow).filter(Boolean);

  const parts = [`u:${rateMode}`];
  if (state.strictPipeMatching === false) {
    parts.push("p:0");
  } else if (state.strictPipeMatching === true && state._includePipeFlag) {
    parts.push("p:1");
  }

  if (rows.length > 0) {
    parts.push(`r:${rows.join("~")}`);
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
    return { rateMode: "s", strictPipeMatching: true, rows: [] };
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
        strictPipeMatching: parsed.strictPipeMatching !== false,
        rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      };
    } catch {
      return { rateMode: "s", strictPipeMatching: true, rows: [] };
    }
  }

  let rateMode = "s";
  let strictPipeMatching = true;
  let rows = [];

  const sections = cleanStr.split(/_(?=[upr]:)/);
  for (const sec of sections) {
    if (sec.startsWith("u:")) {
      rateMode = sec.slice(2) === "c" ? "c" : "s";
    } else if (sec.startsWith("p:")) {
      strictPipeMatching = sec.slice(2) !== "0";
    } else if (sec.startsWith("r:")) {
      const rowTokens = sec.slice(2).split("~").filter(Boolean);
      rows = rowTokens.map(decodeRow).filter(Boolean);
    }
  }

  return {
    rateMode,
    unit: rateMode,
    strictPipeMatching,
    rows,
  };
}

/**
 * Synchronize state to the browser address bar with window.history.replaceState.
 *
 * @param {Object} state
 */
export function syncStateToUrl(state) {
  if (typeof window === "undefined" || !window.history || !window.location) return;
  const param = encodeStateToParam(state);
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

// Aliases for backwards compatibility
export const serializeState = encodeStateToParam;
export const deserializeState = decodeStateFromParam;
export const encodeStateToUrlParam = (state) => {
  const p = encodeStateToParam(state);
  return p ? `?s=${encodeURIComponent(p)}` : "";
};
export const decodeStateFromUrl = (searchStr) => {
  if (!searchStr) return null;
  const match = searchStr.match(/[?&]s=([^&]+)/);
  return match ? decodeStateFromParam(match[1]) : null;
};
