"""
03_wikidata_enrich.py
---------------------
For every OSM entry that carries a Wikidata QID, fetch:
  - multilingual labels (zh, en, ja, ko)
  - descriptions
  - cover image (P18)
  - official website (P856)

Wikidata is CC0 → no licensing headache.

Input:
  osm_attractions.json   (from 02_osm_overpass.py)

Output:
  wikidata_enriched.json (OSM entries augmented with `wd:` fields)
"""

import json
import time
import urllib.parse
import urllib.request

HEADERS = {
    "User-Agent": "Mozilla/5.0 (TaipeiCompass Wikidata client; contact sch312413@gmail.com)",
    "Accept": "application/json",
}

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_THUMB = "https://commons.wikimedia.org/w/thumb.php?f={fn}&w=1200"

BATCH_SIZE = 50  # wbgetentities supports up to 50 ids per call


def fetch_entities(qids: list[str]) -> dict:
    params = {
        "action": "wbgetentities",
        "ids": "|".join(qids),
        "props": "labels|descriptions|claims|sitelinks",
        "languages": "en|zh|zh-tw|zh-hant|ja|ko",
        "format": "json",
    }
    url = f"{WIKIDATA_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract(entity: dict) -> dict:
    out: dict = {}
    labels = entity.get("labels") or {}
    descs = entity.get("descriptions") or {}

    for key, lang in [("en", "en"), ("zh", "zh"), ("zh", "zh-tw"), ("zh", "zh-hant"), ("ja", "ja"), ("ko", "ko")]:
        if out.get(f"label_{key}"):
            continue
        v = labels.get(lang, {}).get("value")
        if v:
            out[f"label_{key}"] = v

    for key, lang in [("en", "en"), ("zh", "zh"), ("zh", "zh-tw"), ("zh", "zh-hant"), ("ja", "ja"), ("ko", "ko")]:
        if out.get(f"desc_{key}"):
            continue
        v = descs.get(lang, {}).get("value")
        if v:
            out[f"desc_{key}"] = v

    claims = entity.get("claims") or {}
    # P18 = image
    p18 = claims.get("P18")
    if p18:
        try:
            fn = p18[0]["mainsnak"]["datavalue"]["value"]
            out["image"] = COMMONS_THUMB.format(fn=urllib.parse.quote(fn.replace(" ", "_")))
        except Exception:
            pass
    # P856 = official website
    p856 = claims.get("P856")
    if p856:
        try:
            out["official_website"] = p856[0]["mainsnak"]["datavalue"]["value"]
        except Exception:
            pass

    return out


def main():
    with open("osm_attractions.json", encoding="utf-8") as f:
        osm = json.load(f)

    qids = [e["wikidata_qid"] for e in osm if e.get("wikidata_qid")]
    qids = list(dict.fromkeys(qids))  # dedupe, preserve order
    print(f"{len(qids)} unique Wikidata QIDs to fetch")

    wd_data: dict[str, dict] = {}
    for i in range(0, len(qids), BATCH_SIZE):
        batch = qids[i:i + BATCH_SIZE]
        print(f"  batch {i // BATCH_SIZE + 1}/{(len(qids) + BATCH_SIZE - 1) // BATCH_SIZE} …", end=" ", flush=True)
        try:
            resp = fetch_entities(batch)
        except Exception as e:
            print(f"ERR {e}")
            time.sleep(10)
            continue
        for qid, entity in (resp.get("entities") or {}).items():
            wd_data[qid] = extract(entity)
        print(f"got {len(resp.get('entities') or {})}")
        time.sleep(1)

    enriched = []
    for e in osm:
        qid = e.get("wikidata_qid")
        if qid and qid in wd_data:
            e["wd"] = wd_data[qid]
        enriched.append(e)

    with open("wikidata_enriched.json", "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    n_with_image = sum(1 for e in enriched if (e.get("wd") or {}).get("image"))
    n_with_desc = sum(1 for e in enriched if any(k.startswith("desc_") for k in (e.get("wd") or {})))
    print(f"\nWrote {len(enriched)} → wikidata_enriched.json")
    print(f"  with image:       {n_with_image}")
    print(f"  with description: {n_with_desc}")


if __name__ == "__main__":
    main()
