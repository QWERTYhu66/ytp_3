"""
08_apply_translations.py
------------------------
Merge the translated strings from translations_cache.json back into
attractions.json. Adds two new fields per attraction:

    "name_i18n":        { "zh": "...", "en": "...", "jp": "...", "kr": "..." }
    "description_i18n": { "zh": "...", "en": "...", "jp": "...", "kr": "..." }

The original `name` and `description` fields are left untouched (so any page
that hasn't been converted to i18n still works).

Backup: writes attractions.pre-i18n.json in the same folder before overwriting.
"""

import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ATTR_PATH = HERE.parent.parent / "src" / "data" / "attractions.json"
BACKUP_PATH = HERE.parent.parent / "src" / "data" / "attractions.pre-i18n.json"
CACHE_PATH = HERE / "translations_cache.json"


def main():
    if not CACHE_PATH.exists():
        raise SystemExit(f"Missing {CACHE_PATH.name}. Run 07_translate.py first.")

    with CACHE_PATH.open(encoding="utf-8") as f:
        cache = json.load(f)
    with ATTR_PATH.open(encoding="utf-8") as f:
        attractions = json.load(f)

    # Safety backup once (don't overwrite an existing backup)
    if not BACKUP_PATH.exists():
        shutil.copy(ATTR_PATH, BACKUP_PATH)
        print(f"Backed up original → {BACKUP_PATH.name}")

    missing = 0
    for a in attractions:
        entry = cache.get(str(a.get("id")))
        if not entry:
            missing += 1
            continue
        a["name_i18n"] = entry.get("name_i18n") or {"zh": a.get("name", "")}
        a["description_i18n"] = entry.get("description_i18n") or {"zh": a.get("description", "")}

    with ATTR_PATH.open("w", encoding="utf-8") as f:
        json.dump(attractions, f, ensure_ascii=False, indent=2)

    print(f"Merged translations into {ATTR_PATH.name}")
    if missing:
        print(f"  note: {missing} attractions had no cache entry (run 07_translate.py first?)")


if __name__ == "__main__":
    main()
