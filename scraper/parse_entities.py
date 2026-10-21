"""Scrape ONI Plants, Critters, Duplicants, and Geysers from oxygennotincluded.wiki.gg."""

import html as html_lib
import re
from scraper.wiki_client import (
    BASE_URL,
    clean_html_text,
    extract_element_tooltips,
    fetch_wiki_page,
    normalize_icon_url,
    parse_druid_infobox,
)


def parse_mass_rate_g_s(text: str, cycles: float = 1.0) -> tuple[str | None, float]:
    """Parse strings like '35 kg Polluted Water' or '10 kg Dirt' per cycle into (resource, g/s)."""
    if not text or text.strip() in ("-", "—", "None", ""):
        return None, 0.0
    m = re.search(r"(\d+(?:,\d+)*(?:\.\d+)?)\s*(kg|g|mg)\s+(.+)", text.strip(), re.IGNORECASE)
    if not m:
        return None, 0.0
    val = float(m.group(1).replace(",", ""))
    unit = m.group(2).lower()
    res = m.group(3).strip()
    if unit == "kg":
        val *= 1000.0
    elif unit == "mg":
        val /= 1000.0
    # Convert per-cycle (600s * cycles) to g/s
    rate_g_s = val / (600.0 * max(cycles, 1e-6))
    return res, round(rate_g_s, 4)


