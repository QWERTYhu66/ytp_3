import json

with open("/Users/sharonchen/Desktop/ytp_3/scripts/pages/attractions_zh.json", "r", encoding="utf-8") as f:
    data = json.load(f)

with open("/Users/sharonchen/Desktop/ytp_3/scripts/pages/names.txt", "w", encoding="utf-8") as f:
    for item in data:
        name = item.get("name")
        if name:
            f.write(name + "\n")