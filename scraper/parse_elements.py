"""Parser for ONI element modules: /wiki/Module:Data/gas, liquid, and solid."""

import hashlib
import html as html_lib
import json
from pathlib import Path
import re

from scraper.download_icons import clean_icon_filename
from scraper.wiki_client import fetch_wiki_page, normalize_icon_url

ROOT_DIR = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT_DIR / "images" / "icons"

# Explicit canonical name overrides
CANONICAL_OVERRIDES = {
    "DirtyWater": "Polluted Water",
    "ContaminatedOxygen": "Polluted Oxygen",
    "SaltWater": "Salt Water",
    "Hydrogen": "Hydrogen",
    "ChlorineGas": "Chlorine",
    "Methane": "Natural Gas",
    "Fallout": "Nuclear Fallout",
}


def build_wiki_element_lookups() -> tuple[dict[str, str], dict[str, str]]:
    """Extract authoritative data-elementid -> data-elementname and icon mappings from element wiki pages."""
    id_to_name: dict[str, str] = dict(CANONICAL_OVERRIDES)
    id_to_icon_url: dict[str, str] = {}

    for page_name in ["Gas", "Liquid", "Solid", "Geyser"]:
        try:
            content = fetch_wiki_page(page_name, delay=0.1)
        except Exception:
            continue

        # Extract tooltips
        pattern = re.compile(
            r'<span[^>]*class="[^"]*element-tooltip[^"]*"[^>]*>(.*?)</span>\s*</span>',
            re.DOTALL,
        )
        for m in pattern.finditer(content):
            block = m.group(1)
            eid_m = re.search(r'data-elementid="([^"]+)"', block)
            ename_m = re.search(r'data-elementname="([^"]+)"', block)
            img_m = re.search(r'<img[^>]*src="([^"]+)"', block)

            if eid_m:
                eid = eid_m.group(1)
                if ename_m and eid not in CANONICAL_OVERRIDES:
                    id_to_name[eid] = html_lib.unescape(ename_m.group(1)).strip()
                if img_m and eid not in id_to_icon_url:
                    id_to_icon_url[eid] = normalize_icon_url(img_m.group(1))

        # Also direct attribute search in case tooltip regex missed nested markup
        for ename, eid in re.findall(
            r'data-elementname="([^"]+)"[^>]*data-elementid="([^"]+)"', content
        ):
            if eid not in CANONICAL_OVERRIDES and eid not in id_to_name:
                id_to_name[eid] = html_lib.unescape(ename).strip()

    return id_to_name, id_to_icon_url


