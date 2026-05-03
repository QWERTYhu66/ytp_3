"""
01_travel_taipei.py
-------------------
Fetch every attraction from the Taipei City Tourism official Open API.

Endpoint:
  https://www.travel.taipei/open-api/zh-tw/Attractions/All
  (also available in en / ja / ko if you want localized blurbs later)

This is open data published by Taipei City Government — free to use
with attribution. Returns several hundred attractions citywide.

Output:
  raw_travel_taipei.json   (full dump)
  travel_taipei.json       (normalized to our schema)
"""

import json
import re
import time
import sys
import urllib.request
from pathlib import Path

API_URL = "https://www.travel.taipei/open-api/zh-tw/Attractions/All"
# English version used as a secondary source for bilingual names/descriptions
API_URL_EN = "https://www.travel.taipei/open-api/en/Attractions/All"
HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "all_data"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (TaipeiCompass open data client)",
    "Accept": "application/json",
}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_entry(item: dict, en_by_id: dict) -> dict:
    name = (item.get("name") or "").strip()
    district = (item.get("zipcode") or "") + ""  # not ideal, see below
    # The real district is embedded in "address" — extract it
    address = item.get("address") or ""
    m = re.search(r"(台北市|臺北市)([\u4e00-\u9fa5]+區)", address)
    if m:
        district = m.group(2)
    else:
        # Some entries list New Taipei
        m = re.search(r"(新北市)([\u4e00-\u9fa5]+區)", address)
        if m:
            district = m.group(2)

    # Prefer first image URL
    images = item.get("images") or []
    image = ""
    if images:
        # schema varies — handle dict vs string
        first = images[0]
        if isinstance(first, dict):
            image = first.get("src") or first.get("url") or ""
        elif isinstance(first, str):
            image = first

    # Rich description comes from `introduction` (can be long HTML)
    intro = item.get("introduction") or ""
    # Strip HTML tags if any
    intro = re.sub(r"<[^>]+>", "", intro)
    intro = re.sub(r"\s+", " ", intro).strip()

    # English companion (if we have it)
    en_info = en_by_id.get(item.get("id"))
    name_en = (en_info or {}).get("name") if en_info else None
    intro_en = None
    if en_info:
        raw_en = en_info.get("introduction") or ""
        intro_en = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", raw_en)).strip()

    return {
        "source": "travel.taipei",
        "source_id": str(item.get("id", "")),
        "name": name,
        "name_en": name_en,
        "district": district,
        "address": address,
        "description": intro,
        "description_en": intro_en,
        "image": image,
        "lat": float(item["latitude"]) if item.get("latitude") else None,
        "lng": float(item["longitude"]) if item.get("longitude") else None,
        "url": item.get("url") or "",
        "categories": [c.get("name") for c in (item.get("categories") or []) if isinstance(c, dict)],
        "raw_tags": [],
    }


def main():
    OUT_DIR.mkdir(exist_ok=True)

    print(f"Fetching {API_URL} …")
    raw_zh = fetch_json(API_URL)
    data_zh = raw_zh.get("data") or []
    print(f"Got {len(data_zh)} zh-tw attractions")

    print(f"Fetching {API_URL_EN} …")
    try:
        raw_en = fetch_json(API_URL_EN)
        data_en = raw_en.get("data") or []
        en_by_id = {d.get("id"): d for d in data_en}
        print(f"Got {len(data_en)} en attractions")
    except Exception as e:
        print(f"[warn] couldn't fetch en feed: {e}")
        en_by_id = {}

    # Save raw for reference
    with (OUT_DIR / "raw_travel_taipei.json").open("w", encoding="utf-8") as f:
        json.dump({"zh": data_zh, "en": list(en_by_id.values())}, f, ensure_ascii=False, indent=2)

    cleaned = []
    for item in data_zh:
        try:
            entry = normalize_entry(item, en_by_id)
            if entry["name"]:
                cleaned.append(entry)
        except Exception as e:
            print(f"[skip] {item.get('id')} — {e}")

    with (OUT_DIR / "travel_taipei.json").open("w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {len(cleaned)} → {OUT_DIR / 'travel_taipei.json'}")


if __name__ == "__main__":
    main()
