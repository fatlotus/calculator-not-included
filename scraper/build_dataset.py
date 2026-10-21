"""Orchestrate ONI wiki scraping and generate JSON datasets under data/ and src/data.js."""

import json
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scraper.parse_buildings import scrape_buildings
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

    print("1/5 Scraping Buildings...")
    buildings, b_elems = scrape_buildings()
    elements.update(b_elems)

    print("2/5 Scraping Plants...")
    plants, p_elems = scrape_plants()
    elements.update(p_elems)

    print("3/5 Scraping Critters...")
    critters, c_elems = scrape_critters()
    elements.update(c_elems)

    print("4/5 Scraping Duplicants...")
    duplicants, d_elems = scrape_duplicants()
    elements.update(d_elems)

    print("5/5 Scraping Geysers...")
    geysers, g_elems = scrape_geysers()
    elements.update(g_elems)

    # Save individual JSON files in data/
    (DATA_DIR / "buildings.json").write_text(json.dumps(buildings, indent=2), encoding="utf-8")
    (DATA_DIR / "plants.json").write_text(json.dumps(plants, indent=2), encoding="utf-8")
    (DATA_DIR / "critters.json").write_text(json.dumps(critters, indent=2), encoding="utf-8")
    (DATA_DIR / "duplicants.json").write_text(json.dumps(duplicants, indent=2), encoding="utf-8")
    (DATA_DIR / "geysers.json").write_text(json.dumps(geysers, indent=2), encoding="utf-8")
    (DATA_DIR / "elements.json").write_text(
        json.dumps(list(elements.values()), indent=2), encoding="utf-8"
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

    # Also emit an ES module src/dataset.js so index.html works both over HTTP and file://
    js_path = ROOT_DIR / "src" / "dataset.js"
    js_path.write_text(
        "// Auto-generated from oxygennotincluded.wiki.gg scraper\n"
        f"export const ONI_DATASET = {json.dumps(combined, indent=2)};\n",
        encoding="utf-8",
    )

    print(
        f"Done! Scraped {len(buildings)} buildings, {len(plants)} plants, "
        f"{len(critters)} critters, {len(duplicants)} duplicants, "
        f"{len(geysers)} geysers, and {len(elements)} elements."
    )
    return combined


if __name__ == "__main__":
    build_all()
