"""Download and localize ONI wiki icon images for onimath.

Scans data/*.json for icon URLs from oxygennotincluded.wiki.gg, downloads each unique
icon locally into images/icons/<clean_filename>.png, updates "icon" fields in all JSON files
to local relative paths (preserving "original_icon_url"), and regenerates src/dataset.js.
"""

import json
from pathlib import Path
import re
import sys
import time
import urllib.error
from urllib.parse import unquote, urlparse
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
ICONS_DIR = ROOT_DIR / "images" / "icons"
SRC_DIR = ROOT_DIR / "src"

USER_AGENT = "OniDataScraper/1.0 (https://github.com/oni-research; oni-contact@example.com)"
DELAY_SECONDS = 0.15

DATA_FILES = [
    "buildings.json",
    "plants.json",
    "critters.json",
    "duplicants.json",
    "geysers.json",
    "elements.json",
    "dataset.json",
]


def clean_icon_filename(url_or_path: str) -> str:
    """Derive clean local filename from an icon URL or path."""
    parsed = urlparse(url_or_path)
    path = unquote(parsed.path)
    base = path.split("/")[-1]
    # Strip MediaWiki thumbnail size prefixes like "24px-", "130px-", etc.
    cleaned = re.sub(r"^\d+px-", "", base)
    if not cleaned.endswith(".png"):
        cleaned = re.sub(r"\.[a-zA-Z0-9]+$", ".png", cleaned)
    return cleaned


def get_candidate_urls(url: str) -> list[str]:
    """Generate candidate download URLs for an icon in case of CDN misses or thumbnail 502s."""
    candidates = [url]
    parsed = urlparse(url)
    path = parsed.path
    query = f"?{parsed.query}" if parsed.query else ""

    # Check if URL is a thumbnail: /images/thumb/<file>/<size>px-<file>
    thumb_match = re.match(r"^/images/thumb/([^/]+)/(\d+)px-([^/]+)$", path)
    if thumb_match:
        base_name, size_str, file_name = thumb_match.groups()
        size = int(size_str)
        # Direct full image URL
        candidates.append(f"https://oxygennotincluded.wiki.gg/images/{base_name}{query}")
        # Standard alternative thumb sizes (e.g. 1.5x, 2x, or common wiki sizes)
        alt_sizes = [
            int(round(size * 1.5)),
            int(size * 2),
            20,
            24,
            30,
            36,
            40,
            48,
            60,
            80,
            100,
            130,
        ]
        for s in alt_sizes:
            if s != size:
                candidates.append(
                    f"https://oxygennotincluded.wiki.gg/images/thumb/{base_name}/{s}px-{file_name}{query}"
                )
    else:
        # Direct URL: /images/<file>
        direct_match = re.match(r"^/images/([^/]+)$", path)
        if direct_match:
            base_name = direct_match.group(1)
            for s in [130, 120, 88, 80, 60, 48, 40, 36, 30, 24]:
                candidates.append(
                    f"https://oxygennotincluded.wiki.gg/images/thumb/{base_name}/{s}px-{base_name}{query}"
                )

    return candidates


