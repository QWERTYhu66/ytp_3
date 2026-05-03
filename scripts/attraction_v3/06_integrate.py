"""
06_integrate.py
---------------
Take the AI-tagged pool and produce a final `attractions.json` that drops
straight into `src/data/`.

Key invariants:
  - Existing attractions keep their id (so already-deployed URLs don't break)
  - New attractions get sequential IDs starting after the max existing id
  - Entries without a tagged category AND without any description are dropped
  - Output schema matches the current attractions.json exactly

Schema produced:
  {
    "id":          "42",
    "name":        "...",
    "district":    "...",
    "category":    ["nature", "relax"],
    "description": "...",
    "link":        "https://maps.google.com/..." | official_website | OSM url,
    "lat":         25.12,
    "lng":         121.54,
    "nearby_mrt":  "劍潭站",
    "tags":        ["day", "outdoor"],
    // optional extras preserved but not required by the UI:
    "name_en":     "...",
    "image":       "...",
    "source":      "existing" | "travel.taipei" | "osm"
  }

Input:
  tagged_attractions.json
Output:
  attractions_final.json          — writes to this folder for review
  <-- then copy to src/data/attractions.json when you're happy
"""

import json
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
IN_PATH = HERE / "tagged_attractions.json"
OUT_PATH = HERE / "attractions_final.json"

# Chinese-first launch: keep the curated/official/famous/notable attraction
# bank, but exclude bare OSM filler entries from the public dataset.
MIN_SUGGESTION_LEVEL = 2


def build_link(e: dict) -> str:
    if e.get("url"):
        return e["url"]
    # Google Maps directions link (keeps parity with existing data)
    lat, lng = e.get("lat"), e.get("lng")
    if lat and lng:
        return f"https://maps.google.com/maps?f=d&saddr=&daddr={lat},{lng}&hl=zh-TW&dirflg=r"
    name = e.get("name") or ""
    return f"https://www.google.com/maps/search/?api=1&query={quote(name)}"


def score_entry(e: dict) -> int:
    """Higher is better — used to rank before truncating if you want to cap."""
    score = 0
    if e.get("source") == "existing":
        score += 100  # always keep
    if e.get("wikidata_qid"):
        score += 20
    if e.get("image"):
        score += 5
    if e.get("description") and len(e["description"]) > 60:
        score += 3
    if e.get("category"):
        score += 2
    if e.get("tags"):
        score += 2
    return score


def suggestion_level(e: dict) -> int:
    """
    1–3 priority shown to the AI guide and to the explore page
    (same convention as restaurants.json: 3 = top-pick, 1 = filler).

      3 — hand-curated existing entries, official Taipei City Tourism API
          entries, every 夜市 / official market, and anything with a
          Wikidata QID (i.e. famous enough to have a Wikipedia article)
      2 — OSM entry with a solid shape: has category/tags, has a
          description or an image, or sits on a notable OSM tag
          (museum, mall, temple, night-club, etc.)
      1 — bare OSM entry with only a name + coords
    """
    name = e.get("name") or ""
    source = e.get("source")
    osm_tags = e.get("osm_tags") or {}

    # ── tier 3: canonical / famous ──────────────────────────────────
    if source == "existing":
        return 3
    if source == "travel.taipei":
        return 3
    if "夜市" in name or "night_market" in name.lower():
        return 3
    if osm_tags.get("amenity") == "marketplace" or osm_tags.get("tourism") == "marketplace":
        return 3
    if e.get("wikidata_qid"):
        return 3

    # ── tier 2: OSM with decent info ────────────────────────────────
    notable_osm = (
        osm_tags.get("tourism") in {"museum", "gallery", "attraction", "viewpoint"}
        or osm_tags.get("historic") in {"monument", "memorial", "castle", "ruins"}
        or osm_tags.get("shop") in {"mall", "department_store"}
        or osm_tags.get("amenity") in {"place_of_worship", "theatre", "arts_centre"}
        or osm_tags.get("leisure") in {"park", "garden", "nature_reserve"}
        or osm_tags.get("natural") in {"peak", "hot_spring", "waterfall"}
    )
    has_body = (
        (e.get("description") and len(e["description"]) > 40)
        or e.get("image")
        or e.get("url")
    )
    if notable_osm and (has_body or (e.get("category") and e.get("tags"))):
        return 2
    if notable_osm or has_body:
        return 2

    # ── tier 1: bare OSM ────────────────────────────────────────────
    return 1


