import json

# Load names.txt image URLs in order
with open('names.txt', 'r', encoding='utf-8') as f:
    lines = [l.strip() for l in f if l.strip()]

# Extract just the URLs (format: "name: url")
image_urls = []
for line in lines:
    if ': ' in line:
        url = line.split(': ', 1)[1].strip()
        image_urls.append(url)
    else:
        image_urls.append(line.strip())

print(f"Loaded {len(image_urls)} image URLs from names.txt")

for lang in ['en', 'jp', 'kr', 'zh']:
    fname = f'attractions_{lang}.json'
    with open(fname, 'r', encoding='utf-8') as f:
        data = json.load(f)

    replaced_named = 0
    replaced_else = 0

    for i, attraction in enumerate(data):
        if i < len(image_urls):
            attraction['image'] = image_urls[i]
            replaced_named += 1
        else:
            attraction['image'] = 'else.png'
            replaced_else += 1

    with open(fname, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"{lang}: {replaced_named} replaced with names.txt URLs, {replaced_else} replaced with else.png")

print("Done!")
