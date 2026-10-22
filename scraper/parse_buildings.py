"""Scrape ONI buildings and their resource inputs/outputs from oxygennotincluded.wiki.gg."""

import json
import re
from pathlib import Path
from scraper.wiki_client import (
    BASE_URL,
    clean_html_text,
    extract_element_tooltips,
    fetch_wiki_page,
    normalize_icon_url,
    parse_druid_infobox,
)

# Comprehensive list of resource-converting buildings in Oxygen Not Included
TARGET_BUILDINGS = [
    # Oxygen
    ("Electrolyzer", "Oxygen"),
    ("Oxygen_Diffuser", "Oxygen"),
    ("Algae_Terrarium", "Oxygen"),
    ("Rust_Deoxidizer", "Oxygen"),
    ("Sublimation_Station", "Oxygen"),
    ("Deodorizer", "Oxygen"),
    ("Carbon_Skimmer", "Oxygen"),
    ("Oxylite_Refinery", "Oxygen"),
    # Power
    ("Hydrogen_Generator", "Power"),
    ("Coal_Generator", "Power"),
    ("Wood_Burner", "Power"),
    ("Peat_Burner", "Power"),
    ("Natural_Gas_Generator", "Power"),
    ("Petroleum_Generator", "Power"),
    ("Steam_Turbine", "Power"),
    ("Solar_Panel", "Power"),
    ("Manual_Generator", "Power"),
    # Plumbing & HVAC Pumps
    ("Liquid_Pump", "Plumbing"),
    ("Mini_Liquid_Pump", "Plumbing"),
    ("Pitcher_Pump", "Plumbing"),
    ("Gas_Pump", "Ventilation"),
    ("Mini_Gas_Pump", "Ventilation"),
    # Refinement & Distillation
    ("Water_Sieve", "Refinement"),
    ("Desalinator", "Refinement"),
    ("Ethanol_Distiller", "Refinement"),
    ("Algae_Distiller", "Refinement"),
    ("Sludge_Press", "Refinement"),
    ("Compost", "Refinement"),
    ("Fertilizer_Synthesizer", "Refinement"),
    ("Polymer_Press", "Refinement"),
    ("Oil_Refinery", "Refinement"),
    ("Kiln", "Refinement"),
    ("Rock_Crusher", "Refinement"),
    ("Metal_Refinery", "Refinement"),
    ("Glass_Forge", "Refinement"),
    ("Molecular_Forge", "Refinement"),
    ("Bleach_Stone_Hopper", "Refinement"),
    ("Milk_Fat_Separator", "Refinement"),
    ("Brackwax_Gleaner", "Refinement"),
    # Utilities / Heat / Oil
    ("Thermo_Aquatuner", "Utilities"),
    ("Thermo_Regulator", "Utilities"),
    ("Ice-E_Fan", "Utilities"),
    ("Ice_Maker", "Utilities"),
    ("Oil_Well", "Utilities"),
    ("Ore_Scrubber", "Medical"),
    # Food / Cooking / Farming / Ranching
    ("Microbe_Musher", "Food"),
    ("Electric_Grill", "Food"),
    ("Gas_Range", "Food"),
    ("Deep_Fryer", "Food"),
    ("Smoker", "Food"),
    ("Incubator", "Ranching"),
    ("Plant_Pulverizer", "Refinement"),
    ("Milk_Press", "Food"),
]


def parse_power_string(power_str: str) -> float:
    """Parse power string like '-120 W', '+ 800 W', '-1.2 kW' into Watts (+output, -input)."""
    if not power_str:
        return 0.0
    m = re.search(r"([+-]?\s*\d+(?:\.\d+)?)\s*(kW|W)", power_str, re.IGNORECASE)
    if not m:
        return 0.0
    val = float(m.group(1).replace(" ", ""))
    unit = m.group(2).lower()
    if unit == "kw":
        val *= 1000.0
    return val