def should_keep(e: dict) -> bool:
    # Always keep originals
    if e.get("source") == "existing":
        return True
    if suggestion_level(e) < MIN_SUGGESTION_LEVEL:
        return False
    # Require a name, coords, and either a category or a decent description
    if not e.get("name") or not e.get("lat") or not e.get("lng"):
        return False
    if not e.get("category"):
        # OSM category comes through — accept if present
        if not e.get("osm_category"):
            return False
    if not e.get("district"):
        return False
    return True


def normalize(e: dict, existing_max_id: int, counter: list) -> dict | None:
    if not should_keep(e):
        return None

    if e.get("source") == "existing":
        out_id = str(e.get("preserve_id"))
    else:
        counter[0] += 1
        out_id = str(existing_max_id + counter[0])

    cat = e.get("category") or ([e.get("osm_category")] if e.get("osm_category") else [])
    cat = [c for c in cat if c]

    # Seed name_i18n with whatever OSM already gave us (name:en / ja / ko tags)
    name_i18n = dict(e.get("name_i18n") or {})
    name_i18n.setdefault("zh", (e.get("name") or "").strip())
    if e.get("name_en") and not name_i18n.get("en"):
        name_i18n["en"] = e.get("name_en")

    description_i18n = dict(e.get("description_i18n") or {})
    if e.get("description") and not description_i18n.get("zh"):
        description_i18n["zh"] = (e.get("description") or "").strip()
    if e.get("description_en") and not description_i18n.get("en"):
        description_i18n["en"] = e.get("description_en")

    return {
        "id": out_id,
        "suggestion_level": suggestion_level(e),
        "name": (e.get("name") or "").strip(),
        "name_i18n": name_i18n,
        "description_i18n": description_i18n,
        "district": (e.get("district") or "").strip(),
        "category": cat,
        "description": (e.get("description") or "").strip(),
        "link": build_link(e),
        "lat": e.get("lat"),
        "lng": e.get("lng"),
        "nearby_mrt": e.get("nearby_mrt", ""),
        "tags": e.get("tags") or [],
        "name_en": e.get("name_en"),
        "image": e.get("image"),
        "source": e.get("source"),
        "osm_type": e.get("osm_type"),
    }


def main():
    with IN_PATH.open(encoding="utf-8") as f:
        pool = json.load(f)

    existing_ids = [int(e.get("preserve_id", -1)) for e in pool if e.get("source") == "existing"]
    existing_max = max(existing_ids) if existing_ids else -1
    print(f"existing max id: {existing_max}")

    # Sort: existing first (stable by id — so their URLs stay stable),
    # then new entries by suggestion_level (desc) then score (desc), so
    # the most famous new items get the lower ID numbers.
    existing = [e for e in pool if e.get("source") == "existing"]
    existing.sort(key=lambda e: int(e.get("preserve_id", 0)))
    new_entries = [e for e in pool if e.get("source") != "existing"]
    new_entries.sort(key=lambda e: (suggestion_level(e), score_entry(e)), reverse=True)

    ordered = existing + new_entries

    counter = [0]
    out = []
    for e in ordered:
        n = normalize(e, existing_max, counter)
        if n:
            out.append(n)

    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    kept = len(out)
    dropped = len(pool) - kept
    print(
        f"\nKept {kept} | dropped {dropped} "
        f"(missing coords / district / category, or tier < {MIN_SUGGESTION_LEVEL})"
    )

    # Tier breakdown
    from collections import Counter
    tiers = Counter(a.get("suggestion_level") for a in out)
    print("\nSuggestion-level breakdown:")
    for t in (3, 2, 1):
        print(f"  tier {t}: {tiers.get(t, 0)}")

    print(f"\nWrote {OUT_PATH.name}")
    print("\nTo deploy:")
    print("  cp attractions_final.json ../../src/data/attractions.json")
    print("  (back up src/data/attractions.json first!)")


if __name__ == "__main__":
    main()
