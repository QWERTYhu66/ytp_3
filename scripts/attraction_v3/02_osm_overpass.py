"""
02_osm_overpass.py
------------------
Pull every attraction-like POI inside Taipei City from OpenStreetMap via the
Overpass API, including the Wikidata QID when one is linked.

What we ask for (keyed to the site's five categories):

  nature    → leisure=park, natural=peak, route=hiking, waterway=river/stream,
              natural=hot_spring, landuse=forest
  culture   → tourism=museum/attraction/gallery/artwork, historic=*,
              amenity=place_of_worship, amenity=theatre/arts_centre
  shopping  → shop=mall, shop=department_store, tourism=marketplace,
              amenity=marketplace
  food      → tourism=* with name containing 夜市 / night_market,
              amenity=marketplace with name containing 夜市 / night_market
  relax     → amenity=spa, leisure=garden, tourism=viewpoint

  extras    → amenity=nightclub, amenity=bar (for "night scene" coverage)

OSM is ODbL licensed — attribution required when using the data.

Output:
  raw_osm.json          (raw Overpass response)
  osm_attractions.json  (normalized schema)
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Taipei City bbox (south, west, north, east)
# Loose box covering Taipei City + near-in New Taipei (Beitou reaches north,
# Maokong reaches south) so we catch the classics like Yangmingshan etc.
BBOX = "24.95,121.45,25.22,121.68"

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "all_data"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]

HEADERS = {
    "User-Agent": "TaipeiCompass/1.0 (sch312413@gmail.com)",
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}

HAN_RE = re.compile(r"[\u4e00-\u9fff]")

# Each entry becomes one Overpass query tag we retrieve.
# (category we'll assign, overpass filter)
QUERIES = [
    # ── nature ──────────────────────────────────────
    ("nature", 'leisure=park'),
    ("nature", 'natural=peak'),
    ("nature", 'natural=hot_spring'),
    ("nature", 'natural=waterfall'),
    ("nature", 'route=hiking'),
    ("nature", 'landuse=forest'),
    ("nature", 'leisure=nature_reserve'),
    # ── culture ─────────────────────────────────────
    ("culture", 'tourism=museum'),
    ("culture", 'tourism=gallery'),
    ("culture", 'tourism=artwork'),
    ("culture", 'tourism=attraction'),
    ("culture", 'historic=monument'),
    ("culture", 'historic=memorial'),
    ("culture", 'historic=castle'),
    ("culture", 'historic=ruins'),
    ("culture", 'historic=building'),
    ("culture", 'amenity=place_of_worship'),
    ("culture", 'amenity=theatre'),
    ("culture", 'amenity=arts_centre'),
    ("culture", 'amenity=library'),
    # ── shopping ────────────────────────────────────
    ("shopping", 'shop=mall'),
    ("shopping", 'shop=department_store'),
    ("shopping", 'tourism=marketplace'),
    ("shopping", 'amenity=marketplace'),
    # ── relax ───────────────────────────────────────
    ("relax", 'leisure=garden'),
    ("relax", 'tourism=viewpoint'),
    ("relax", 'amenity=spa'),
    ("relax", 'leisure=park_bench'),
    # ── night scene (tag-only, category best-guess) ─
    ("food", 'amenity=nightclub'),
    ("food", 'amenity=bar'),
]


def overpass_query(filter_expr: str) -> list[dict]:
    """Run one Overpass filter and return element list."""
    q = f"""