def parse_heat_string(heat_str: str) -> float:
    """Parse heat string like '+ 1.25 kDTU/s', '+ 500 DTU/s' into kDTU/s."""
    if not heat_str:
        return 0.0
    m = re.search(r"([+-]?\s*\d+(?:\.\d+)?)\s*(kDTU/s|DTU/s)", heat_str, re.IGNORECASE)
    if not m:
        return 0.0
    val = float(m.group(1).replace(" ", ""))
    unit = m.group(2).lower()
    if unit == "dtu/s":
        val /= 1000.0
    return val


def parse_rate_lines(text: str, is_output: bool, piped_elements: set[str], default_piped: bool = False) -> list[dict]:
    """Parse resource lines like 'Water : -1000 g/s' or 'Oxygen : +888 g/s @ 70 °C / 158 °F +'."""
    items = []
    if not text:
        return items
    for line in text.splitlines():
        line = line.strip()
        if ":" not in line:
            continue
        parts = line.split(":", 1)
        res_name = parts[0].strip()
        rest = parts[1].strip()
        if any(skip in res_name.lower() for skip in ["building temperature", "coolant", "auto in", "green", "red", "cooling factor", "heat"]):
            continue

        m = re.search(r"([+-]?\s*\d+(?:,\d+)*(?:\.\d+)?)\s*(kg/s|g/s|mg/s|kg/cycle|g/cycle)", rest, re.IGNORECASE)
        if not m:
            continue
        raw_val = float(m.group(1).replace(" ", "").replace(",", ""))
        unit = m.group(2).lower()
        rate_g_s = abs(raw_val)
        if unit == "kg/s":
            rate_g_s *= 1000.0
        elif unit == "mg/s":
            rate_g_s /= 1000.0
        elif unit == "kg/cycle":
            rate_g_s = (rate_g_s * 1000.0) / 600.0
        elif unit == "g/cycle":
            rate_g_s = rate_g_s / 600.0

        # Extract temperature note if present (e.g. '@ 70 °C' and optional '+' at end)
        temp_m = re.search(r"@\s*(\d+(?:\.\d+)?)\s*°C", rest)
        plus_suffix = "+" if rest.endswith("+") or "°C+" in rest else ""
        temp_note = f"@ {temp_m.group(1)} °C{plus_suffix}" if temp_m else None

        is_piped = default_piped or any(
            p.lower() in res_name.lower() or res_name.lower() in p.lower()
            for p in piped_elements
        )
        state_note = "in a pipe" if is_piped else "free"

        items.append({
            "resource": res_name,
            "rate": round(rate_g_s, 4),
            "unit": "g/s",
            "state": state_note,
            "temp": temp_note,
        })
    return items


def extract_piped_elements(rows: dict) -> tuple[set[str], set[str]]:
    """Determine which input and output resources use pipes (Liquid or Ventilation)."""
    in_pipes = set()
    out_pipes = set()
    for key in ("Piping", "Ventilation"):
        txt = rows.get(key, "")
        for line in txt.splitlines():
            if "Input:" in line:
                elem = line.split("Input:", 1)[1].replace("Intake", "").replace("Pipe", "").strip()
                if elem:
                    in_pipes.add(elem)
            if "Output:" in line:
                elem = line.split("Output:", 1)[1].replace("Output", "").replace("Pipe", "").strip()
                if elem:
                    out_pipes.add(elem)
    return in_pipes, out_pipes


