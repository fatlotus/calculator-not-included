"""
Pure accounting and resource balance calculation engine for ONI Math.
Mirrors src/calculator.js for exact cross-platform validation.
"""

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


def evaluate_row(
    row: Dict[str, Any],
    entity_map: Dict[str, Any],
    element_map: Optional[Dict[str, Any]] = None,
    default_input_temp: float = 20.0,
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
    input_temp = float(row.get("inputTemp") if row.get("inputTemp") is not None else default_input_temp)

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

    inputs = [{**s, "tempC": input_temp} for s in base_inputs]
    outputs = []
    for s in base_outputs:
        temp_str = s.get("temp")
        out_temp = input_temp
        if temp_str and "+" in temp_str:
            import re
            m = re.search(r"([0-9]+(?:\.[0-9]+)?)", temp_str)
            min_temp = float(m.group(1)) if m else 70.0
            out_temp = max(input_temp, min_temp)
            temp_str = f"@ {format_number(out_temp)} °C" if input_temp > min_temp else f"@ {int(min_temp)} °C+"
        elif temp_str and "@" in temp_str:
            import re
            m = re.search(r"([0-9]+(?:\.[0-9]+)?)", temp_str)
            if m:
                out_temp = float(m.group(1))
        else:
            out_temp = input_temp
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
                    inputs.append({**extra, "tempC": input_temp})
        if "extra_outputs" in mod:
            for extra in mod["extra_outputs"]:
                existing = next((s for s in outputs if s["resource"] == extra["resource"] and s.get("state") == extra.get("state")), None)
                if existing:
                    existing["rate"] += extra["rate"]
                else:
                    outputs.append({**extra, "tempC": input_temp, "temp": f"@ {format_number(input_temp)} °C"})

    scaled_inputs = [{**s, "rate": s["rate"] * qty} for s in inputs if abs(s["rate"] * qty) > 1e-6]
    scaled_outputs = [{**s, "rate": s["rate"] * qty} for s in outputs if abs(s["rate"] * qty) > 1e-6]
    scaled_power = power * qty
    scaled_heat = heat * qty

    in_enth = sum((inp["rate"] * get_element_shc(inp["resource"], element_map) * input_temp) / 1000.0 for inp in scaled_inputs)
    out_enth = sum((out["rate"] * get_element_shc(out["resource"], element_map) * out.get("tempC", input_temp)) / 1000.0 for out in scaled_outputs)
    shc_heat = round(out_enth - in_enth, 2)
    total_heat = round(scaled_heat + shc_heat, 2)

    is_state_transfer_for = set()
    for inp in scaled_inputs:
        for out in scaled_outputs:
            if inp.get("resource") == out.get("resource") and inp.get("state") != out.get("state"):
                is_state_transfer_for.add(inp.get("resource"))

    return {
        "entity": entity,
        "qty": qty,
        "power": scaled_power,
        "heat": scaled_heat,
        "buildingHeat": scaled_heat,
        "shcHeat": shc_heat,
        "totalHeat": total_heat,
        "inputTemp": input_temp,
        "inputs": scaled_inputs,
        "outputs": scaled_outputs,
        "is_state_transfer_for": is_state_transfer_for,
    }


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
    else:
        strict_pipe = bool(strict_pipe_matching)

    net_power = 0.0
    net_building_heat = 0.0
    net_shc_heat = 0.0
    state_transfer_resources: Set[str] = set()
    buckets: Dict[str, Dict[str, Any]] = {}

    for row in evaluated_rows:
        net_power += float(row.get("power", 0.0))
        net_building_heat += float(row.get("buildingHeat", row.get("heat", 0.0)))
        net_shc_heat += float(row.get("shcHeat", 0.0))

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
                }
            b = buckets[key]
            b["net_rate"] += float(out.get("rate", 0.0))
            if out.get("temp") and not b.get("temp"):
                b["temp"] = out.get("temp")

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
            output_temp = next((b["temp"] for b in res_buckets if b["net_rate"] > 0 and b["temp"]), None)
            if abs(combined_rate) >= 1e-5:
                final_buckets.append({
                    "resource": resource,
                    "state": dominant["state"],
                    "unit": dominant["unit"],
                    "net_rate": combined_rate,
                    "temp": output_temp if combined_rate > 0 else None,
                })

    net_inputs = []
    net_outputs = []

    for b in final_buckets:
        if b["net_rate"] < -1e-5:
            net_inputs.append({
                "resource": b["resource"],
                "rate": abs(b["net_rate"]),
                "unit": b["unit"],
                "state": b["state"],
                "temp": None,
            })
        elif b["net_rate"] > 1e-5:
            net_outputs.append({
                "resource": b["resource"],
                "rate": b["net_rate"],
                "unit": b["unit"],
                "state": b["state"],
                "temp": b["temp"],
            })

    total_net_heat = round(net_building_heat + net_shc_heat, 2)

    return {
        "net_power": round(net_power, 2),
        "net_heat": total_net_heat,
        "net_building_heat": round(net_building_heat, 2),
        "net_shc_heat": round(net_shc_heat, 2),
        "net_inputs": net_inputs,
        "net_outputs": net_outputs,
        "netPower": round(net_power, 2),
        "netHeat": total_net_heat,
        "netBuildingHeat": round(net_building_heat, 2),
        "netShcHeat": round(net_shc_heat, 2),
        "netInputs": net_inputs,
        "netOutputs": net_outputs,
    }
