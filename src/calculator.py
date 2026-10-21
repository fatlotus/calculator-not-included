"""
Pure accounting and resource balance calculation engine for ONI Math.
Mirrors src/calculator.js for exact cross-platform validation.
"""

import re
from typing import Dict, Any, List, Set, Optional

SECONDS_PER_CYCLE = 600

ELEMENT_SHC = {
    "Water": 4.179,
    "Polluted Water": 4.179,
    "Salt Water": 4.100,
    "Brine": 3.400,
    "Oxygen": 1.005,
    "Hydrogen": 2.400,
    "Carbon Dioxide": 0.846,
    "Steam": 4.179,
    "Petroleum": 1.760,
    "Crude Oil": 1.690,
    "Ethanol": 2.460,
    "Dirt": 1.480,
    "Polluted Dirt": 1.480,
    "Sand": 0.830,
    "Coal": 0.900,
    "Natural Gas": 2.191,
    "Chlorine": 0.480,
    "Chlorine Gas": 0.480,
    "Iron": 0.449,
    "Copper": 0.386,
    "Gold": 0.129,
}


def get_element_shc(resource: str, element_map: Optional[Dict[str, Any]] = None) -> float:
    if element_map and resource in element_map:
        elem = element_map[resource]
        if isinstance(elem, dict) and elem.get("shc"):
            return float(elem["shc"])
    return ELEMENT_SHC.get(resource, 1.0)


def format_number(val: Any, max_decimals: int = 4) -> str:
    if val is None:
        return "0"
    try:
        f = float(val)
        factor = 10**max_decimals
        rounded = round(f * factor) / factor
        if abs(rounded) < 1e-6:
            return "0"
        s = f"{rounded:.{max_decimals}f}".rstrip("0").rstrip(".")
        return s if s else "0"
    except (ValueError, TypeError):
        return "0"


def format_stream_line(stream: Dict[str, Any], is_output: bool, rate_mode: str = "s") -> str:
    sign = "+" if is_output else "-"
    rate = abs(float(stream.get("rate", 0.0)))
    unit = stream.get("unit") or "g/s"

    if rate_mode == "c":
        if unit == "g/s":
            rate = (rate * SECONDS_PER_CYCLE) / 1000.0
            unit = "kg/cycle"
        elif unit == "kcal/s":
            rate = rate * SECONDS_PER_CYCLE
            unit = "kcal/cycle"

    text = f"{stream.get('resource')}: {sign}{format_number(rate)} {unit}"
    if is_output and stream.get("temp"):
        text += f" {stream['temp']}"
    if stream.get("state"):
        text += f" ({stream['state']})"
    return text


def get_default_element_temp(resource: str, element_map: Optional[Dict[str, Any]] = None) -> float:
    """
    Helper to determine a reasonable default temperature for an element in °C.
    Uses elem.default_temp if present;
    else 20 °C if within (low_temp, high_temp);
    else a value safely inside the phase range;
    else 20 °C.
    """
    if element_map and resource in element_map:
        elem = element_map[resource]
        if isinstance(elem, dict):
            if elem.get("default_temp") is not None:
                try:
                    return float(elem["default_temp"])
                except (ValueError, TypeError):
                    pass

            low_raw = elem.get("low_temp")
            high_raw = elem.get("high_temp")

            is_kelvin = False
            has_low = low_raw is not None
            has_high = high_raw is not None

            if has_low or has_high:
                try:
                    low_f = float(low_raw) if has_low else None
                    high_f = float(high_raw) if has_high else None
                    has_negative = (low_f is not None and low_f < 0) or (high_f is not None and high_f < 0)
                    if not has_negative:
                        if (low_f is not None and low_f > 50) or (high_f is not None and high_f > 100):
                            is_kelvin = True
                except (ValueError, TypeError):
                    pass

            low_c = None
            if has_low:
                try:
                    low_c = float(low_raw) - 273.15 if is_kelvin else float(low_raw)
                except (ValueError, TypeError):
                    low_c = None

            high_c = None
            if has_high:
                try:
                    high_c = float(high_raw) - 273.15 if is_kelvin else float(high_raw)
                except (ValueError, TypeError):
                    high_c = None

            in_range = True
            if low_c is not None and 20.0 <= low_c:
                in_range = False
            if high_c is not None and 20.0 >= high_c:
                in_range = False

            if in_range:
                return 20.0

            if low_c is not None and high_c is not None:
                return round((low_c + high_c) / 2.0, 1)
            elif low_c is not None:
                return round(low_c + 20.0, 1)
            elif high_c is not None:
                return round(high_c - 20.0, 1)

    return 20.0