def scrape_plants() -> tuple[list[dict], dict[str, dict]]:
    """Scrape all plants from /wiki/Plant master filtertable plus special gas-converting plants."""
    raw_html = fetch_wiki_page("Plant", delay=0.2)
    discovered_elements = extract_element_tooltips(raw_html)
    plants = []

    table_m = re.search(
        r'<table[^>]*class="[^"]*oni-filtertable[^"]*"[^>]*>(.*?)</table>',
        raw_html,
        re.DOTALL,
    )
    if table_m:
        tbody = table_m.group(1)
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tbody, re.DOTALL)
        for row_html in rows:
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.DOTALL)
            if len(cells) < 18:
                continue
            name_text = clean_html_text(cells[0])
            if not name_text or name_text in ("Plant", "#"):
                continue

            link_m = re.search(r'href="/wiki/([^"]+)"', cells[0])
            slug = link_m.group(1) if link_m else name_text.replace(" ", "_")
            img_m = re.search(r'<img[^>]*src="([^"]+)"', cells[0])
            icon = normalize_icon_url(img_m.group(1)) if img_m else None

            irrig_text = clean_html_text(cells[11]).replace("\n", " ")
            fert_text = clean_html_text(cells[12]).replace("\n", " ")
            product_text = clean_html_text(cells[13]).replace("\n", " ")
            dom_cycles_text = clean_html_text(cells[14])
            dom_kcal_text = clean_html_text(cells[16]) if len(cells) > 16 else ""

            try:
                dom_cycles = float(re.search(r"\d+(?:\.\d+)?", dom_cycles_text).group(0))
            except Exception:
                dom_cycles = 0.0

            inputs = []
            irrig_res, irrig_rate = parse_mass_rate_g_s(irrig_text, cycles=1.0)
            if irrig_res and irrig_rate > 0:
                inputs.append({
                    "resource": irrig_res,
                    "rate": irrig_rate,
                    "unit": "g/s",
                    "state": "in a pipe",
                    "temp": None,
                    "category": "irrigation",
                })

            fert_res, fert_rate = parse_mass_rate_g_s(fert_text, cycles=1.0)
            if fert_res and fert_rate > 0:
                inputs.append({
                    "resource": fert_res,
                    "rate": fert_rate,
                    "unit": "g/s",
                    "state": "free",
                    "temp": None,
                    "category": "fertilizer",
                })

            outputs = []
            # Parse product if mass or units or kcal
            if product_text and product_text not in ("-", "—") and dom_cycles > 0:
                prod_m = re.search(r"(\d+(?:,\d+)*(?:\.\d+)?)\s*(kg|g)?\s*(.+)", product_text)
                if prod_m:
                    qty = float(prod_m.group(1).replace(",", ""))
                    unit_str = (prod_m.group(2) or "").lower()
                    prod_name = prod_m.group(3).strip()
                    if unit_str == "kg":
                        rate_g_s = (qty * 1000.0) / (dom_cycles * 600.0)
                        outputs.append({
                            "resource": prod_name,
                            "rate": round(rate_g_s, 4),
                            "unit": "g/s",
                            "state": "free",
                            "temp": None,
                        })
                    elif unit_str == "g":
                        rate_g_s = qty / (dom_cycles * 600.0)
                        outputs.append({
                            "resource": prod_name,
                            "rate": round(rate_g_s, 4),
                            "unit": "g/s",
                            "state": "free",
                            "temp": None,
                        })
                    else:
                        # Unit count per harvest (e.g. '1 Meal Lice' or '1 Reed Fiber')
                        rate_per_s = (qty * 1000.0) / (dom_cycles * 600.0)
                        outputs.append({
                            "resource": prod_name,
                            "rate": round(rate_per_s, 4),
                            "unit": "g/s",
                            "state": "free",
                            "temp": None,
                        })

            if dom_kcal_text and dom_kcal_text not in ("-", "—", "0"):
                try:
                    kcal_per_cycle = float(re.search(r"\d+(?:\.\d+)?", dom_kcal_text.replace(",", "")).group(0))
                    if kcal_per_cycle > 0:
                        outputs.append({
                            "resource": "Calories",
                            "rate": round(kcal_per_cycle / 600.0, 4),
                            "unit": "kcal/s",
                            "state": "free",
                            "temp": None,
                        })
                except Exception:
                    pass

            p_id = f"plant_{slug.lower().replace('-', '_').replace('(', '').replace(')', '')}"
            plants.append({
                "id": p_id,
                "name": name_text,
                "category": "Plant",
                "subcategory": "Crop",
                "wiki_url": f"{BASE_URL}/wiki/{slug}",
                "icon": icon,
                "power": 0.0,
                "heat": 0.0,
                "inputs": inputs,
                "outputs": outputs,
                "recipes": [],
                "modifiers": [
                    {
                        "id": "wild",
                        "name": "Wild Grown (0 Input, 25% Yield)",
                        "input_multiplier": 0.0,
                        "output_multiplier": 0.25,
                    },
                    {
                        "id": "farmers_touch",
                        "name": "Farmer's Touch (+100% Growth Speed)",
                        "output_multiplier": 2.0,
                    },
                    {
                        "id": "grubgrub_rub",
                        "name": "Grubgrub Rub (+50% Growth Speed)",
                        "output_multiplier": 1.5,
                    },
                ],
            })

    # Enrich special utility plants (Oxyfern, Dasha Saltvine, Arbor Tree, Wheezewort)
    plants_by_id = {p["id"]: p for p in plants}
    if "plant_oxyfern" in plants_by_id:
        of = plants_by_id["plant_oxyfern"]
        of["inputs"] = [
            {"resource": "Water", "rate": 31.67, "unit": "g/s", "state": "in a pipe", "temp": None},
            {"resource": "Dirt", "rate": 6.67, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Carbon Dioxide", "rate": 0.625, "unit": "g/s", "state": "free", "temp": None},
        ]
        of["outputs"] = [
            {"resource": "Oxygen", "rate": 31.25, "unit": "g/s", "state": "free", "temp": None},
        ]
    if "plant_dasha_saltvine" in plants_by_id:
        sv = plants_by_id["plant_dasha_saltvine"]
        sv["inputs"] = [
            {"resource": "Sand", "rate": 11.67, "unit": "g/s", "state": "free", "temp": None},
            {"resource": "Chlorine", "rate": 6.0, "unit": "g/s", "state": "free", "temp": None},
        ]
        sv["outputs"] = [
            {"resource": "Salt", "rate": 18.06, "unit": "g/s", "state": "free", "temp": None},
        ]
    if "plant_arbor_tree" in plants_by_id:
        at = plants_by_id["plant_arbor_tree"]
        # 5 branches x 300 kg Wood / 4.5 cycles = 1500 kg / 2700 s = 555.56 g/s Wood
        at["inputs"] = [
            {"resource": "Polluted Water", "rate": 116.67, "unit": "g/s", "state": "in a pipe", "temp": None},
            {"resource": "Dirt", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None},
        ]
        at["outputs"] = [
            {"resource": "Wood", "rate": 555.56, "unit": "g/s", "state": "free", "temp": None},
        ]
    if "plant_wheezewort" in plants_by_id:
        ww = plants_by_id["plant_wheezewort"]
        ww["inputs"] = [
            {"resource": "Phosphorite", "rate": 6.67, "unit": "g/s", "state": "free", "temp": None},
        ]
        ww["heat"] = -12.0  # -12 kDTU/s in 1 kg/s Hydrogen

    return list(plants_by_id.values()), discovered_elements


# Target Critter pages and curated morph diets verified from wiki.gg
CRITTER_PAGES = [
    "Hatch",
    "Drecko",
    "Pacu",
    "Puft",
    "Slickster",
    "Pip",
    "Pokeshell",
    "Shove_Vole",
    "Shine_Bug",
    "Sweetle",
    "Grubgrub",
    "Plug_Slug",
    "Bammoth",
    "Flox",
    "Dartle",
    "Gassy_Moo",
]


def scrape_critters() -> tuple[list[dict], dict[str, dict]]:
    """Scrape critter species and morphs from oxygennotincluded.wiki.gg."""
    discovered_elements: dict[str, dict] = {}
    critter_icons: dict[str, str] = {}

    for slug in CRITTER_PAGES:
        try:
            raw_html = fetch_wiki_page(slug, delay=0.22)
            discovered_elements.update(extract_element_tooltips(raw_html))
            info = parse_druid_infobox(raw_html)
            if info.get("icon"):
                critter_icons[slug.replace("_", " ")] = info["icon"]
            for tab_id, morph_name in info.get("tabs", {}).items():
                if tab_id in info.get("tab_icons", {}):
                    critter_icons[morph_name] = info["tab_icons"][tab_id]
        except Exception as err:
            print(f"[critters] Warning on {slug}: {err}")

    # Standard critter modifiers (Tame vs Wild, Glum, etc.)
    std_critter_modifiers = [
        {
            "id": "wild",
            "name": "Wild (25% Metabolism & Reproduction)",
            "input_multiplier": 0.25,
            "output_multiplier": 0.25,
        },
        {
            "id": "glum",
            "name": "Glum (-80% Metabolism)",
            "input_multiplier": 0.2,
            "output_multiplier": 0.2,
        },
    ]

    # Build comprehensive critter definitions with exact wiki.gg diets & icons
    critter_defs = [
        {
            "id": "critter_hatch",
            "name": "Hatch",
            "wiki_slug": "Hatch",
            "recipes": [
                {
                    "id": "sandstone",
                    "name": "Sandstone (140 kg/cycle -> 70 kg/cycle Coal)",
                    "inputs": [{"resource": "Sandstone", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "sedimentary_rock",
                    "name": "Sedimentary Rock (140 kg/cycle -> 70 kg/cycle Coal)",
                    "inputs": [{"resource": "Sedimentary Rock", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "sand",
                    "name": "Sand (140 kg/cycle -> 70 kg/cycle Coal)",
                    "inputs": [{"resource": "Sand", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_stone_hatch",
            "name": "Stone Hatch",
            "wiki_slug": "Hatch",
            "recipes": [
                {
                    "id": "igneous_rock",
                    "name": "Igneous Rock (140 kg/cycle -> 70 kg/cycle Coal)",
                    "inputs": [{"resource": "Igneous Rock", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "granite",
                    "name": "Granite (140 kg/cycle -> 70 kg/cycle Coal)",
                    "inputs": [{"resource": "Granite", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_sage_hatch",
            "name": "Sage Hatch",
            "wiki_slug": "Hatch",
            "recipes": [
                {
                    "id": "dirt",
                    "name": "Dirt (140 kg/cycle -> 140 kg/cycle Coal)",
                    "inputs": [{"resource": "Dirt", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "polluted_dirt",
                    "name": "Polluted Dirt (140 kg/cycle -> 140 kg/cycle Coal)",
                    "inputs": [{"resource": "Polluted Dirt", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Coal", "rate": 233.33, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_smooth_hatch",
            "name": "Smooth Hatch",
            "wiki_slug": "Hatch",
            "recipes": [
                {
                    "id": "iron_ore",
                    "name": "Iron Ore (100 kg/cycle -> 75 kg/cycle Iron)",
                    "inputs": [{"resource": "Iron Ore", "rate": 166.67, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Iron", "rate": 125.0, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "copper_ore",
                    "name": "Copper Ore (100 kg/cycle -> 75 kg/cycle Copper)",
                    "inputs": [{"resource": "Copper Ore", "rate": 166.67, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Copper", "rate": 125.0, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.8889, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_drecko",
            "name": "Drecko",
            "wiki_slug": "Drecko",
            "recipes": [
                {
                    "id": "balm_lily",
                    "name": "Balm Lily (0.25 plant -> 10 kg/cycle Phosphorite + Reed Fiber)",
                    "inputs": [],
                    "outputs": [
                        {"resource": "Phosphorite", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Reed Fiber", "rate": 0.4167, "unit": "g/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "mealwood",
                    "name": "Mealwood (0.75 plant -> 10 kg/cycle Phosphorite + Reed Fiber)",
                    "inputs": [{"resource": "Dirt", "rate": 12.5, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Phosphorite", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Reed Fiber", "rate": 0.4167, "unit": "g/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_glossy_drecko",
            "name": "Glossy Drecko",
            "wiki_slug": "Drecko",
            "recipes": [
                {
                    "id": "mealwood_plastic",
                    "name": "Mealwood -> 9 kg/cycle Phosphorite + 50 kg/cycle Plastic (in H2)",
                    "inputs": [{"resource": "Dirt", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Phosphorite", "rate": 15.0, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Plastic", "rate": 83.33, "unit": "g/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_pacu",
            "name": "Pacu",
            "wiki_slug": "Pacu",
            "recipes": [
                {
                    "id": "seeds",
                    "name": "Seeds (1 kg/cycle -> 0.5 kg/cycle Polluted Dirt)",
                    "inputs": [{"resource": "Seeds", "rate": 1.67, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Polluted Dirt", "rate": 0.8333, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.4444, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
                {
                    "id": "algae",
                    "name": "Algae (7.5 kg/cycle -> 3.75 kg/cycle Polluted Dirt)",
                    "inputs": [{"resource": "Algae", "rate": 12.5, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Polluted Dirt", "rate": 6.25, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Calories", "rate": 0.4444, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_slickster",
            "name": "Slickster",
            "wiki_slug": "Slickster",
            "recipes": [
                {
                    "id": "co2_oil",
                    "name": "Carbon Dioxide (20 kg/cycle -> 10 kg/cycle Crude Oil)",
                    "inputs": [{"resource": "Carbon Dioxide", "rate": 33.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Crude Oil", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_molten_slickster",
            "name": "Molten Slickster",
            "wiki_slug": "Slickster",
            "recipes": [
                {
                    "id": "co2_petroleum",
                    "name": "Carbon Dioxide (20 kg/cycle -> 10 kg/cycle Petroleum)",
                    "inputs": [{"resource": "Carbon Dioxide", "rate": 33.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Petroleum", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_puft",
            "name": "Puft",
            "wiki_slug": "Puft",
            "recipes": [
                {
                    "id": "po2_slime",
                    "name": "Polluted Oxygen (50 kg/cycle -> 47.5 kg/cycle Slime)",
                    "inputs": [{"resource": "Polluted Oxygen", "rate": 83.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Slime", "rate": 79.17, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_dense_puft",
            "name": "Dense Puft",
            "wiki_slug": "Puft",
            "recipes": [
                {
                    "id": "o2_oxylite",
                    "name": "Oxygen (50 kg/cycle -> 47.5 kg/cycle Oxylite)",
                    "inputs": [{"resource": "Oxygen", "rate": 83.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Oxylite", "rate": 79.17, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_squeaky_puft",
            "name": "Squeaky Puft",
            "wiki_slug": "Puft",
            "recipes": [
                {
                    "id": "chlorine_bleachstone",
                    "name": "Chlorine (30 kg/cycle -> 28.5 kg/cycle Bleach Stone)",
                    "inputs": [{"resource": "Chlorine", "rate": 50.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Bleach Stone", "rate": 47.5, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_pip",
            "name": "Pip",
            "wiki_slug": "Pip",
            "recipes": [
                {
                    "id": "arbor_tree",
                    "name": "Arbor Tree Branch -> 20 kg/cycle Dirt",
                    "inputs": [{"resource": "Wood", "rate": 58.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Dirt", "rate": 33.33, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_pokeshell",
            "name": "Pokeshell",
            "wiki_slug": "Pokeshell",
            "recipes": [
                {
                    "id": "polluted_dirt_sand",
                    "name": "Polluted Dirt (70 kg/cycle -> 35 kg/cycle Sand)",
                    "inputs": [{"resource": "Polluted Dirt", "rate": 116.67, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Sand", "rate": 58.33, "unit": "g/s", "state": "free", "temp": None},
                        {"resource": "Lime", "rate": 2.78, "unit": "g/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_shove_vole",
            "name": "Shove Vole",
            "wiki_slug": "Shove_Vole",
            "recipes": [
                {
                    "id": "regolith",
                    "name": "Regolith (4800 kg/cycle -> 2400 kg/cycle Regolith + Meat)",
                    "inputs": [{"resource": "Regolith", "rate": 8000.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [
                        {"resource": "Calories", "rate": 4.4444, "unit": "kcal/s", "state": "free", "temp": None},
                    ],
                },
            ],
        },
        {
            "id": "critter_sweetle",
            "name": "Sweetle",
            "wiki_slug": "Sweetle",
            "recipes": [
                {
                    "id": "sulfur_sucrose",
                    "name": "Sulfur (20 kg/cycle -> 10 kg/cycle Sucrose)",
                    "inputs": [{"resource": "Sulfur", "rate": 33.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Sucrose", "rate": 16.67, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_grubgrub",
            "name": "Grubgrub",
            "wiki_slug": "Grubgrub",
            "recipes": [
                {
                    "id": "sulfur_mud",
                    "name": "Sulfur (50 kg/cycle -> 50 kg/cycle Mud)",
                    "inputs": [{"resource": "Sulfur", "rate": 83.33, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Mud", "rate": 83.33, "unit": "g/s", "state": "free", "temp": None}],
                },
            ],
        },
        {
            "id": "critter_plug_slug",
            "name": "Plug Slug",
            "wiki_slug": "Plug_Slug",
            "recipes": [
                {
                    "id": "metal_ore_hydrogen",
                    "name": "Metal Ore (60 kg/cycle -> 3 kg/cycle Hydrogen + 200 W avg Power)",
                    "inputs": [{"resource": "Iron Ore", "rate": 100.0, "unit": "g/s", "state": "free", "temp": None}],
                    "outputs": [{"resource": "Hydrogen", "rate": 5.0, "unit": "g/s", "state": "free", "temp": None}],
                    "power": 200.0,
                    "heat": 0.0,
                },
            ],
        },
    ]

    critters = []
    for cd in critter_defs:
        c_name = cd["name"]
        slug = cd["wiki_slug"]
        icon = critter_icons.get(c_name) or critter_icons.get(slug.replace("_", " "))
        r0 = cd["recipes"][0]
        critters.append({
            "id": cd["id"],
            "name": c_name,
            "category": "Critter",
            "subcategory": slug.replace("_", " "),
            "wiki_url": f"{BASE_URL}/wiki/{slug}",
            "icon": icon,
            "power": r0.get("power", 0.0),
            "heat": r0.get("heat", 0.0),
            "inputs": r0["inputs"],
            "outputs": r0["outputs"],
            "recipes": cd["recipes"],
            "modifiers": std_critter_modifiers,
        })

    return critters, discovered_elements


def scrape_duplicants() -> tuple[list[dict], dict[str, dict]]:
    """Scrape Duplicant & Bionic Duplicant pages from oxygennotincluded.wiki.gg."""
    discovered_elements: dict[str, dict] = {}
    dupe_icon = None
    bionic_icon = None
    try:
        dupe_html = fetch_wiki_page("Duplicant", delay=0.2)
        discovered_elements.update(extract_element_tooltips(dupe_html))
        img_m = re.search(r'<meta property="og:image" content="([^"]+)"', dupe_html)
        if img_m:
            dupe_icon = normalize_icon_url(img_m.group(1))
    except Exception:
        pass

    try:
        bionic_html = fetch_wiki_page("Bionic_Duplicant", delay=0.2)
        discovered_elements.update(extract_element_tooltips(bionic_html))
        img_m = re.search(r'<meta property="og:image" content="([^"]+)"', bionic_html)
        if img_m:
            bionic_icon = normalize_icon_url(img_m.group(1))
    except Exception:
        pass

    duplicants = [
        {
            "id": "duplicant",
            "name": "Duplicant",
            "category": "Duplicant",
            "subcategory": "Standard",
            "wiki_url": f"{BASE_URL}/wiki/Duplicant",
            "icon": dupe_icon,
            "power": 0.0,
            "heat": 0.0,
            # Default matches PDF Hydra SPOM example: Oxygen -100 g/s, with optional checkboxes for CO2, Calories, Lavatory, Outhouse, Diver's Lungs, etc.
            "inputs": [
                {"resource": "Oxygen", "rate": 100.0, "unit": "g/s", "state": "free", "temp": None},
            ],
            "outputs": [],
            "recipes": [],
            "modifiers": [
                {
                    "id": "divers_lungs",
                    "name": "Diver's Lungs (-25% Oxygen)",
                    "input_multipliers": {"Oxygen": 0.75},
                    "output_multipliers": {"Carbon Dioxide": 0.75},
                },
                {
                    "id": "deep_divers_lungs",
                    "name": "Deep Diver's Lungs (-50% Oxygen)",
                    "input_multipliers": {"Oxygen": 0.50},
                    "output_multipliers": {"Carbon Dioxide": 0.50},
                },
                {
                    "id": "mouth_breather",
                    "name": "Mouth Breather (+100% Oxygen)",
                    "input_multipliers": {"Oxygen": 2.0},
                    "output_multipliers": {"Carbon Dioxide": 2.0},
                },
                {
                    "id": "exhale_co2",
                    "name": "Include Exhaled CO2 (+2 g/s)",
                    "extra_outputs": [
                        {"resource": "Carbon Dioxide", "rate": 2.0, "unit": "g/s", "state": "free", "temp": "@ 37 °C"}
                    ],
                },
                {
                    "id": "calories",
                    "name": "Include Food (-1000 kcal/cycle)",
                    "extra_inputs": [
                        {"resource": "Calories", "rate": 1.6667, "unit": "kcal/s", "state": "free", "temp": None}
                    ],
                },
                {
                    "id": "bottomless_stomach",
                    "name": "Bottomless Stomach (-500 kcal/cycle)",
                    "extra_inputs": [
                        {"resource": "Calories", "rate": 0.8333, "unit": "kcal/s", "state": "free", "temp": None}
                    ],
                },
                {
                    "id": "lavatory",
                    "name": "Lavatory Use (1x/cycle: -5 kg Water -> +11.7 kg Polluted Water)",
                    "extra_inputs": [
                        {"resource": "Water", "rate": 8.3333, "unit": "g/s", "state": "in a pipe", "temp": None}
                    ],
                    "extra_outputs": [
                        {"resource": "Polluted Water", "rate": 19.5, "unit": "g/s", "state": "in a pipe", "temp": "@ 37 °C"}
                    ],
                },
                {
                    "id": "outhouse",
                    "name": "Outhouse Use (1x/cycle: -13 kg Dirt -> +19.7 kg Polluted Dirt)",
                    "extra_inputs": [
                        {"resource": "Dirt", "rate": 21.6667, "unit": "g/s", "state": "free", "temp": None}
                    ],
                    "extra_outputs": [
                        {"resource": "Polluted Dirt", "rate": 32.8333, "unit": "g/s", "state": "free", "temp": "@ 37 °C"}
                    ],
                },
                {
                    "id": "flatulent",
                    "name": "Flatulent (+5 g/s Natural Gas avg)",
                    "extra_outputs": [
                        {"resource": "Natural Gas", "rate": 5.0, "unit": "g/s", "state": "free", "temp": "@ 37 °C"}
                    ],
                },
            ],
        },
        {
            "id": "bionic_duplicant",
            "name": "Bionic Duplicant",
            "category": "Duplicant",
            "subcategory": "Bionic",
            "wiki_url": f"{BASE_URL}/wiki/Bionic_Duplicant",
            "icon": bionic_icon or dupe_icon,
            "power": -240.0,  # 1 Power Bank (120 kJ) per cycle via charger at 240 W
            "heat": 0.0,
            "inputs": [
                {"resource": "Oxygen", "rate": 100.0, "unit": "g/s", "state": "free", "temp": None},
                {"resource": "Crude Oil", "rate": 33.33, "unit": "g/s", "state": "in a pipe", "temp": None},
            ],
            "outputs": [
                {"resource": "Gunk", "rate": 33.33, "unit": "g/s", "state": "in a pipe", "temp": "@ 37 °C"},
            ],
            "recipes": [],
            "modifiers": [
                {
                    "id": "yucky_lungs",
                    "name": "Yucky Lungs (+30% Oxygen)",
                    "input_multipliers": {"Oxygen": 1.3},
                }
            ],
        },
    ]

    return duplicants, discovered_elements


def scrape_geysers() -> tuple[list[dict], dict[str, dict]]:
    """Scrape all Geysers/Vents/Volcanoes from /wiki/Geyser."""
    raw_html = fetch_wiki_page("Geyser", delay=0.2)
    discovered_elements = extract_element_tooltips(raw_html)
    geysers = []

    table_m = re.search(
        r'<table[^>]*class="[^"]*geysertable[^"]*"[^>]*>(.*?)</table>',
        raw_html,
        re.DOTALL,
    )
    if table_m:
        tbody = table_m.group(1)
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tbody, re.DOTALL)
        for row_html in rows:
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.DOTALL)
            if len(cells) < 6:
                continue
            name_text = clean_html_text(cells[0]).replace("\n", " ")
            elem_text = clean_html_text(cells[1]).replace("\n", " ")
            temp_text = clean_html_text(cells[2]).replace("\n", " ")
            active_yield_text = clean_html_text(cells[4]).replace("\n", " ")
            lifetime_yield_text = clean_html_text(cells[5]).replace("\n", " ")

            img_m = re.search(r'<img[^>]*src="([^"]+)"', cells[0])
            icon = normalize_icon_url(img_m.group(1)) if img_m else None

            # Parse average lifetime yield in kg/cycle (e.g. '1800 (±1200)')
            life_m = re.search(r"(\d+(?:\.\d+)?)", lifetime_yield_text.replace(",", ""))
            active_m = re.search(r"(\d+(?:\.\d+)?)", active_yield_text.replace(",", ""))
            if not life_m or not elem_text:
                continue

            life_kg_cycle = float(life_m.group(1))
            active_kg_cycle = float(active_m.group(1)) if active_m else life_kg_cycle

            life_g_s = round((life_kg_cycle * 1000.0) / 600.0, 2)
            active_g_s = round((active_kg_cycle * 1000.0) / 600.0, 2)

            temp_c_m = re.search(r"(-?\d+(?:\.\d+)?)\s*°C", temp_text)
            temp_note = f"@ {temp_c_m.group(1)} °C" if temp_c_m else None

            g_id = f"geyser_{name_text.lower().replace(' ', '_').replace('-', '_')}"
            geysers.append({
                "id": g_id,
                "name": name_text,
                "category": "Geyser",
                "subcategory": "Vent / Volcano",
                "wiki_url": f"{BASE_URL}/wiki/Geyser",
                "icon": icon,
                "power": 0.0,
                "heat": 0.0,
                "inputs": [],
                "outputs": [
                    {
                        "resource": elem_text,
                        "rate": life_g_s,
                        "unit": "g/s",
                        "state": "free",
                        "temp": temp_note,
                    }
                ],
                "recipes": [
                    {
                        "id": "lifetime_avg",
                        "name": f"Average Lifetime Yield ({life_kg_cycle:g} kg/cycle = {life_g_s:g} g/s)",
                        "inputs": [],
                        "outputs": [
                            {"resource": elem_text, "rate": life_g_s, "unit": "g/s", "state": "free", "temp": temp_note}
                        ],
                    },
                    {
                        "id": "active_avg",
                        "name": f"Average Active Period ({active_kg_cycle:g} kg/cycle = {active_g_s:g} g/s)",
                        "inputs": [],
                        "outputs": [
                            {"resource": elem_text, "rate": active_g_s, "unit": "g/s", "state": "free", "temp": temp_note}
                        ],
                    },
                ],
                "modifiers": [
                    {
                        "id": "geotuned_1",
                        "name": "1x Geotuner (+20% Output, +20 °C)",
                        "output_multiplier": 1.2,
                    },
                    {
                        "id": "geotuned_5",
                        "name": "5x Geotuners (+100% Output, +100 °C)",
                        "output_multiplier": 2.0,
                    },
                ],
            })

    return geysers, discovered_elements
