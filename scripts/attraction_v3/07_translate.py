"""
07_translate.py
---------------
Translate every attraction's `name` and `description` from zh-TW into
English, Japanese, and Korean using Google Translate's free public endpoint.

  * No API key, no cost (uses translate.googleapis.com/translate_a/single)
  * Built to scale — safely handles 1,000+ attractions
  * Caches after every single translation, so ctrl-C → re-run skips done work
  * Retries with exponential backoff on rate limit / network hiccup
  * Falls back to MyMemory if Google keeps refusing

Expected runtime for ~1,000 attractions: 40–90 minutes depending on how
aggressive Google's rate limiter is that day. Just leave it running in the
background; it persists after every single translation.

Input:
  ../../src/data/attractions.json   (names + descriptions in zh-TW)

Output:
  translations_cache.json           (id → { name_i18n, description_i18n })

Run 08_apply_translations.py afterwards to merge back into attractions.json.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ATTR_PATH = HERE.parent.parent / "src" / "data" / "attractions.json"
CACHE_PATH = HERE / "translations_cache.json"

# our code → Google code,  MyMemory code
TARGETS = {
    "en": ("en",       "en"),
    "jp": ("ja",       "ja"),
    "kr": ("ko",       "ko"),
}
SOURCE_GOOGLE = "zh-TW"
SOURCE_MYMEMORY = "zh-TW"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# Pacing: the public endpoint tolerates ~1 req/sec sustained.
# Bump SLEEP up if you start seeing 429s in the log.
SLEEP_BETWEEN = 0.6        # seconds between successful requests
MAX_ATTEMPTS = 5           # per-translation retry budget
BACKOFF_BASE = 4.0         # 1st retry waits 4s, 2nd 8s, 3rd 16s, 4th 32s …

# Translate descriptions only for top-priority attractions.
# suggestion_level is 1 (bare OSM), 2 (OSM with decent info), 3 (canonical / famous).
# Sharon's request: "for the tier 1 and tier 2, do a translating for their description".
# The two top priority tiers in the codebase are 3 and 2 — that's ~4,490 attractions.
# Names are ALWAYS translated (cheap) regardless of tier so every destination
# shows correctly in all four languages.
MIN_TIER_FOR_DESCRIPTION = 2


# ─── backends ────────────────────────────────────────────────────────────

def _translate_google(text: str, target: str) -> str:
    params = {
        "client": "gtx",
        "sl": SOURCE_GOOGLE,
        "tl": target,
        "dt": "t",
        "q": text,
    }
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return "".join(chunk[0] for chunk in data[0] if chunk[0])


def _translate_mymemory(text: str, target: str) -> str:
    # MyMemory has a 500-char per-request limit on the free endpoint.
    # For longer descriptions we split on Chinese punctuation and translate
    # the chunks separately, then rejoin.
    if len(text) <= 500:
        chunks = [text]
    else:
        chunks, buf = [], ""
        for ch in text:
            buf += ch
            if ch in "。！？；\n" and len(buf) >= 200:
                chunks.append(buf); buf = ""
        if buf:
            chunks.append(buf)

    out_parts = []
    for c in chunks:
        params = {
            "q": c,
            "langpair": f"{SOURCE_MYMEMORY}|{target}",
        }
        url = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as resp:
            j = json.loads(resp.read().decode("utf-8"))
        out_parts.append(j.get("responseData", {}).get("translatedText", ""))
        time.sleep(0.4)
    return "".join(out_parts)


def translate(text: str, target_google: str, target_mymemory: str) -> str:
    """Resilient translate: Google first, MyMemory as fallback, retries w/ backoff."""
    if not text or not text.strip():
        return ""

    last_err = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return _translate_google(text, target_google)
        except Exception as e:
            last_err = e
            wait = BACKOFF_BASE * (2 ** attempt)
            print(f"    google attempt {attempt+1}/{MAX_ATTEMPTS} failed ({e}); sleeping {wait:.0f}s…")
            time.sleep(wait)

    # Try MyMemory as last resort
    try:
        print("    falling back to MyMemory…")
        return _translate_mymemory(text, target_mymemory)
    except Exception as e:
        print(f"    mymemory also failed: {e}")
        raise last_err


# ─── main ────────────────────────────────────────────────────────────────

def main():
    with ATTR_PATH.open(encoding="utf-8") as f:
        attractions = json.load(f)

    cache = {}
    if CACHE_PATH.exists():
        with CACHE_PATH.open(encoding="utf-8") as f:
            cache = json.load(f)

    def save_cache():
        tmp = CACHE_PATH.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
        tmp.replace(CACHE_PATH)   # atomic, no half-written cache on crash

    total = len(attractions)
    print(f"Translating {total} attractions × 3 languages (en / jp / kr) …")
    print(f"  — names:        every attraction")
    print(f"  — descriptions: only suggestion_level >= {MIN_TIER_FOR_DESCRIPTION}")
    print(f"Cache: {len(cache)} attractions already have entries — those get skipped.\n")

    done_this_run = 0
    translated_fields = 0
    skipped_desc_low_tier = 0

    for i, a in enumerate(attractions, start=1):
        aid = str(a.get("id"))
        zh_name = a.get("name", "")
        zh_desc = a.get("description", "")
        tier = a.get("suggestion_level") or 0

        # Seed the entry from cache, then layer in anything the JSON already knows
        # (e.g. OSM's name:en / name:ja / name:ko tags captured by 02_osm_overpass.py).
        existing_name_i18n = a.get("name_i18n") or {}
        existing_desc_i18n = a.get("description_i18n") or {}

        entry = cache.get(aid) or {
            "name_i18n": {"zh": zh_name},
            "description_i18n": {"zh": zh_desc},
        }
        entry["name_i18n"]["zh"] = zh_name
        entry["description_i18n"]["zh"] = zh_desc

        for lang in ("en", "jp", "kr"):
            if existing_name_i18n.get(lang) and not entry["name_i18n"].get(lang):
                entry["name_i18n"][lang] = existing_name_i18n[lang]
            if existing_desc_i18n.get(lang) and not entry["description_i18n"].get(lang):
                entry["description_i18n"][lang] = existing_desc_i18n[lang]

        translate_desc = tier >= MIN_TIER_FOR_DESCRIPTION and bool(zh_desc.strip())
        if not translate_desc and zh_desc.strip():
            skipped_desc_low_tier += 1

        did_translate = False
        for lang, (g, mm) in TARGETS.items():
            if not entry["name_i18n"].get(lang):
                try:
                    entry["name_i18n"][lang] = translate(zh_name, g, mm)
                    translated_fields += 1
                    did_translate = True
                    time.sleep(SLEEP_BETWEEN)
                except Exception as e:
                    print(f"  [{aid}] name→{lang} giving up: {e}")
                    entry["name_i18n"][lang] = ""   # write empty to unblock rerun
            if translate_desc and not entry["description_i18n"].get(lang):
                try:
                    entry["description_i18n"][lang] = translate(zh_desc, g, mm)
                    translated_fields += 1
                    did_translate = True
                    time.sleep(SLEEP_BETWEEN)
                except Exception as e:
                    print(f"  [{aid}] description→{lang} giving up: {e}")
                    entry["description_i18n"][lang] = ""

        cache[aid] = entry

        if did_translate:
            done_this_run += 1
            save_cache()   # persist per-attraction so ctrl-C is safe

        if i % 10 == 0 or i == total:
            print(f"  [{i}/{total}]  translated-this-run: {done_this_run} attractions, "
                  f"{translated_fields} fields  (skipped low-tier desc: {skipped_desc_low_tier})")

    save_cache()
    print(f"\n✓ Done. Cache at {CACHE_PATH.name}")
    print("  Next:  python3 08_apply_translations.py")


if __name__ == "__main__":
    main()