def get_resource_key(resource: str, state: Optional[str] = None, strict_pipe_matching: bool = True) -> str:
    return f"{resource}||{state or 'free'}" if strict_pipe_matching else resource


def get_net_input_temp(
    resource: str,
    state: Optional[str],
    net_input_temps: Optional[Dict[str, Any]],
    default_temp: float = 20.0,
    strict_pipe_matching: bool = True,
) -> float:
    if not net_input_temps or not isinstance(net_input_temps, dict):
        return default_temp

    key_strict = f"{resource}||{state or 'free'}"
    key_single_pipe = f"{resource}|{state or 'free'}"
    key_resource = resource

    if strict_pipe_matching:
        if key_strict in net_input_temps:
            try:
                return float(net_input_temps[key_strict])
            except (ValueError, TypeError):
                pass
        if key_single_pipe in net_input_temps:
            try:
                return float(net_input_temps[key_single_pipe])
            except (ValueError, TypeError):
                pass
        if key_resource in net_input_temps:
            try:
                return float(net_input_temps[key_resource])
            except (ValueError, TypeError):
                pass
    else:
        if key_resource in net_input_temps:
            try:
                return float(net_input_temps[key_resource])
            except (ValueError, TypeError):
                pass
        if key_strict in net_input_temps:
            try:
                return float(net_input_temps[key_strict])
            except (ValueError, TypeError):
                pass
        if key_single_pipe in net_input_temps:
            try:
                return float(net_input_temps[key_single_pipe])
            except (ValueError, TypeError):
                pass

    return default_temp


def _get_output_inlet_temp(output_stream: Dict[str, Any], evaluated_inputs: List[Dict[str, Any]], default_temp: float = 20.0) -> float:
    out_res = output_stream.get("resource")
    # 1. Exact resource match among inputs
    for inp in evaluated_inputs:
        if inp.get("resource") == out_res and inp.get("tempC") is not None:
            return float(inp["tempC"])

    # 2. Fluid matching for Water
    if out_res == "Water":
        for inp in evaluated_inputs:
            ires = inp.get("resource", "")
            if ("Water" in ires or ires == "Brine") and inp.get("tempC") is not None:
                return float(inp["tempC"])

    # 3. Mass-weighted average across all machine inputs
    total_mass = 0.0
    total_enthalpy = 0.0
    for inp in evaluated_inputs:
        rate = abs(float(inp.get("rate", 0.0)))
        t = float(inp.get("tempC", default_temp))
        total_mass += rate
        total_enthalpy += rate * t

    if total_mass > 1e-6:
        return total_enthalpy / total_mass

    return default_temp