[out:json][timeout:90];
(
  node[{filter_expr}]({BBOX});
  way[{filter_expr}]({BBOX});
  relation[{filter_expr}]({BBOX});
);
out center tags;
""".strip()
    data = urllib.parse.urlencode({"data": q}).encode()

    last_err = None
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            return out.get("elements", [])
        except Exception as e:
            last_err = e
            # mirror is busy / rejecting — try the next one
            time.sleep(2)
            continue
    raise RuntimeError(f"all Overpass mirrors failed: {last_err}")


def osm_type_from_filter(filter_expr: str, name: str) -> str:
    """
    Turn an Overpass filter ('leisure=park') into a clean short type key
    we can show on the site and translate ('park').
    Falls back to the raw value if the filter isn't a key=value pair.
    Night-market detection is a special case since OSM has no dedicated tag.
    """
    if "夜市" in (name or "") or "night market" in (name or "").lower():
        return "night_market"
    if "=" in filter_expr:
        key, val = filter_expr.split("=", 1)
        return val.strip()
    return filter_expr.strip()


def pick_zh_name(tags: dict) -> str:
    """Return a Chinese display name, or empty when OSM only has non-Chinese names."""
    explicit = (
        tags.get("name:zh-TW")
        or tags.get("name:zh-Hant")
        or tags.get("name:zh")
        or ""
    ).strip()
    if explicit:
        return explicit

    fallback = (tags.get("name") or "").strip()
    if fallback and HAN_RE.search(fallback):
        return fallback
    return ""


def build_name_i18n(tags: dict) -> dict:
    """
    Pull every multilingual name tag OSM provides and return
    a { zh, en, jp, kr } dict. Missing languages are left empty
    so 07_translate.py can fill them later.
    """
    zh = pick_zh_name(tags)
    en = (tags.get("name:en") or "").strip()
    jp = (tags.get("name:ja") or tags.get("name:jp") or "").strip()
    kr = (tags.get("name:ko") or tags.get("name:kr") or "").strip()
    out = {}
    if zh: out["zh"] = zh
    if en: out["en"] = en
    if jp: out["jp"] = jp
    if kr: out["kr"] = kr
    return out


def normalize(el: dict, category: str, osm_type: str) -> dict | None:
    tags = el.get("tags") or {}
    name = pick_zh_name(tags)
    if not name:
        return None

    # Coords (use `center` for ways/relations)
    lat = el.get("lat")
    lng = el.get("lon")
    if lat is None and "center" in el:
        lat = el["center"].get("lat")
        lng = el["center"].get("lon")
    if lat is None or lng is None:
        return None

    # Filter: only keep entries in Taipei City (not deep into New Taipei)
    # Taipei City bounding (tighter, roughly)
    if not (24.96 <= lat <= 25.21 and 121.46 <= lng <= 121.68):
        return None

    # Try to pull a district from address tags
    district = (
        tags.get("addr:district")
        or tags.get("addr:suburb")
        or ""
    )
    if not district:
        city = tags.get("addr:city") or ""
        m = re.search(r"([\u4e00-\u9fa5]+區)", city)
        if m:
            district = m.group(1)

    return {
        "source": "osm",
        "source_id": f"{el.get('type', 'node')}/{el.get('id')}",
        "name": name.strip(),
        "name_en": tags.get("name:en"),
        "name_i18n": build_name_i18n(tags),
        "district": district,
        "category": category,
        "osm_type": osm_type,
        "lat": lat,
        "lng": lng,
        "address": tags.get("addr:full") or "",
        "url": tags.get("website") or tags.get("contact:website") or "",
        "wikidata_qid": tags.get("wikidata"),
        "wikipedia": tags.get("wikipedia"),
        "osm_tags": tags,
    }


def main():
    OUT_DIR.mkdir(exist_ok=True)

    all_raw: list[dict] = []
    cleaned: list[dict] = []
    seen_ids: set[str] = set()

    for (cat, filt) in QUERIES:
        print(f"Querying {filt!r} ({cat}) …", end=" ", flush=True)
        try:
            els = overpass_query(filt)
        except Exception as e:
            print(f"ERROR {e}")
            time.sleep(10)
            continue
        print(f"{len(els)} elements")
        all_raw.append({"filter": filt, "category": cat, "elements": els})

        for el in els:
            tags = el.get("tags") or {}
            name_for_type = pick_zh_name(tags)
            otype = osm_type_from_filter(filt, name_for_type)
            norm = normalize(el, cat, otype)
            if not norm:
                continue
            sid = norm["source_id"]
            if sid in seen_ids:
                continue
            seen_ids.add(sid)
            cleaned.append(norm)

        # Be kind to Overpass
        time.sleep(2)

    with (OUT_DIR / "raw_osm.json").open("w", encoding="utf-8") as f:
        json.dump(all_raw, f, ensure_ascii=False, indent=2)

    with (OUT_DIR / "osm_attractions.json").open("w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {len(cleaned)} unique OSM entries → {OUT_DIR / 'osm_attractions.json'}")
    print(f"  with wikidata QID: {sum(1 for e in cleaned if e.get('wikidata_qid'))}")


if __name__ == "__main__":
    main()
