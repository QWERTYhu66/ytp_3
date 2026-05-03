"""
04_merge_dedupe.py
------------------
Merge three sources into one candidate pool, deduped by name+proximity.

Priority order (first wins, later sources fill gaps):
  1. existing attractions.json (keep their IDs & curated descriptions)
  2. travel_taipei.json        (official Taipei City data)
  3. wikidata_enriched.json    (OSM + Wikidata)

Dedupe strategy:
  - Normalize Chinese name (strip whitespace & punctuation, lowercase ASCII)
  - Same normalized name within 500 m  → merge
  - Exact QID match                    → merge regardless of distance

Output:
  merged_attractions.json  (pool of every unique attraction ready for tagging)
"""

import json
import math
import re
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXISTING_PATH = HERE.parent.parent / "src" / "data" / "attractions.json"
TRAVEL_TAIPEI_PATH = HERE / "travel_taipei.json"
WIKIDATA_PATH = HERE / "wikidata_enriched.json"
OSM_PATH = HERE / "osm_attractions.json"

OUT = HERE / "merged_attractions.json"


def compact_i18n(values: dict[str, str | None]) -> dict[str, str]:
    return {lang: text.strip() for lang, text in values.items() if text and text.strip()}


def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).strip().lower()
    # strip punctuation / whitespace / common separators
    s = re.sub(r"[\s\-–—·.,'/()（）\[\]「」【】《》:：!?！？]", "", s)
    return s