def evaluate_row(
    row: Dict[str, Any],
    entity_map: Dict[str, Any],
    element_map: Optional[Dict[str, Any]] = None,
    default_input_temp: float = 20.0,
    input_temps: Optional[Dict[str, Any]] = None,
    strict_pipe_matching: bool = True,
) -> Dict[str, Any]:
    entity_id = row.get("entityId") or row.get("entity_id")
    entity = entity_map.get(entity_id) if entity_id else None
    if not entity:
        return {
            "entity": None,
            "qty": row.get("qty", 0),
            "power": 0.0,
            "heat": 0.0,
            "buildingHeat": 0.0,
            "shcHeat": 0.0,
            "totalHeat": 0.0,
            "inputTemp": default_input_temp,
            "inputs": [],
            "outputs": [],
            "is_state_transfer_for": set(),
        }

    qty = max(0.0, float(row.get("qty", 0.0)))
    active_mods = set(row.get("modifiers") or [])

    base_inputs = entity.get("inputs") or []
    base_outputs = entity.get("outputs") or []
    base_power = float(entity.get("power", 0.0))
    base_heat = float(entity.get("heat", 0.0))

    recipes = entity.get("recipes") or []
    recipe_id = row.get("recipeId") or row.get("recipe_id")
    if recipes:
        selected_recipe = next((r for r in recipes if r["id"] == recipe_id), recipes[0])
        base_inputs = selected_recipe.get("inputs") or []
        base_outputs = selected_recipe.get("outputs") or []
        if "power" in selected_recipe:
            base_power = float(selected_recipe["power"])
        if "heat" in selected_recipe:
            base_heat = float(selected_recipe["heat"])

    inputs = []
    for s in base_inputs:
        inp_temp = default_input_temp
        if input_temps and isinstance(input_temps, dict):
            k = f"{s['resource']}||{s.get('state') or 'free'}" if strict_pipe_matching else s["resource"]
            k_single = f"{s['resource']}|{s.get('state') or 'free'}"
            if k in input_temps:
                inp_temp = float(input_temps[k])
            elif k_single in input_temps:
                inp_temp = float(input_temps[k_single])
            elif s["resource"] in input_temps:
                inp_temp = float(input_temps[s["resource"]])
        elif row.get("inputTemp") is not None:
            try:
                inp_temp = float(row["inputTemp"])
            except (ValueError, TypeError):
                inp_temp = default_input_temp
        inputs.append({**s, "tempC": inp_temp})

    outputs = []
    for s in base_outputs:
        in_temp = _get_output_inlet_temp(s, inputs, default_input_temp)
        out_temp = in_temp
        temp_str = s.get("temp")

        if temp_str and "+" in temp_str and "@" in temp_str:
            m = re.search(r"([0-9]+(?:\.[0-9]+)?)", temp_str)
            min_temp = float(m.group(1)) if m else 70.0
            out_temp = max(in_temp, min_temp)
            temp_str = f"@ {format_number(out_temp)} °C"
        elif temp_str and "@" not in temp_str and ("+" in temp_str or "-" in temp_str):
            m = re.search(r"([+-]\s*[0-9]+(?:\.[0-9]+)?)", temp_str)
            delta = float(m.group(1).replace(" ", "")) if m else 0.0
            out_temp = in_temp + delta
            temp_str = f"@ {format_number(out_temp)} °C"
        elif temp_str and "@" in temp_str:
            m = re.search(r"([0-9]+(?:\.[0-9]+)?)", temp_str)
            out_temp = float(m.group(1)) if m else in_temp
            temp_str = f"@ {format_number(out_temp)} °C"
        else:
            out_temp = in_temp
            temp_str = f"@ {format_number(out_temp)} °C"

        outputs.append({**s, "temp": temp_str, "tempC": out_temp})

    power = base_power
    heat = base_heat

    for mod in entity.get("modifiers") or []:
        if mod.get("id") not in active_mods:
            continue
        if "input_multiplier" in mod:
            for s in inputs:
                s["rate"] *= float(mod["input_multiplier"])
        if "output_multiplier" in mod:
            for s in outputs:
                s["rate"] *= float(mod["output_multiplier"])
        if "input_multipliers" in mod:
            for s in inputs:
                if s["resource"] in mod["input_multipliers"]:
                    s["rate"] *= float(mod["input_multipliers"][s["resource"]])
        if "output_multipliers" in mod:
            for s in outputs:
                if s["resource"] in mod["output_multipliers"]:
                    s["rate"] *= float(mod["output_multipliers"][s["resource"]])
        if "power_multiplier" in mod:
            power *= float(mod["power_multiplier"])
        if "extra_inputs" in mod:
            for extra in mod["extra_inputs"]:
                existing = next((s for s in inputs if s["resource"] == extra["resource"] and s.get("state") == extra.get("state")), None)
                if existing:
                    existing["rate"] += extra["rate"]
                else:
                    inp_temp = default_input_temp
                    if input_temps and isinstance(input_temps, dict):
                        k = f"{extra['resource']}||{extra.get('state') or 'free'}" if strict_pipe_matching else extra["resource"]
                        k_single = f"{extra['resource']}|{extra.get('state') or 'free'}"
                        if k in input_temps:
                            inp_temp = float(input_temps[k])
                        elif k_single in input_temps:
                            inp_temp = float(input_temps[k_single])
                        elif extra["resource"] in input_temps:
                            inp_temp = float(input_temps[extra["resource"]])
                    inputs.append({**extra, "tempC": inp_temp})
        if "extra_outputs" in mod:
            for extra in mod["extra_outputs"]:
                existing = next((s for s in outputs if s["resource"] == extra["resource"] and s.get("state") == extra.get("state")), None)
                if existing:
                    existing["rate"] += extra["rate"]
                else:
                    in_temp = _get_output_inlet_temp(extra, inputs, default_input_temp)
                    outputs.append({**extra, "tempC": in_temp, "temp": f"@ {format_number(in_temp)} °C"})

    scaled_inputs = [{**s, "rate": s["rate"] * qty} for s in inputs if abs(s["rate"] * qty) > 1e-6]
    scaled_outputs = [{**s, "rate": s["rate"] * qty} for s in outputs if abs(s["rate"] * qty) > 1e-6]
    scaled_power = power * qty
    scaled_heat = heat * qty

    is_state_transfer_for = set()
    for inp in scaled_inputs:
        for out in scaled_outputs:
            if inp.get("resource") == out.get("resource") and inp.get("state") != out.get("state"):
                is_state_transfer_for.add(inp.get("resource"))

    rep_input_temp = scaled_inputs[0].get("tempC", default_input_temp) if scaled_inputs else default_input_temp

    return {
        "entity": entity,
        "qty": qty,
        "power": scaled_power,
        "heat": scaled_heat,
        "buildingHeat": scaled_heat,
        "inputTemp": rep_input_temp,
        "inputs": scaled_inputs,
        "outputs": scaled_outputs,
        "is_state_transfer_for": is_state_transfer_for,
    }


