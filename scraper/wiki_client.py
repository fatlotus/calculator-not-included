"""Shared MediaWiki / HTML scraping utilities for oxygennotincluded.wiki.gg."""

import hashlib
import html as html_lib
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://oxygennotincluded.wiki.gg"
USER_AGENT = "OniDataScraper/1.0 (https://github.com/oni-research; oni-contact@example.com)"
CACHE_DIR = Path("/tmp/oni_wiki_cache")


def fetch_wiki_page(page_path: str, delay: float = 0.25, use_cache: bool = True) -> str:
    """Fetch a wiki page from oxygennotincluded.wiki.gg with /tmp caching."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not page_path.startswith("/"):
        page_path = f"/wiki/{page_path}"

    cache_key = hashlib.sha1(page_path.encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.html"
    if use_cache and cache_file.exists():
        return cache_file.read_text(encoding="utf-8", errors="ignore")

    url = f"{BASE_URL}{page_path}"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.5",
    }
    for attempt in range(3):
        try:
            time.sleep(delay * (attempt + 1))
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read().decode("utf-8", errors="ignore")
                if "Maintenance - wiki.gg" in data or "Sorry, you have been blocked" in data:
                    raise RuntimeError(f"Page {page_path} returned maintenance/blocked page")
                if use_cache:
                    cache_file.write_text(data, encoding="utf-8")
                return data
        except urllib.error.HTTPError as err:
            if err.code == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"Failed to fetch {page_path}")


def clean_html_text(raw_html: str) -> str:
    """Strip HTML tags and normalize whitespace while preserving entities."""
    # Remove hidden tooltip spans so they don't pollute visible text
    cleaned = re.sub(
        r'<span[^>]*class="[^"]*advanced-tooltip--content[^"]*"[^>]*>.*?</span>',
        "",
        raw_html,
        flags=re.DOTALL,
    )
    cleaned = re.sub(r"<br\s*/?>", "\n", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = html_lib.unescape(cleaned)
    cleaned = cleaned.replace("\xa0", " ")
    lines = [" ".join(line.split()) for line in cleaned.splitlines()]
    return "\n".join(line for line in lines if line)


def normalize_icon_url(src: str | None) -> str | None:
    """Ensure icon URL is absolute to oxygennotincluded.wiki.gg and preserves ?hash."""
    if not src:
        return None
    src = html_lib.unescape(src).strip()
    if src.startswith("//"):
        return f"https:{src}"
    if src.startswith("/"):
        return f"{BASE_URL}{src}"
    return src


def extract_element_tooltips(raw_html: str) -> dict[str, dict]:
    """Extract element metadata and icons embedded in span.element-tooltip--content."""
    elements: dict[str, dict] = {}
    # Match ONI-pic-link blocks containing img and element-tooltip--content
    pattern = re.compile(
        r'<span[^>]*class="[^"]*element-tooltip[^"]*"[^>]*>(.*?)</span>\s*</span>',
        re.DOTALL,
    )
    for match in pattern.finditer(raw_html):
        block = match.group(1)
        name_m = re.search(r'data-elementname="([^"]+)"', block)
        if not name_m:
            continue
        name = html_lib.unescape(name_m.group(1)).strip()
        img_m = re.search(r'<img[^>]*src="([^"]+)"', block)
        icon = normalize_icon_url(img_m.group(1)) if img_m else None

        shc_m = re.search(r'data-specificheatcapacity="([^"]+)"', block)
        tc_m = re.search(r'data-thermalconductivity="([^"]+)"', block)
        high_m = re.search(r'data-hightemp="([^"]+)"', block)
        low_m = re.search(r'data-lowtemp="([^"]+)"', block)

        def to_float(val):
            try:
                return float(val)
            except (TypeError, ValueError):
                return None

        if name not in elements or (icon and not elements[name].get("icon")):
            elements[name] = {
                "name": name,
                "icon": icon,
                "shc": to_float(shc_m.group(1)) if shc_m else None,
                "thermal_conductivity": to_float(tc_m.group(1)) if tc_m else None,
                "high_temp": to_float(high_m.group(1)) if high_m else None,
                "low_temp": to_float(low_m.group(1)) if low_m else None,
            }
    return elements


def parse_druid_infobox(raw_html: str) -> dict:
    """Extract main image, title, tabs, and rows from a druid-infobox container."""
    idx = raw_html.find("druid-infobox")
    if idx == -1:
        return {}
    end_idx = raw_html.find("<!-- \nNewPP limit report", idx)
    if end_idx == -1:
        end_idx = len(raw_html)
    box_html = raw_html[idx:end_idx]

    title_m = re.search(r'<div class="druid-title"[^>]*>(.*?)</div>', box_html, re.DOTALL)
    title = clean_html_text(title_m.group(1)) if title_m else ""

    # Main image or tabbed images
    img_m = re.search(
        r'<div class="druid-main-image[^"]*"[^>]*>.*?<img[^>]*src="([^"]+)"',
        box_html,
        re.DOTALL,
    )
    icon = normalize_icon_url(img_m.group(1)) if img_m else None

    # Tabbed images & labels (used on Critter pages for morphs)
    tabs = {}
    for tab_m in re.finditer(
        r'<div class="druid-main-images-label[^"]*"[^>]*data-druid="([^"]+)"[^>]*>(.*?)</div>',
        box_html,
        re.DOTALL,
    ):
        tabs[tab_m.group(1)] = clean_html_text(tab_m.group(2))

    tab_icons = {}
    for timg_m in re.finditer(
        r'<div class="druid-main-images-file[^"]*"[^>]*data-druid="([^"]+)"[^>]*>.*?<img[^>]*src="([^"]+)"',
        box_html,
        re.DOTALL,
    ):
        tab_icons[timg_m.group(1)] = normalize_icon_url(timg_m.group(2))

    # Extract druid rows
    rows = {}
    row_html_map = {}
    row_pattern = re.compile(
        r'<div class="druid-row druid-row-([^"\s]+)[^"]*"[^>]*>(.*?)(?=<div class="druid-row |<div class="druid-section-header|</div>\s*</div>\s*</div>)',
        re.DOTALL,
    )
    for rm in row_pattern.finditer(box_html):
        row_key = rm.group(1)
        row_inner = rm.group(2)
        row_html_map[row_key] = row_inner
        data_m = re.search(
            r'<div class="druid-data[^"]*"[^>]*>(.*)',
            row_inner,
            re.DOTALL,
        )
        content_html = data_m.group(1) if data_m else row_inner
        rows[row_key] = clean_html_text(content_html)

    return {
        "title": title,
        "icon": icon,
        "tabs": tabs,
        "tab_icons": tab_icons,
        "rows": rows,
        "row_html": row_html_map,
        "box_html": box_html,
    }
