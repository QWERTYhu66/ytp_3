import json, re
from urllib.parse import urlparse

def get_credit(url):
    if not url or url == 'else.png':
        return ''
    try:
        host = urlparse(url).netloc
        # Special cases first
        if 'wikimedia' in host or 'wikipedia' in host:
            return 'Wikimedia Commons'
        if 'gstatic' in host or 'googleusercontent' in host:
            return 'Google'
        if 'tripadvisor' in host:
            return 'Tripadvisor'
        if 'kkday' in host:
            return 'KKday'
        # Strip leading subdomains, keep last two parts (domain.tld or domain.tld.cc)
        parts = host.split('.')
        # Keep last 3 parts if country-code TLD (e.g. travel.taipei, gov.taipei, com.tw)
        if len(parts) >= 3 and len(parts[-1]) == 2:  # country TLD like .tw, .jp
            return '.'.join(parts[-3:])
        return '.'.join(parts[-2:])
    except:
        return ''

for lang in ['en', 'jp', 'kr', 'zh']:
    fname = f'attractions_{lang}.json'
    with open(fname, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for attraction in data:
        attraction['image_credit'] = get_credit(attraction.get('image', ''))
    with open(fname, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{lang}: done")

d = json.load(open('attractions_en.json'))
for i in [0, 1, 5, 10, 60, 91, 92]:
    print(f"[{i}] '{d[i]['image_credit']}'  ← {d[i]['image'][:50]}")