def apply_curated_overrides(buildings_by_id: dict[str, dict]) -> None:
    """Enrich scraped buildings with multi-recipe options and pump/special configurations verified from wiki.gg."""
    from scraper.parse_elements import scrape_all_elements
    all_elements, _ = scrape_all_elements()
    liquids = [e for e in all_elements if e.get("state") == "Liquid"]
    gases = [e for e in all_elements if e.get("state") == "Gas"]

    # 1. Liquid Pump (pass-through, 10 kg/s / 240 W for every Liquid)
    if "liquid_pump" in buildings_by_id:
        lp = buildings_by_id["liquid_pump"]
        lp["aliases"] = ["Water Pump"]
        lp["name"] = "Liquid Pump"
        lp_recipes = [
            {
                "id": "water",
                "name": "Water (10 kg/s)",
                "inputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "power": -240.0,
                "heat": 2.0,
            },
            {
                "id": "water_full",
                "name": "Water (Max Capacity 10 kg/s)",
                "inputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "power": -240.0,
                "heat": 2.0,
            },
        ]
        seen_liquid_ids = {"water", "water_full"}
        for l in sorted(liquids, key=lambda x: x["name"]):
            lname = l["name"]
            if lname == "Water":
                continue
            r_id = lname.lower().replace(" ", "_").replace("-", "_")
            if r_id not in seen_liquid_ids:
                seen_liquid_ids.add(r_id)
                lp_recipes.append({
                    "id": r_id,
                    "name": f"{lname} (10 kg/s)",
                    "inputs": [{"resource": lname, "rate": 10000.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": lname, "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                    "power": -240.0,
                    "heat": 2.0,
                })
            # Preserve existing legacy _full recipe IDs
            if r_id in ("polluted_water", "crude_oil", "petroleum"):
                full_id = f"{r_id}_full"
                if full_id not in seen_liquid_ids:
                    seen_liquid_ids.add(full_id)
                    lp_recipes.append({
                        "id": full_id,
                        "name": f"{lname} (Max Capacity 10 kg/s)",
                        "inputs": [{"resource": lname, "rate": 10000.0, "unit": "g/s", "state": "free", "temp": None}],
                        "outputs": [{"resource": lname, "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                        "power": -240.0,
                        "heat": 2.0,
                    })

        lp["recipes"] = lp_recipes
        lp["inputs"] = lp["recipes"][0]["inputs"]
        lp["outputs"] = lp["recipes"][0]["outputs"]
        lp["power"] = lp["recipes"][0]["power"]
        lp["heat"] = lp["recipes"][0]["heat"]

    # 2. Gas Pump (pass-through, 500 g/s / 240 W for every Gas)
    if "gas_pump" in buildings_by_id:
        gp = buildings_by_id["gas_pump"]
        # Keep existing recipe IDs at front
        priority_gas_names = ["Hydrogen", "Oxygen", "Natural Gas", "Carbon Dioxide"]
        gp_recipes = []
        seen_gas_ids = set()

        for gname in priority_gas_names:
            r_id = gname.lower().replace(" ", "_").replace("-", "_")
            seen_gas_ids.add(r_id)
            gp_recipes.append({
                "id": r_id,
                "name": f"{gname} (500 g/s)",
                "inputs": [{"resource": gname, "rate": 500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": gname, "rate": 500.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "power": -240.0,
                "heat": 2.0,
            })

        for g in sorted(gases, key=lambda x: x["name"]):
            gname = g["name"]
            r_id = gname.lower().replace(" ", "_").replace("-", "_")
            if r_id not in seen_gas_ids:
                seen_gas_ids.add(r_id)
                gp_recipes.append({
                    "id": r_id,
                    "name": f"{gname} (500 g/s)",
                    "inputs": [{"resource": gname, "rate": 500.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": gname, "rate": 500.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                    "power": -240.0,
                    "heat": 2.0,
                })

        gp["recipes"] = gp_recipes
        gp["inputs"] = gp["recipes"][0]["inputs"]
        gp["outputs"] = gp["recipes"][0]["outputs"]
        gp["power"] = gp["recipes"][0]["power"]
        gp["heat"] = gp["recipes"][0]["heat"]

    # 3. Mini Gas Pump (pass-through, 50 g/s / 60 W for every Gas) & Mini Liquid Pump (pass-through, 1 kg/s / 60 W for every Liquid)
    if "mini_gas_pump" in buildings_by_id:
        mgp = buildings_by_id["mini_gas_pump"]
        priority_mini_gases = ["Oxygen", "Hydrogen"]
        mgp_recipes = []
        seen_mini_gases = set()

        for gname in priority_mini_gases:
            r_id = gname.lower().replace(" ", "_").replace("-", "_")
            seen_mini_gases.add(r_id)
            mgp_recipes.append({
                "id": r_id,
                "name": f"{gname} (50 g/s)",
                "inputs": [{"resource": gname, "rate": 50.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": gname, "rate": 50.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "power": -60.0,
                "heat": 0.0,
            })

        for g in sorted(gases, key=lambda x: x["name"]):
            gname = g["name"]
            r_id = gname.lower().replace(" ", "_").replace("-", "_")
            if r_id not in seen_mini_gases:
                seen_mini_gases.add(r_id)
                mgp_recipes.append({
                    "id": r_id,
                    "name": f"{gname} (50 g/s)",
                    "inputs": [{"resource": gname, "rate": 50.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": gname, "rate": 50.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                    "power": -60.0,
                    "heat": 0.0,
                })

        mgp["recipes"] = mgp_recipes
        mgp["inputs"] = mgp["recipes"][0]["inputs"]
        mgp["outputs"] = mgp["recipes"][0]["outputs"]
        mgp["power"] = -60.0
        mgp["heat"] = 0.0

    if "mini_liquid_pump" in buildings_by_id:
        mlp = buildings_by_id["mini_liquid_pump"]
        mlp_recipes = [
            {
                "id": "water",
                "name": "Water (1000 g/s)",
                "inputs": [{"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "power": -60.0,
                "heat": 0.0,
            },
        ]
        seen_mlp_ids = {"water"}
        for l in sorted(liquids, key=lambda x: x["name"]):
            lname = l["name"]
            if lname == "Water":
                continue
            r_id = lname.lower().replace(" ", "_").replace("-", "_")
            if r_id not in seen_mlp_ids:
                seen_mlp_ids.add(r_id)
                mlp_recipes.append({
                    "id": r_id,
                    "name": f"{lname} (1 kg/s)",
                    "inputs": [{"resource": lname, "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": lname, "rate": 1000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                    "power": -60.0,
                    "heat": 0.0,
                })

        mlp["recipes"] = mlp_recipes
        mlp["inputs"] = mlp["recipes"][0]["inputs"]
        mlp["outputs"] = mlp["recipes"][0]["outputs"]
        mlp["power"] = -60.0
        mlp["heat"] = 0.0

    # 4. Multi-recipe buildings: Desalinator, Water Sieve, Kiln, Rock Crusher, Polymer Press, Oil Refinery, Oil Well, Fertilizer Synthesizer, Algae Terrarium, Steam Turbine, Petroleum Generator, Natural Gas Generator
    if "desalinator" in buildings_by_id:
        d = buildings_by_id["desalinator"]
        d["recipes"] = [
            {
                "id": "salt_water",
                "name": "Salt Water -> Water + Salt",
                "inputs": [{"resource": "Salt Water", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [
                    {"resource": "Water", "rate": 4650.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Salt", "rate": 350.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "power": -480.0,
                "heat": 8.0,
            },
            {
                "id": "brine",
                "name": "Brine -> Water + Salt",
                "inputs": [{"resource": "Brine", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [
                    {"resource": "Water", "rate": 3500.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Salt", "rate": 1500.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "power": -480.0,
                "heat": 8.0,
            },
        ]
        d["inputs"] = d["recipes"][0]["inputs"]
        d["outputs"] = d["recipes"][0]["outputs"]

    if "water_sieve" in buildings_by_id:
        ws = buildings_by_id["water_sieve"]
        ws["recipes"] = [
            {
                "id": "sand",
                "name": "Purify with Sand",
                "inputs": [
                    {"resource": "Polluted Water", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Sand", "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "outputs": [
                    {"resource": "Water", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Polluted Dirt", "rate": 200.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "power": -120.0,
                "heat": 4.0,
            },
            {
                "id": "regolith",
                "name": "Purify with Regolith",
                "inputs": [
                    {"resource": "Polluted Water", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Regolith", "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "outputs": [
                    {"resource": "Water", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": None},
                    {"resource": "Polluted Dirt", "rate": 200.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "power": -120.0,
                "heat": 4.0,
            },
        ]
        ws["inputs"] = ws["recipes"][0]["inputs"]
        ws["outputs"] = ws["recipes"][0]["outputs"]

    if "kiln" in buildings_by_id:
        k = buildings_by_id["kiln"]
        # 40s fabrication time per batch
        k["recipes"] = [
            {
                "id": "ceramic",
                "name": "Ceramic (100 kg Clay + 25 kg Coal / 40s)",
                "inputs": [
                    {"resource": "Clay", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None},
                    {"resource": "Coal", "rate": 625.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "outputs": [
                    {"resource": "Ceramic", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 80 °C+"},
                ],
                "power": 0.0,
                "heat": 20.0,
            },
            {
                "id": "refined_carbon_coal",
                "name": "Refined Carbon from Coal (125 kg -> 100 kg / 40s)",
                "inputs": [{"resource": "Coal", "rate": 3125.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Refined Carbon", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 80 °C+"}],
                "power": 0.0,
                "heat": 20.0,
            },
            {
                "id": "refined_carbon_wood",
                "name": "Refined Carbon from Wood (200 kg -> 100 kg / 40s)",
                "inputs": [{"resource": "Wood", "rate": 5000.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Refined Carbon", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 80 °C+"}],
                "power": 0.0,
                "heat": 20.0,
            },
        ]
        k["inputs"] = k["recipes"][0]["inputs"]
        k["outputs"] = k["recipes"][0]["outputs"]

    if "rock_crusher" in buildings_by_id:
        rc = buildings_by_id["rock_crusher"]
        # 40s fabrication time per batch
        rc["recipes"] = [
            {
                "id": "fossil_lime",
                "name": "Fossil (100 kg) -> Lime (5 kg) + Sedimentary Rock (95 kg)",
                "inputs": [{"resource": "Fossil", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [
                    {"resource": "Lime", "rate": 125.0, "unit": "g/s", "state": "free", "temp": None},
                    {"resource": "Sedimentary Rock", "rate": 2375.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "power": -240.0,
                "heat": 16.0,
            },
            {
                "id": "eggshell_lime",
                "name": "Egg Shell (5 kg) -> Lime (5 kg)",
                "inputs": [{"resource": "Egg Shell", "rate": 125.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Lime", "rate": 125.0, "unit": "g/s", "state": "free", "temp": None}],
                "power": -240.0,
                "heat": 16.0,
            },
            {
                "id": "sandstone_sand",
                "name": "Raw Mineral (100 kg) -> Sand (100 kg)",
                "inputs": [{"resource": "Sandstone", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Sand", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "power": -240.0,
                "heat": 16.0,
            },
            {
                "id": "salt_table_salt",
                "name": "Salt (100 kg) -> Sand (100 kg) + Table Salt",
                "inputs": [{"resource": "Salt", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Sand", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "power": -240.0,
                "heat": 16.0,
            },
        ]
        rc["inputs"] = rc["recipes"][0]["inputs"]
        rc["outputs"] = rc["recipes"][0]["outputs"]

    if "metal_refinery" in buildings_by_id:
        mr = buildings_by_id["metal_refinery"]
        mr["recipes"] = [
            {
                "id": "iron",
                "name": "Iron Ore (100 kg) -> Iron (100 kg) [40s]",
                "inputs": [{"resource": "Iron Ore", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Iron", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C"}],
                "power": -1200.0,
                "heat": 16.0,
            },
            {
                "id": "steel",
                "name": "Steel (70 kg Iron + 20 kg Refined Carbon + 10 kg Lime) [40s]",
                "inputs": [
                    {"resource": "Iron", "rate": 1750.0, "unit": "g/s", "state": "free", "temp": None},
                    {"resource": "Refined Carbon", "rate": 500.0, "unit": "g/s", "state": "free", "temp": None},
                    {"resource": "Lime", "rate": 250.0, "unit": "g/s", "state": "free", "temp": None},
                ],
                "outputs": [{"resource": "Steel", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C"}],
                "power": -1200.0,
                "heat": 16.0,
            },
            {
                "id": "copper",
                "name": "Copper Ore (100 kg) -> Copper (100 kg) [40s]",
                "inputs": [{"resource": "Copper Ore", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Copper", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C"}],
                "power": -1200.0,
                "heat": 16.0,
            },
            {
                "id": "gold",
                "name": "Gold Amalgam (100 kg) -> Gold (100 kg) [40s]",
                "inputs": [{"resource": "Gold Amalgam", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": None}],
                "outputs": [{"resource": "Gold", "rate": 2500.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C"}],
                "power": -1200.0,
                "heat": 16.0,
            },
        ]
        mr["inputs"] = mr["recipes"][0]["inputs"]
        mr["outputs"] = mr["recipes"][0]["outputs"]

    if "polymer_press" in buildings_by_id:
        pp = buildings_by_id["polymer_press"]
        pp["inputs"] = [{"resource": "Petroleum", "rate": 833.33, "unit": "g/s", "state": "in a pipe", "temp": None}]
        pp["outputs"] = [
            {"resource": "Plastic", "rate": 500.0, "unit": "g/s", "state": "free", "temp": "@ 75 °C+"},
            {"resource": "Steam", "rate": 8.33, "unit": "g/s", "state": "free", "temp": "@ 200 °C+"},
            {"resource": "Carbon Dioxide", "rate": 8.33, "unit": "g/s", "state": "in a pipe", "temp": "@ 150 °C+"},
        ]

    if "algae_terrarium" in buildings_by_id:
        at = buildings_by_id["algae_terrarium"]
        at["inputs"] = [
            {"resource": "Algae", "rate": 30.0, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Water", "rate": 300.0, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Carbon Dioxide", "rate": 0.3333, "unit": "g/s", "state": "free", "temp": None},
        ]
        at["outputs"] = [
            {"resource": "Oxygen", "rate": 40.0, "unit": "g/s", "state": "free", "temp": "@ 30 °C+"},
            {"resource": "Polluted Water", "rate": 290.33, "unit": "g/s", "state": "free", "temp": "@ 30 °C+"},
        ]
        at["modifiers"] = [
            {"id": "illuminated", "name": "Illuminated (+10% Oxygen)", "output_multipliers": {"Oxygen": 1.1}}
        ]

    if "steam_turbine" in buildings_by_id:
        st = buildings_by_id["steam_turbine"]
        st["power"] = 850.0
        st["inputs"] = [{"resource": "Steam", "rate": 2000.0, "unit": "g/s", "state": "free", "temp": "@ 125 °C+"}]
        st["outputs"] = [{"resource": "Water", "rate": 2000.0, "unit": "g/s", "state": "in a pipe", "temp": "@ 95 °C"}]

    if "petroleum_generator" in buildings_by_id:
        pg = buildings_by_id["petroleum_generator"]
        pg["recipes"] = [
            {
                "id": "petroleum",
                "name": "Petroleum (2000 g/s)",
                "inputs": [{"resource": "Petroleum", "rate": 2000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [
                    {"resource": "Polluted Water", "rate": 750.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C+"},
                    {"resource": "Carbon Dioxide", "rate": 500.0, "unit": "g/s", "state": "free", "temp": "@ 110 °C+"},
                ],
                "power": 2000.0,
                "heat": 20.0,
            },
            {
                "id": "ethanol",
                "name": "Ethanol (2000 g/s)",
                "inputs": [{"resource": "Ethanol", "rate": 2000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [
                    {"resource": "Polluted Water", "rate": 750.0, "unit": "g/s", "state": "free", "temp": "@ 40 °C+"},
                    {"resource": "Carbon Dioxide", "rate": 500.0, "unit": "g/s", "state": "free", "temp": "@ 110 °C+"},
                ],
                "power": 2000.0,
                "heat": 20.0,
            },
        ]
        pg["inputs"] = pg["recipes"][0]["inputs"]
        pg["outputs"] = pg["recipes"][0]["outputs"]

    if "natural_gas_generator" in buildings_by_id:
        ng = buildings_by_id["natural_gas_generator"]
        ng["inputs"] = [{"resource": "Natural Gas", "rate": 90.0, "unit": "g/s", "state": "in a pipe", "temp": None}]
        ng["outputs"] = [
            {"resource": "Polluted Water", "rate": 67.5, "unit": "g/s", "state": "free", "temp": "@ 40 °C+"},
            {"resource": "Carbon Dioxide", "rate": 22.5, "unit": "g/s", "state": "in a pipe", "temp": "@ 110 °C+"},
        ]

    if "oil_refinery" in buildings_by_id:
        orc = buildings_by_id["oil_refinery"]
        orc["inputs"] = [{"resource": "Crude Oil", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}]
        orc["outputs"] = [
            {"resource": "Petroleum", "rate": 5000.0, "unit": "g/s", "state": "in a pipe", "temp": "@ 75 °C+"},
            {"resource": "Natural Gas", "rate": 90.0, "unit": "g/s", "state": "free", "temp": "@ 75 °C+"},
        ]

    if "oil_well" in buildings_by_id:
        ow = buildings_by_id["oil_well"]
        ow["inputs"] = [{"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "in a pipe", "temp": None}]
        ow["outputs"] = [
            {"resource": "Crude Oil", "rate": 3333.33, "unit": "g/s", "state": "free", "temp": "@ 90 °C+"},
            {"resource": "Natural Gas", "rate": 33.33, "unit": "g/s", "state": "free", "temp": "@ 300 °C+"},
        ]

    if "fertilizer_synthesizer" in buildings_by_id:
        fs = buildings_by_id["fertilizer_synthesizer"]
        fs["inputs"] = [
            {"resource": "Polluted Water", "rate": 39.0, "unit": "g/s", "state": "in a pipe", "temp": None},
            {"resource": "Dirt", "rate": 65.0, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Phosphorite", "rate": 26.0, "unit": "g/s", "state": "free", "temp": None},
        ]
        fs["outputs"] = [
            {"resource": "Fertilizer", "rate": 120.0, "unit": "g/s", "state": "free", "temp": "@ 50 °C+"},
            {"resource": "Natural Gas", "rate": 10.0, "unit": "g/s", "state": "free", "temp": "@ 76.85 °C+"},
        ]

    if "ethanol_distiller" in buildings_by_id:
        ed = buildings_by_id["ethanol_distiller"]
        ed["inputs"] = [{"resource": "Wood", "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None}]
        ed["outputs"] = [
            {"resource": "Ethanol", "rate": 500.0, "unit": "g/s", "state": "in a pipe", "temp": "@ 73.4 °C+"},
            {"resource": "Polluted Dirt", "rate": 333.33, "unit": "g/s", "state": "free", "temp": "@ 93.4 °C+"},
            {"resource": "Carbon Dioxide", "rate": 166.67, "unit": "g/s", "state": "free", "temp": "@ 93.4 °C+"},
        ]

    if "sublimation_station" in buildings_by_id:
        ss = buildings_by_id["sublimation_station"]
        ss["inputs"] = [{"resource": "Polluted Dirt", "rate": 1000.0, "unit": "g/s", "state": "free", "temp": None}]
        ss["outputs"] = [{"resource": "Polluted Oxygen", "rate": 660.0, "unit": "g/s", "state": "free", "temp": "@ 30 °C+"}]

    if "deodorizer" in buildings_by_id:
        deo = buildings_by_id["deodorizer"]
        deo["inputs"] = [
            {"resource": "Polluted Oxygen", "rate": 100.0, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Sand", "rate": 133.33, "unit": "g/s", "state": "free", "temp": None},
        ]
        deo["outputs"] = [
            {"resource": "Oxygen", "rate": 90.0, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Clay", "rate": 143.33, "unit": "g/s", "state": "free", "temp": None},
        ]

    if "thermo_aquatuner" in buildings_by_id:
        ta = buildings_by_id["thermo_aquatuner"]
        ta["recipes"] = [
            {
                "id": "water",
                "name": "Cool Water (-14 °C @ 10 kg/s -> +585.06 kDTU/s)",
                "inputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [{"resource": "Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": "-14 °C"}],
                "power": -1200.0,
                "heat": 585.06,
            },
            {
                "id": "polluted_water",
                "name": "Cool Polluted Water (-14 °C @ 10 kg/s -> +585.06 kDTU/s)",
                "inputs": [{"resource": "Polluted Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [{"resource": "Polluted Water", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": "-14 °C"}],
                "power": -1200.0,
                "heat": 585.06,
            },
            {
                "id": "super_coolant",
                "name": "Cool Super Coolant (-14 °C @ 10 kg/s -> +1181.6 kDTU/s)",
                "inputs": [{"resource": "Super Coolant", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": None}],
                "outputs": [{"resource": "Super Coolant", "rate": 10000.0, "unit": "g/s", "state": "in a pipe", "temp": "-14 °C"}],
                "power": -1200.0,
                "heat": 1181.6,
            },
        ]
        ta["inputs"] = ta["recipes"][0]["inputs"]
        ta["outputs"] = ta["recipes"][0]["outputs"]
        ta["heat"] = ta["recipes"][0]["heat"]


def scrape_buildings() -> tuple[list[dict], dict[str, dict]]:
    """Scrape all target buildings and collect discovered element tooltips."""
    buildings_by_id: dict[str, dict] = {}
    discovered_elements: dict[str, dict] = {}

    # Also fetch /wiki/Building index page to capture card icons for any buildings whose main image differs
    card_icons: dict[str, str] = {}
    try:
        index_html = fetch_wiki_page("Building", delay=0.2)
        discovered_elements.update(extract_element_tooltips(index_html))
        for m in re.finditer(
            r'<a href="/wiki/([^"]+)"[^>]*><img[^>]*src="([^"]+)"',
            index_html,
        ):
            slug = m.group(1)
            if slug not in card_icons:
                card_icons[slug] = normalize_icon_url(m.group(2))
    except Exception:
        pass

    for page_slug, default_category in TARGET_BUILDINGS:
        try:
            raw_html = fetch_wiki_page(page_slug, delay=0.22)
        except Exception as err:
            print(f"[buildings] Skipping {page_slug}: {err}")
            continue

        discovered_elements.update(extract_element_tooltips(raw_html))
        info = parse_druid_infobox(raw_html)
        rows = info.get("rows", {})

        b_id = page_slug.lower().replace("-", "_")
        name = info.get("title") or page_slug.replace("_", " ")
        icon = info.get("icon") or card_icons.get(page_slug)

        power_w = parse_power_string(rows.get("Power", ""))
        heat_kdtu = parse_heat_string(rows.get("Heat", ""))
        in_pipes, out_pipes = extract_piped_elements(rows)

        has_in_pipe = bool(in_pipes) or ("Input:" in rows.get("Piping", "")) or ("Input:" in rows.get("Ventilation", ""))
        has_out_pipe = bool(out_pipes) or ("Output:" in rows.get("Piping", "")) or ("Output:" in rows.get("Ventilation", ""))

        inputs = parse_rate_lines(
            rows.get("Requires", ""),
            is_output=False,
            piped_elements=in_pipes,
            default_piped=has_in_pipe and len(in_pipes) == 1,
        )
        outputs = parse_rate_lines(
            rows.get("Effects", ""),
            is_output=True,
            piped_elements=out_pipes,
            default_piped=has_out_pipe and len(out_pipes) == 1,
        )

        buildings_by_id[b_id] = {
            "id": b_id,
            "name": name,
            "category": "Machine",
            "subcategory": default_category,
            "wiki_url": f"{BASE_URL}/wiki/{page_slug}",
            "icon": icon,
            "power": power_w,
            "heat": heat_kdtu,
            "inputs": inputs,
            "outputs": outputs,
            "recipes": [],
            "modifiers": [
                {
                    "id": "engie_tuneup",
                    "name": "Engie's Tune-Up (+50% Power)",
                    "power_multiplier": 1.5,
                }
            ]
            if power_w > 0
            else [],
        }

    apply_curated_overrides(buildings_by_id)
    return list(buildings_by_id.values()), discovered_elements
