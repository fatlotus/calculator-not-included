"""
Compact URL State Serialization and Deserialization for ONI Math.
Mirrors src/url_state.js for exact cross-platform validation.
Allows effortless sharing of production systems and builds via query params (?s=...).
"""

import base64
import json
import re
import urllib.parse
from typing import Dict, Any, List, Optional
from src.calculator import get_default_element_temp, format_number


def encode_row(row: Dict[str, Any]) -> str:
    """
    Encode a single table row into a compact string token.
    Format: entityId[:recipeId][*qty][+mod1,mod2]
    """
    entity_id = row.get("entityId") or row.get("entity_id") or ""
    qty = row.get("qty", 1)
    recipe_id = row.get("recipeId") or row.get("recipe_id")
    modifiers = row.get("modifiers") or []

    token = entity_id
    if recipe_id:
        token += f":{recipe_id}"

    try:
        qty_num = float(qty)
        if qty_num != 1.0:
            if qty_num == int(qty_num):
                token += f"*{int(qty_num)}"
            else:
                token += f"*{qty_num}"
    except (ValueError, TypeError):
        pass

    if modifiers:
        token += f"+{','.join(modifiers)}"

    return token


def decode_row(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode a compact string token into a table row dict.
    Maintains backward compatibility with legacy @inputTemp tokens.
    """
    if not token:
        return None

    s = token.strip()
    modifiers: List[str] = []
    recipe_id: Optional[str] = None
    qty: float = 1.0
    input_temp: Optional[float] = None

    # Extract modifiers (+mod1,mod2)
    plus_idx = s.find("+")
    if plus_idx != -1:
        mod_str = s[plus_idx + 1 :]
        modifiers = [m for m in mod_str.split(",") if m]
        s = s[:plus_idx]

    # Extract legacy @inputTemp for backward compatibility
    at_match = re.search(r"@(-?[0-9]+(?:\.[0-9]+)?)", s)
    if at_match:
        try:
            input_temp = float(at_match.group(1))
        except ValueError:
            input_temp = None
        s = s[: at_match.start()] + s[at_match.end() :]

    # Extract *qty with regex so order does not break :recipeId
    qty_match = re.search(r"\*([0-9]+(?:\.[0-9]+)?)", s)
    if qty_match:
        try:
            val = float(qty_match.group(1))
            qty = int(val) if val == int(val) else val
        except ValueError:
            qty = 1.0
        s = s[: qty_match.start()] + s[qty_match.end() :]

    # Extract :recipeId
    colon_match = re.search(r":([a-zA-Z0-9_\-]+)", s)
    if colon_match:
        recipe_id = colon_match.group(1)
        s = s[: colon_match.start()] + s[colon_match.end() :]

    entity_id = s.strip()
    if not entity_id:
        return None

    res = {
        "entityId": entity_id,
        "qty": qty,
        "recipeId": recipe_id,
        "modifiers": modifiers,
    }
    if input_temp is not None:
        res["inputTemp"] = input_temp

    return res


def encode_state_to_param(state: Dict[str, Any], element_map: Optional[Dict[str, Any]] = None) -> str:
    """Serialize state object to compact string parameter."""
    if not state:
        return ""

    rate_mode = state.get("rateMode") or state.get("unit") or "s"
    rate_mode = "c" if rate_mode == "c" else "s"
    rows = [encode_row(r) for r in state.get("rows", []) if r]
    rows = [r for r in rows if r]

    parts = [f"u:{rate_mode}"]
    strict = state.get("strictPipeMatching")
    if strict is False:
        parts.append("p:0")
    elif strict is True and state.get("_includePipeFlag"):
        parts.append("p:1")

    if rows:
        parts.append(f"r:{'~'.join(rows)}")

    net_temps = state.get("netInputTemps") or state.get("net_input_temps")
    if net_temps and isinstance(net_temps, dict):
        temp_tokens = []
        seen_keys = set()
        for raw_key, val in net_temps.items():
            if val is None:
                continue
            try:
                num_val = float(val)
            except (ValueError, TypeError):
                continue

            res = raw_key
            if "||" in raw_key:
                res = raw_key.split("||")[0]
            elif "|" in raw_key:
                res = raw_key.split("|")[0]

            def_temp = get_default_element_temp(res, element_map)
            if abs(num_val - def_temp) > 1e-4:
                url_key = raw_key.replace("||", "|")
                if url_key not in seen_keys:
                    seen_keys.add(url_key)
                    temp_tokens.append(f"{url_key}={format_number(num_val)}")

        if temp_tokens:
            parts.append(f"t:{'~'.join(temp_tokens)}")

    return "_".join(parts)


def decode_state_from_param(param_str: str) -> Dict[str, Any]:
    """Deserialize compact string parameter into state object."""
    if not param_str:
        return {"rateMode": "s", "unit": "s", "strictPipeMatching": True, "rows": [], "netInputTemps": {}}

    clean_str = urllib.parse.unquote(param_str.strip())
    if clean_str.startswith("?s="):
        clean_str = clean_str[3:]
    elif clean_str.startswith("s="):
        clean_str = clean_str[2:]

    # Check for b64: fallback
    if clean_str.startswith("b64:"):
        try:
            b64_data = clean_str[4:].replace("-", "+").replace("_", "/")
            padding = len(b64_data) % 4
            if padding:
                b64_data += "=" * (4 - padding)
            json_str = base64.b64decode(b64_data).decode("utf-8")
            parsed = json.loads(json_str)
            rm = "c" if (parsed.get("rateMode") or parsed.get("unit")) == "c" else "s"
            net_temps = parsed.get("netInputTemps", parsed.get("net_input_temps", {}))
            return {
                "rateMode": rm,
                "unit": rm,
                "strictPipeMatching": parsed.get("strictPipeMatching") is not False,
                "rows": parsed.get("rows", []) if isinstance(parsed.get("rows"), list) else [],
                "netInputTemps": net_temps if isinstance(net_temps, dict) else {},
            }
        except Exception:
            return {"rateMode": "s", "unit": "s", "strictPipeMatching": True, "rows": [], "netInputTemps": {}}

    rate_mode = "s"
    strict_pipe = True
    rows: List[Dict[str, Any]] = []
    net_input_temps: Dict[str, float] = {}

    sections = re.split(r"_(?=[uprt]:)", clean_str)
    for sec in sections:
        if sec.startswith("u:"):
            rate_mode = "c" if sec[2:] == "c" else "s"
        elif sec.startswith("p:"):
            strict_pipe = sec[2:] != "0"
        elif sec.startswith("r:"):
            row_tokens = [t for t in sec[2:].split("~") if t]
            for rt in row_tokens:
                decoded = decode_row(rt)
                if decoded:
                    rows.append(decoded)
        elif sec.startswith("t:"):
            tokens = [t for t in re.split(r"[~,]", sec[2:]) if t]
            for tok in tokens:
                if "=" in tok:
                    k, v_str = tok.split("=", 1)
                    try:
                        v = float(v_str)
                        net_input_temps[k] = v
                        if "|" in k and "||" not in k:
                            net_input_temps[k.replace("|", "||")] = v
                    except ValueError:
                        pass

    return {
        "rateMode": rate_mode,
        "unit": rate_mode,
        "strictPipeMatching": strict_pipe,
        "rows": rows,
        "netInputTemps": net_input_temps,
    }


# Backwards compatibility aliases
serialize_state = encode_state_to_param
deserialize_state = decode_state_from_param
encode_state_to_url_param = lambda state, element_map=None: (
    f"?s={urllib.parse.quote(encode_state_to_param(state, element_map))}" if encode_state_to_param(state, element_map) else ""
)
def decode_state_from_url(url: str) -> Optional[Dict[str, Any]]:
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    if "s" not in qs or not qs["s"][0]:
        return None
    return decode_state_from_param(qs["s"][0])