def parse_lua_element_module(
    module_name: str,
    state: str,
    id_to_name: dict[str, str],
    id_to_icon_url: dict[str, str],
) -> list[dict]:
    """Parse a single Lua element module (gas, liquid, or solid)."""
    raw_html = fetch_wiki_page(f"Module:Data/{module_name}", delay=0.1)

    # Extract Lua code block
    m = re.search(
        r'<div[^>]*class="[^"]*mw-highlight[^"]*"[^>]*>(.*?)</div>',
        raw_html,
        re.DOTALL,
    )
    if not m:
        m = re.search(r'<pre[^>]*>(.*?)</pre>', raw_html, re.DOTALL)
    if not m:
        raise ValueError(f"Could not find code block in Module:Data/{module_name}")

    lua_code = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(1)))

    # Parse each element entry: { elementId = "...", ... }
    entries = re.findall(
        r'\{\s*elementId\s*=\s*"([^"]+)"(.*?)\n\s*\}',
        lua_code,
        re.DOTALL,
    )

    elements = []
    for eid, body in entries:
        shc_m = re.search(r"specificHeatCapacity\s*=\s*([0-9.]+)", body)
        tc_m = re.search(r"thermalConductivity\s*=\s*([0-9.]+)", body)
        low_m = re.search(r"lowTemp\s*=\s*([0-9.]+)", body)
        high_m = re.search(r"highTemp\s*=\s*([0-9.]+)", body)
        def_m = re.search(r"defaultTemperature\s*=\s*([0-9.]+)", body)

        shc = float(shc_m.group(1)) if shc_m else None
        tc = float(tc_m.group(1)) if tc_m else None

        # Convert Kelvin to Celsius
        low_c = round(float(low_m.group(1)) - 273.15, 2) if low_m else None
        high_c = round(float(high_m.group(1)) - 273.15, 2) if high_m else None
        def_c = round(float(def_m.group(1)) - 273.15, 2) if def_m else None

        # Calculate in-phase default_temp
        in_phase_20 = (low_c is None or low_c < 20.0) and (high_c is None or high_c > 20.0)
        if in_phase_20:
            default_temp = 20.0
        elif (
            def_c is not None
            and (low_c is None or low_c < def_c)
            and (high_c is None or high_c > def_c)
        ):
            default_temp = def_c
        elif low_c is not None and high_c is not None:
            default_temp = round((low_c + high_c) / 2.0, 2)
        elif low_c is not None:
            default_temp = round(low_c + 15.0, 2)
        elif high_c is not None:
            default_temp = round(high_c - 15.0, 2)
        else:
            default_temp = 20.0

        # Human name
        if eid in id_to_name:
            name = id_to_name[eid]
        else:
            name = re.sub(r"([a-z])([A-Z])", r"\1 \2", eid).strip()

        # Icon resolution
        orig_icon_url = id_to_icon_url.get(eid)
        icon_path = None
        if orig_icon_url:
            clean_name = clean_icon_filename(orig_icon_url)
            local_file = ICONS_DIR / clean_name
            if local_file.exists() and local_file.stat().st_size > 0:
                icon_path = f"images/icons/{clean_name}"
        else:
            # Check by canonical name on disk
            candidate_name = f"{name.replace(' ', '_')}.png"
            local_file = ICONS_DIR / candidate_name
            if local_file.exists() and local_file.stat().st_size > 0:
                icon_path = f"images/icons/{candidate_name}"

        elem_obj = {
            "name": name,
            "element_id": eid,
            "state": state,
            "shc": shc,
            "thermal_conductivity": tc,
            "low_temp": low_c,
            "high_temp": high_c,
            "default_temp": default_temp,
            "icon": icon_path,
        }
        if orig_icon_url:
            elem_obj["original_icon_url"] = orig_icon_url

        elements.append(elem_obj)

    return elements


def scrape_all_elements() -> tuple[list[dict], dict[str, dict]]:
    """Scrape and merge gas, liquid, and solid elements."""
    id_to_name, id_to_icon_url = build_wiki_element_lookups()

    gases = parse_lua_element_module("gas", "Gas", id_to_name, id_to_icon_url)
    liquids = parse_lua_element_module("liquid", "Liquid", id_to_name, id_to_icon_url)
    solids = parse_lua_element_module("solid", "Solid", id_to_name, id_to_icon_url)

    all_elements = gases + liquids + solids

    # Build dictionary keyed by canonical name
    elements_by_name: dict[str, dict] = {}
    for elem in all_elements:
        elements_by_name[elem["name"]] = elem

    # Alias canonical gas names if needed so lookups for "Hydrogen Gas" or "Chlorine Gas" work
    if "Hydrogen" in elements_by_name and "Hydrogen Gas" not in elements_by_name:
        h_copy = dict(elements_by_name["Hydrogen"])
        h_copy["name"] = "Hydrogen Gas"
        elements_by_name["Hydrogen Gas"] = h_copy
    if "Chlorine" in elements_by_name and "Chlorine Gas" not in elements_by_name:
        c_copy = dict(elements_by_name["Chlorine"])
        c_copy["name"] = "Chlorine Gas"
        elements_by_name["Chlorine Gas"] = c_copy

    return all_elements, elements_by_name