def haversine_m(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371000
    phi1, phi2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dlam = math.radians(b_lng - a_lng)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_existing() -> list[dict]:
    with EXISTING_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for a in data:
        out.append({
            "source": "existing",
            "preserve_id": a["id"],
            "name": a["name"],
            "name_en": (a.get("name_i18n") or {}).get("en") or a.get("name_en"),
            "name_i18n": a.get("name_i18n") or compact_i18n({
                "zh": a.get("name"),
                "en": a.get("name_en"),
            }),
            "district": a.get("district", ""),
            "category": a.get("category", []),
            "tags": a.get("tags", []),
            "description": a.get("description", ""),
            "description_en": (a.get("description_i18n") or {}).get("en") or a.get("description_en"),
            "description_i18n": a.get("description_i18n") or compact_i18n({
                "zh": a.get("description"),
                "en": a.get("description_en"),
            }),
            "image": None,
            "lat": a.get("lat"),
            "lng": a.get("lng"),
            "url": a.get("link", ""),
            "nearby_mrt": a.get("nearby_mrt", ""),
            "wikidata_qid": None,
        })
    return out


def load_travel_taipei() -> list[dict]:
    if not TRAVEL_TAIPEI_PATH.exists():
        print(f"[skip] {TRAVEL_TAIPEI_PATH.name} not found — run 01_travel_taipei.py first")
        return []
    with TRAVEL_TAIPEI_PATH.open(encoding="utf-8") as f:
        raw = json.load(f)
    out = []
    for r in raw:
        description_i18n = compact_i18n({
            "zh": r.get("description"),
            "en": r.get("description_en"),
            "jp": r.get("description_jp"),
            "kr": r.get("description_kr"),
        })
        out.append({
            "source": "travel.taipei",
            "source_id": r.get("source_id"),
            "name": r.get("name"),
            "name_en": r.get("name_en"),
            "district": r.get("district", ""),
            "address": r.get("address", ""),
            "description": r.get("description", ""),
            "description_en": r.get("description_en"),
            "description_i18n": description_i18n,
            "image": r.get("image") or None,
            "lat": r.get("lat"),
            "lng": r.get("lng"),
            "url": r.get("url", ""),
            "categories_raw": r.get("categories") or [],
            "wikidata_qid": None,
        })
    return out


def load_osm_wikidata() -> list[dict]:
    # Prefer wikidata_enriched.json (has descriptions + images), but fall back
    # to the raw osm_attractions.json when Wikidata enrichment wasn't run.
    source_path = None
    if WIKIDATA_PATH.exists():
        source_path = WIKIDATA_PATH
        print(f"[ok] using {WIKIDATA_PATH.name}")
    elif OSM_PATH.exists():
        source_path = OSM_PATH
        print(f"[ok] using {OSM_PATH.name} (no Wikidata enrichment)")
    else:
        print(f"[skip] neither {WIKIDATA_PATH.name} nor {OSM_PATH.name} found — run 02_osm_overpass.py first")
        return []

    with source_path.open(encoding="utf-8") as f:
        raw = json.load(f)

    out = []
    for r in raw:
        wd = r.get("wd") or {}
        name = r.get("name") or wd.get("label_zh")
        if not name:
            continue
        desc = wd.get("desc_zh") or ""
        description_i18n = compact_i18n({
            "zh": desc,
            "en": wd.get("desc_en"),
            "jp": wd.get("desc_ja"),
            "kr": wd.get("desc_ko"),
        })
        out.append({
            "source": "osm",
            "source_id": r.get("source_id"),
            "name": name,
            "name_en": r.get("name_en") or wd.get("label_en"),
            "name_i18n": r.get("name_i18n") or {},
            "district": r.get("district", ""),
            "osm_category": r.get("category"),
            "osm_type": r.get("osm_type"),
            "description": desc,
            "description_en": wd.get("desc_en"),
            "description_i18n": description_i18n,
            "image": wd.get("image") or None,
            "lat": r.get("lat"),
            "lng": r.get("lng"),
            "url": r.get("url") or wd.get("official_website") or "",
            "wikidata_qid": r.get("wikidata_qid"),
            "osm_tags": r.get("osm_tags") or {},
        })
    return out


def merge_into(base: dict, extra: dict):
    """Fill missing fields in base with values from extra."""
    for k, v in extra.items():
        if not v:
            continue
        if k in {"name_i18n", "description_i18n"}:
            merged = dict(base.get(k) or {})
            for lang, text in v.items():
                if text and not merged.get(lang):
                    merged[lang] = text
            if merged:
                base[k] = merged
            continue
        cur = base.get(k)
        if not cur:
            base[k] = v


def main():
    existing = load_existing()
    travel = load_travel_taipei()
    osm = load_osm_wikidata()
    print(f"existing: {len(existing)}, travel.taipei: {len(travel)}, osm/wd: {len(osm)}")

    pool: list[dict] = []
    qid_index: dict[str, int] = {}
    name_index: dict[str, list[int]] = {}

    def register(entry: dict):
        idx = len(pool)
        pool.append(entry)
        if entry.get("wikidata_qid"):
            qid_index[entry["wikidata_qid"]] = idx
        nk = normalize_name(entry.get("name") or "")
        if nk:
            name_index.setdefault(nk, []).append(idx)

    def find_match(entry: dict) -> int | None:
        qid = entry.get("wikidata_qid")
        if qid and qid in qid_index:
            return qid_index[qid]
        nk = normalize_name(entry.get("name") or "")
        if not nk:
            return None
        for idx in name_index.get(nk, []):
            cand = pool[idx]
            if cand.get("lat") and entry.get("lat"):
                d = haversine_m(cand["lat"], cand["lng"], entry["lat"], entry["lng"])
                if d <= 500:
                    return idx
            else:
                return idx
        return None

    # ── Pass 1: existing (always kept) ─────────────────
    for e in existing:
        register(e)

    # ── Pass 2: travel.taipei fills gaps ───────────────
    for t in travel:
        m = find_match(t)
        if m is not None:
            merge_into(pool[m], t)
        else:
            register(t)

    # ── Pass 3: OSM + Wikidata fills more gaps ─────────
    for o in osm:
        m = find_match(o)
        if m is not None:
            merge_into(pool[m], o)
            if o.get("wikidata_qid"):
                qid_index[o["wikidata_qid"]] = m
        else:
            register(o)

    with OUT.open("w", encoding="utf-8") as f:
        json.dump(pool, f, ensure_ascii=False, indent=2)

    n_existing = sum(1 for e in pool if e["source"] == "existing")
    n_travel = sum(1 for e in pool if e["source"] == "travel.taipei")
    n_osm = sum(1 for e in pool if e["source"] == "osm")
    print(f"\nMerged pool: {len(pool)} attractions")
    print(f"  existing (kept IDs): {n_existing}")
    print(f"  travel.taipei new:   {n_travel}")
    print(f"  osm+wd new:          {n_osm}")
    print(f"Wrote {OUT.name}")


if __name__ == "__main__":
    main()
