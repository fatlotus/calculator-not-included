"""Orchestrate ONI wiki scraping and generate JSON datasets under data/ and src/dataset.js."""

import json
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scraper.download_icons import download_all_icons, update_data_files
from scraper.parse_buildings import scrape_buildings
from scraper.parse_elements import scrape_all_elements
from scraper.parse_entities import (
    scrape_critters,
    scrape_duplicants,
    scrape_geysers,
    scrape_plants,
)

DATA_DIR = ROOT_DIR / "data"


def build_all() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    elements: dict[str, dict] = {}

    print("1/6 Scraping Elements (Gas, Liquid, Solid)...")
    all_elements, elem_map = scrape_all_elements()
    elements.update(elem_map)

    print("2/6 Scraping Buildings...")
    buildings, b_elems = scrape_buildings()
    for k, v in b_elems.items():
        if k not in elements:
            elements[k] = v

    print("3/6 Scraping Plants...")
    plants, p_elems = scrape_plants()
    for k, v in p_elems.items():
        if k not in elements:
            elements[k] = v

    print("4/6 Scraping Critters...")
    critters, c_elems = scrape_critters()
    for k, v in c_elems.items():
        if k not in elements:
            elements[k] = v

    print("5/6 Scraping Duplicants...")
    duplicants, d_elems = scrape_duplicants()
    for k, v in d_elems.items():
        if k not in elements:
            elements[k] = v

    print("6/6 Scraping Geysers...")
    geysers, g_elems = scrape_geysers()
    for k, v in g_elems.items():
        if k not in elements:
            elements[k] = v

    # Save individual JSON files in data/
    (DATA_DIR / "buildings.json").write_text(json.dumps(buildings, indent=2), encoding="utf-8")
    (DATA_DIR / "plants.json").write_text(json.dumps(plants, indent=2), encoding="utf-8")
    (DATA_DIR / "critters.json").write_text(json.dumps(critters, indent=2), encoding="utf-8")
    (DATA_DIR / "duplicants.json").write_text(json.dumps(duplicants, indent=2), encoding="utf-8")
    (DATA_DIR / "geysers.json").write_text(json.dumps(geysers, indent=2), encoding="utf-8")
    (DATA_DIR / "elements.json").write_text(
        json.dumps(all_elements, indent=2), encoding="utf-8"
    )

    combined = {
        "buildings": buildings,
        "plants": plants,
        "critters": critters,
        "duplicants": duplicants,
        "geysers": geysers,
        "elements": elements,
    }
    (DATA_DIR / "dataset.json").write_text(json.dumps(combined, indent=2), encoding="utf-8")

    # Localize icon paths and regenerate src/dataset.js
    update_data_files()

    print(
        f"Done! Scraped {len(buildings)} buildings, {len(plants)} plants, "
        f"{len(critters)} critters, {len(duplicants)} duplicants, "
        f"{len(geysers)} geysers, and {len(all_elements)} elements."
    )
    return combined


if __name__ == "__main__":
    build_all()