def download_single_icon(
    url: str,
    dest_path: Path,
    delay: float = DELAY_SECONDS,
    max_retries: int = 3,
) -> bool:
    """Download an icon to dest_path using candidates and retries."""
    if dest_path.exists() and dest_path.stat().st_size > 0:
        return True

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
    }

    candidates = get_candidate_urls(url)
    for cand_url in candidates:
        for attempt in range(max_retries):
            try:
                time.sleep(delay)
                req = urllib.request.Request(cand_url, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    # Check for valid image header (PNG or WebP/RIFF)
                    if len(data) > 0 and (
                        data[:8] == b"\x89PNG\r\n\x1a\n" or data[:4] == b"RIFF"
                    ):
                        dest_path.write_bytes(data)
                        return True
            except urllib.error.HTTPError as err:
                if err.code == 502 and attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                break
            except Exception:
                if attempt < max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                break

    return False


def collect_icons_from_data() -> dict[str, str]:
    """Scan all data JSON files and map icon URL to clean filename."""
    url_to_clean: dict[str, str] = {}

    for fname in DATA_FILES:
        filepath = DATA_DIR / fname
        if not filepath.exists():
            continue
        data = json.loads(filepath.read_text(encoding="utf-8"))

        def visit(item):
            if isinstance(item, dict):
                icon_val = item.get("original_icon_url") or item.get("icon")
                if icon_val and (
                    icon_val.startswith("http://") or icon_val.startswith("https://")
                ):
                    clean_name = clean_icon_filename(icon_val)
                    url_to_clean[icon_val] = clean_name
                for v in item.values():
                    visit(v)
            elif isinstance(item, list):
                for elem in item:
                    visit(elem)

        visit(data)

    return url_to_clean


def download_all_icons() -> tuple[int, int]:
    """Ensure all referenced icons are downloaded locally."""
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    url_map = collect_icons_from_data()
    print(f"Discovered {len(url_map)} unique icon URLs across data files.")

    succeeded = 0
    failed = 0

    for url, clean_name in sorted(url_map.items()):
        dest = ICONS_DIR / clean_name
        if dest.exists() and dest.stat().st_size > 0:
            succeeded += 1
            continue

        print(f"Downloading {clean_name} from {url}...")
        ok = download_single_icon(url, dest)
        if ok:
            succeeded += 1
        else:
            failed += 1
            print(f"Warning: Failed to download {clean_name} ({url})")

    print(f"Icon download complete: {succeeded} available, {failed} failed.")
    return succeeded, failed


def update_data_files() -> None:
    """Update icon paths in data/*.json and regenerate src/dataset.js."""
    for fname in DATA_FILES:
        filepath = DATA_DIR / fname
        if not filepath.exists():
            continue

        data = json.loads(filepath.read_text(encoding="utf-8"))

        def localize_item(item):
            if isinstance(item, dict):
                icon_val = item.get("icon")
                orig_val = item.get("original_icon_url")
                source_url = None

                if icon_val and (
                    icon_val.startswith("http://") or icon_val.startswith("https://")
                ):
                    source_url = icon_val
                elif orig_val:
                    source_url = orig_val

                if source_url:
                    clean_name = clean_icon_filename(source_url)
                    dest_file = ICONS_DIR / clean_name
                    item["original_icon_url"] = source_url
                    if dest_file.exists() and dest_file.stat().st_size > 0:
                        item["icon"] = f"images/icons/{clean_name}"
                    else:
                        item["icon"] = None

                for v in item.values():
                    localize_item(v)
            elif isinstance(item, list):
                for elem in item:
                    localize_item(elem)

        localize_item(data)
        filepath.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Updated {fname} with local icon paths.")

    # Regenerate src/dataset.js from updated dataset.json
    dataset_json_path = DATA_DIR / "dataset.json"
    if dataset_json_path.exists():
        combined = json.loads(dataset_json_path.read_text(encoding="utf-8"))
        dataset_js_path = SRC_DIR / "dataset.js"
        dataset_js_path.write_text(
            "// Auto-generated from oxygennotincluded.wiki.gg scraper\n"
            f"export const ONI_DATASET = {json.dumps(combined, indent=2)};\n",
            encoding="utf-8",
        )
        print("Regenerated src/dataset.js with local icon paths.")

    # Update src/data_loader.js synthetic element icons
    data_loader_path = SRC_DIR / "data_loader.js"
    if data_loader_path.exists():
        dl_content = data_loader_path.read_text(encoding="utf-8")
        dl_content = dl_content.replace(
            '"https://oxygennotincluded.wiki.gg/images/Power.png"',
            '"images/icons/Power.png"',
        )
        dl_content = dl_content.replace(
            '"https://oxygennotincluded.wiki.gg/images/Heat.png"',
            '"images/icons/Heat.png"',
        )
        dl_content = dl_content.replace(
            '"https://oxygennotincluded.wiki.gg/images/Food.png"',
            '"images/icons/Food.png"',
        )
        data_loader_path.write_text(dl_content, encoding="utf-8")
        print("Updated src/data_loader.js synthetic icons to local paths.")

    # Update index.html favicon
    index_html_path = ROOT_DIR / "index.html"
    if index_html_path.exists():
        index_content = index_html_path.read_text(encoding="utf-8")
        index_content = index_content.replace(
            'href="https://oxygennotincluded.wiki.gg/images/Oxygen.png"',
            'href="images/icons/Oxygen.png"',
        )
        index_html_path.write_text(index_content, encoding="utf-8")
        print("Updated index.html favicon to local path.")


def main():
    print("Step 1/2: Downloading icons...")
    download_all_icons()
    print("Step 2/2: Updating JSON data and src/dataset.js...")
    update_data_files()
    print("Done! All icons downloaded and localized.")


if __name__ == "__main__":
    main()