def resolve_table_temperatures(
    rows: List[Dict[str, Any]],
    entity_map: Dict[str, Any],
    element_map: Optional[Dict[str, Any]] = None,
    options: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Iteratively resolve element temperatures across table rows.
    """
    if isinstance(options, bool):
        strict_pipe = options
        net_input_temps = {}
        max_passes = 10
    elif isinstance(options, dict):
        strict_pipe = options.get("strictPipeMatching", options.get("strict_pipe_matching", True))
        net_input_temps = options.get("netInputTemps", options.get("net_input_temps", {}))
        max_passes = options.get("maxPasses", options.get("max_passes", 10))
    else:
        strict_pipe = True
        net_input_temps = {}
        max_passes = 10

    if not rows:
        return []

    def get_key(res: str, st: Optional[str]) -> str:
        return f"{res}||{st or 'free'}" if strict_pipe else res

    def get_def_net_temp(res: str, st: Optional[str]) -> float:
        def_t = get_default_element_temp(res, element_map)
        return get_net_input_temp(res, st, net_input_temps, def_t, strict_pipe)

    current_temps: Dict[str, float] = {}

    for row in rows:
        entity_id = row.get("entityId") or row.get("entity_id")
        entity = entity_map.get(entity_id) if entity_id else None
        if not entity:
            continue
        base_inps = entity.get("inputs") or []
        base_outs = entity.get("outputs") or []
        recipes = entity.get("recipes") or []
        recipe_id = row.get("recipeId") or row.get("recipe_id")
        if recipes:
            selected = next((r for r in recipes if r["id"] == recipe_id), recipes[0])
            base_inps = selected.get("inputs") or []
            base_outs = selected.get("outputs") or []
        for inp in base_inps:
            k = get_key(inp["resource"], inp.get("state"))
            if k not in current_temps:
                current_temps[k] = get_def_net_temp(inp["resource"], inp.get("state"))
        for out in base_outs:
            k = get_key(out["resource"], out.get("state"))
            if k not in current_temps:
                current_temps[k] = get_def_net_temp(out["resource"], out.get("state"))

    evaluated_rows: List[Dict[str, Any]] = []

    for _ in range(max_passes):
        evaluated_rows = [
            evaluate_row(r, entity_map, element_map, 20.0, current_temps, strict_pipe)
            for r in rows
        ]

        prod_mass: Dict[str, float] = {}
        prod_enth: Dict[str, float] = {}
        cons_mass: Dict[str, float] = {}

        for r in evaluated_rows:
            for inp in r.get("inputs", []):
                k = get_key(inp["resource"], inp.get("state"))
                cons_mass[k] = cons_mass.get(k, 0.0) + float(inp["rate"])
            for out in r.get("outputs", []):
                k = get_key(out["resource"], out.get("state"))
                rate = float(out["rate"])
                t = float(out.get("tempC", 20.0))
                prod_mass[k] = prod_mass.get(k, 0.0) + rate
                prod_enth[k] = prod_enth.get(k, 0.0) + rate * t

        all_keys = set(current_temps.keys()) | set(prod_mass.keys()) | set(cons_mass.keys())
        max_diff = 0.0

        for k in all_keys:
            p_m = prod_mass.get(k, 0.0)
            p_h = prod_enth.get(k, 0.0)
            c_m = cons_mass.get(k, 0.0)

            res = k
            st = "free"
            if strict_pipe and "||" in k:
                parts = k.split("||", 1)
                res = parts[0]
                st = parts[1] or "free"

            t_net = get_def_net_temp(res, st)
            deficit = max(0.0, c_m - p_m)

            if p_m + deficit > 1e-6:
                new_t = (p_h + deficit * t_net) / (p_m + deficit)
            elif p_m > 1e-6:
                new_t = p_h / p_m
            else:
                new_t = t_net

            prev_t = current_temps.get(k, t_net)
            diff = abs(new_t - prev_t)
            if diff > max_diff:
                max_diff = diff
            current_temps[k] = new_t

        if max_diff < 1e-4:
            break

    evaluated_rows = [
        evaluate_row(r, entity_map, element_map, 20.0, current_temps, strict_pipe)
        for r in rows
    ]

    return evaluated_rows


evaluate_table_rows = resolve_table_temperatures
resolveTableTemperatures = resolve_table_temperatures
getDefaultElementTemp = get_default_element_temp
getResourceKey = get_resource_key
getNetInputTemp = get_net_input_temp


def calculate_row_match_targets(
    target_row_index: int, rows: List[Dict[str, Any]], entity_map: Dict[str, Any]
) -> Dict[str, Any]:
    target_row = rows[target_row_index] if 0 <= target_row_index < len(rows) else None
    if not target_row:
        return {}

    unit_row = evaluate_row({**target_row, "qty": 1}, entity_map)
    other_evaluated = [evaluate_row(rows[j], entity_map) for j in range(len(rows)) if j != target_row_index]

    other_buckets: Dict[str, float] = {}
    other_power = 0.0

    for r in other_evaluated:
        other_power += float(r.get("power", 0.0))
        for inp in r.get("inputs", []):
            k = f"{inp['resource']}||{inp.get('state') or 'free'}"
            other_buckets[k] = other_buckets.get(k, 0.0) - float(inp["rate"])
        for out in r.get("outputs", []):
            k = f"{out['resource']}||{out.get('state') or 'free'}"
            other_buckets[k] = other_buckets.get(k, 0.0) + float(out["rate"])

    matches = {}
    target_qty = float(target_row.get("qty", 1.0))

    for inp in unit_row.get("inputs", []):
        k = f"in:{inp['resource']}||{inp.get('state') or 'free'}"
        surplus = other_buckets.get(f"{inp['resource']}||{inp.get('state') or 'free'}", 0.0)
        if surplus > 1e-5 and float(inp["rate"]) > 1e-6:
            tq = surplus / float(inp["rate"])
            matches[k] = {"targetQty": tq, "isMatched": abs(tq - target_qty) < 1e-4}

    for out in unit_row.get("outputs", []):
        k = f"out:{out['resource']}||{out.get('state') or 'free'}"
        deficit = other_buckets.get(f"{out['resource']}||{out.get('state') or 'free'}", 0.0)
        if deficit < -1e-5 and float(out["rate"]) > 1e-6:
            tq = abs(deficit) / float(out["rate"])
            matches[k] = {"targetQty": tq, "isMatched": abs(tq - target_qty) < 1e-4}

    if float(unit_row.get("power", 0.0)) < -1e-5 and other_power > 1e-5:
        tq = other_power / abs(float(unit_row["power"]))
        matches["in:Power"] = {"targetQty": tq, "isMatched": abs(tq - target_qty) < 1e-4}
    elif float(unit_row.get("power", 0.0)) > 1e-5 and other_power < -1e-5:
        tq = abs(other_power) / float(unit_row["power"])
        matches["out:Power"] = {"targetQty": tq, "isMatched": abs(tq - target_qty) < 1e-4}

    return matches


def calculate_system_net(
    evaluated_rows: List[Dict[str, Any]], strict_pipe_matching: Any = True
) -> Dict[str, Any]:
    if isinstance(strict_pipe_matching, dict):
        if "strictPipeMatching" in strict_pipe_matching:
            strict_pipe = bool(strict_pipe_matching["strictPipeMatching"])
        elif "strict_pipe_matching" in strict_pipe_matching:
            strict_pipe = bool(strict_pipe_matching["strict_pipe_matching"])
        else:
            strict_pipe = True
        net_input_temps = strict_pipe_matching.get("netInputTemps", strict_pipe_matching.get("net_input_temps", {}))
        element_map = strict_pipe_matching.get("elementMap", strict_pipe_matching.get("element_map", None))
    else:
        strict_pipe = bool(strict_pipe_matching)
        net_input_temps = {}
        element_map = None

    net_power = 0.0
    net_heat = 0.0
    state_transfer_resources: Set[str] = set()
    buckets: Dict[str, Dict[str, Any]] = {}

    for row in evaluated_rows:
        net_power += float(row.get("power", 0.0))
        net_heat += float(row.get("heat", 0.0))

        for res in row.get("is_state_transfer_for", set()):
            state_transfer_resources.add(res)

        for inp in row.get("inputs", []):
            res = inp.get("resource")
            st = inp.get("state") or "free"
            key = f"{res}||{st}"
            if key not in buckets:
                buckets[key] = {
                    "resource": res,
                    "state": st,
                    "unit": inp.get("unit") or "g/s",
                    "net_rate": 0.0,
                    "temp": None,
                    "temp_enthalpy": 0.0,
                    "total_out_rate": 0.0,
                }
            buckets[key]["net_rate"] -= float(inp.get("rate", 0.0))

        for out in row.get("outputs", []):
            res = out.get("resource")
            st = out.get("state") or "free"
            key = f"{res}||{st}"
            if key not in buckets:
                buckets[key] = {
                    "resource": res,
                    "state": st,
                    "unit": out.get("unit") or "g/s",
                    "net_rate": 0.0,
                    "temp": out.get("temp"),
                    "temp_enthalpy": 0.0,
                    "total_out_rate": 0.0,
                }
            b = buckets[key]
            rate = float(out.get("rate", 0.0))
            b["net_rate"] += rate
            t = float(out.get("tempC", 20.0))
            b["temp_enthalpy"] += rate * t
            b["total_out_rate"] += rate
            if out.get("temp") and not b.get("temp"):
                b["temp"] = out.get("temp")

    for b in buckets.values():
        if b["total_out_rate"] > 0:
            avg_t = b["temp_enthalpy"] / b["total_out_rate"]
            b["tempC"] = avg_t
            b["temp"] = f"@ {format_number(avg_t)} °C"

    final_buckets: List[Dict[str, Any]] = []
    by_resource: Dict[str, List[Dict[str, Any]]] = {}

    for b in buckets.values():
        if abs(b["net_rate"]) < 1e-5:
            continue
        by_resource.setdefault(b["resource"], []).append(b)

    for resource, res_buckets in by_resource.items():
        if strict_pipe or (resource in state_transfer_resources) or len(res_buckets) == 1:
            final_buckets.extend(res_buckets)
        else:
            combined_rate = sum(b["net_rate"] for b in res_buckets)
            dominant = max(res_buckets, key=lambda b: abs(b["net_rate"]))
            output_temp = None
            temp_enth = 0.0
            tot_out = 0.0
            for b in res_buckets:
                if b["total_out_rate"] > 0:
                    temp_enth += b["temp_enthalpy"]
                    tot_out += b["total_out_rate"]
            if tot_out > 0:
                output_temp = f"@ {format_number(temp_enth / tot_out)} °C"
            if abs(combined_rate) >= 1e-5:
                final_buckets.append({
                    "resource": resource,
                    "state": dominant["state"],
                    "unit": dominant["unit"],
                    "net_rate": combined_rate,
                    "temp": output_temp if combined_rate > 0 else None,
                    "tempC": (temp_enth / tot_out) if tot_out > 0 else None,
                })

    net_inputs = []
    net_outputs = []

    for b in final_buckets:
        if b["net_rate"] < -1e-5:
            def_t = get_default_element_temp(b["resource"], element_map)
            t_in = get_net_input_temp(b["resource"], b["state"], net_input_temps, def_t, strict_pipe)
            net_inputs.append({
                "resource": b["resource"],
                "rate": abs(b["net_rate"]),
                "unit": b["unit"],
                "state": b["state"],
                "temp": f"@ {format_number(t_in)} °C",
                "tempC": t_in,
            })
        elif b["net_rate"] > 1e-5:
            net_outputs.append({
                "resource": b["resource"],
                "rate": b["net_rate"],
                "unit": b["unit"],
                "state": b["state"],
                "temp": b.get("temp"),
                "tempC": b.get("tempC"),
            })

    return {
        "net_power": round(net_power, 2),
        "net_heat": round(net_heat, 2),
        "net_building_heat": round(net_heat, 2),
        "net_inputs": net_inputs,
        "net_outputs": net_outputs,
        "netPower": round(net_power, 2),
        "netHeat": round(net_heat, 2),
        "netBuildingHeat": round(net_heat, 2),
        "netInputs": net_inputs,
        "netOutputs": net_outputs,
    }
