from PIL import Image, ImageDraw
import os, json, base64, io

os.makedirs("assets/sprites", exist_ok=True)


def compact_png(image):
    """Palette-compress tiny pixel sprites while preserving transparency."""
    return image.quantize(colors=32, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)


robots = Image.open("assets/robots.png").convert("RGBA")
px = robots.load()
w, h = robots.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if r > 245 and g > 245 and b > 245:
            px[x, y] = (0, 0, 0, 0)


def find_blobs(img, min_area=80):
    iw, ih = img.size
    p = img.load()
    visited = [[False] * iw for _ in range(ih)]
    blobs = []
    for y in range(ih):
        for x in range(iw):
            if visited[y][x] or p[x, y][3] < 20:
                continue
            stack = [(x, y)]
            visited[y][x] = True
            minx = maxx = x
            miny = maxy = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                if cx < minx:
                    minx = cx
                if cx > maxx:
                    maxx = cx
                if cy < miny:
                    miny = cy
                if cy > maxy:
                    maxy = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < iw and 0 <= ny < ih and not visited[ny][nx] and p[nx, ny][3] >= 20:
                        visited[ny][nx] = True
                        stack.append((nx, ny))
            if area >= min_area:
                blobs.append((minx, miny, maxx, maxy, area))
    blobs.sort(key=lambda b: (b[1] // 50, b[0]))
    return blobs


blobs = find_blobs(robots)
print("found", len(blobs), "robot blobs")
robot_uris = []
for i, (minx, miny, maxx, maxy, area) in enumerate(blobs):
    pad = 2
    crop = robots.crop((max(0, minx - pad), max(0, miny - pad), min(w, maxx + 1 + pad), min(h, maxy + 1 + pad)))
    nh = 48
    nw = max(12, int(crop.width * nh / crop.height))
    crop = crop.resize((nw, nh), Image.NEAREST)
    path = f"assets/sprites/robot_{i:02d}.png"
    crop = compact_png(crop)
    crop.save(path, optimize=True)
    buf = io.BytesIO()
    crop.save(buf, format="PNG", optimize=True)
    robot_uris.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    print(i, crop.size, area)

preacher = Image.open("assets/preacher.png").convert("RGBA")
px = preacher.load()
pw, ph = preacher.size
for y in range(ph):
    for x in range(pw):
        r, g, b, a = px[x, y]
        if r > 245 and g > 245 and b > 245:
            px[x, y] = (0, 0, 0, 0)
bbox = preacher.getbbox()
preacher = preacher.crop(bbox)
nh = 56
nw = max(16, int(preacher.width * nh / preacher.height))
preacher_s = preacher.resize((nw, nh), Image.NEAREST)
preacher_s = compact_png(preacher_s)
preacher_s.save("assets/sprites/preacher.png", optimize=True)
buf = io.BytesIO()
preacher_s.save(buf, format="PNG", optimize=True)
preacher_uri = base64.b64encode(buf.getvalue()).decode("ascii")
print("preacher", preacher_s.size)

qr = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
d = ImageDraw.Draw(qr)
d.rectangle([0, 0, 15, 15], fill=(20, 240, 255, 255), outline=(0, 0, 0, 255))
pattern = [
    "########",
    "#......#",
    "#.#.##.#",
    "#.#.##.#",
    "#......#",
    "#.##.#.#",
    "#.#..#.#",
    "########",
]
for yy, row in enumerate(pattern):
    for xx, ch in enumerate(row):
        color = (0, 0, 0, 255) if ch == "#" else (255, 255, 255, 255)
        d.point((4 + xx, 4 + yy), fill=color)
qr = compact_png(qr)
buf = io.BytesIO()
qr.save(buf, format="PNG", optimize=True)
qr_uri = base64.b64encode(buf.getvalue()).decode("ascii")
qr.save("assets/sprites/qr.png")

with open("assets/sprites/uris.json", "w") as f:
    json.dump({"preacher": preacher_uri, "robots": robot_uris, "qr": qr_uri}, f)
print("uris written robots", len(robot_uris))
