"""Re-extract preacher keeping white robes opaque.

White robe panels connect to the white floor, so a plain edge flood-fill
eats holes in the lower body. Instead we:
  1) seed a character mask from non-white / warm-cream pixels
  2) mark true background as near-white reachable from the image edge
  3) grow the mask into interior whites that are not background
  4) reclaim near-white between left/right character extents per row
  5) harden remaining pure whites to cream and close small gaps
"""
from pathlib import Path
import base64
import io
import json
import re
from collections import deque
from PIL import Image

ROOT = Path(__file__).resolve().parent
CREAM = (245, 242, 228, 255)


def near_white(r, g, b, t=248):
    return r >= t and g >= t and b >= t


def is_character_seed(r, g, b, a):
    if a < 8:
        return False
    if not near_white(r, g, b, 245):
        return True  # outline, folds, gold, skin, staff
    # Warm cream (mitre / cape / robe) — not neutral paper white
    return (max(r, g, b) - min(r, g, b)) >= 12 or (r + g) / 2 - b >= 10


def extract_preacher(src):
    im = src.convert("RGBA")
    w, h = im.size
    px = im.load()

    mask = [[False] * w for _ in range(h)]
    q = deque()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_character_seed(r, g, b, a):
                mask[y][x] = True
                q.append((x, y))

    # Near-white reachable from the border = paper background
    bg = [[False] * w for _ in range(h)]
    bq = deque()

    def is_amb_white(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and near_white(r, g, b, 248)

    for x in range(w):
        for y in (0, h - 1):
            if is_amb_white(x, y) and not bg[y][x]:
                bg[y][x] = True
                bq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_amb_white(x, y) and not bg[y][x]:
                bg[y][x] = True
                bq.append((x, y))
    while bq:
        x, y = bq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx] and is_amb_white(nx, ny):
                bg[ny][nx] = True
                bq.append((nx, ny))

    # Grow character into interior whites (not border-connected paper)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx]:
                r, g, b, a = px[nx, ny]
                if a > 0 and near_white(r, g, b, 245) and not bg[ny][nx]:
                    mask[ny][nx] = True
                    q.append((nx, ny))

    # Reclaim robe whites only on the LOWER body (hem→floor leak).
    # Doing this near the head fills the paper gap between mitre and staff.
    y0 = int(h * 0.48)
    for y in range(y0, h):
        xs = [x for x in range(w) if mask[y][x] and not near_white(*px[x, y][:3], 245)]
        if len(xs) < 2:
            xs = [x for x in range(w) if mask[y][x]]
        if len(xs) < 2:
            continue
        # Use body seeds only — ignore staff so we don't bridge the gap
        lo, hi = min(xs), max(xs)
        for x in range(lo, hi + 1):
            if mask[y][x]:
                continue
            r, g, b, a = px[x, y]
            if a > 0 and near_white(r, g, b, 240):
                mask[y][x] = True

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            if not mask[y][x]:
                continue
            r, g, b, a = px[x, y]
            if near_white(r, g, b, 250) and (max(r, g, b) - min(r, g, b)) <= 10:
                op[x, y] = CREAM
            else:
                op[x, y] = (r, g, b, 255)

    # Scrub any cream / near-white still connected to the image edge
    # (catches leftover paper blocks by the head without reopening robe holes).
    return scrub_edge_paper(out)


def scrub_edge_paper(im):
    """Make edge-connected cream/paper pixels transparent."""
    w, h = im.size
    px = im.load()
    seen = [[False] * w for _ in range(h)]
    q = deque()

    def is_paper(x, y):
        r, g, b, a = px[x, y]
        if a < 8:
            return False
        if near_white(r, g, b, 240):
            return True
        # our hardened cream
        return abs(r - CREAM[0]) <= 3 and abs(g - CREAM[1]) <= 3 and abs(b - CREAM[2]) <= 3

    for x in range(w):
        for y in (0, h - 1):
            if is_paper(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_paper(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_paper(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))
    return im


def fill_small_gaps(im, max_run=14):
    """Close short transparent runs between opaque pixels on the lower body only."""
    px = im.load()
    w, h = im.size
    for y in range(int(h * 0.48), h):
        x = 0
        while x < w:
            if px[x, y][3] >= 128:
                x += 1
                continue
            x0 = x
            while x < w and px[x, y][3] < 128:
                x += 1
            if x0 > 0 and x < w and (x - x0) <= max_run:
                for xx in range(x0, x):
                    px[xx, y] = CREAM
    return im


def to_data_uri(im, fmt="PNG", **kw):
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kw)
    mime = "image/png" if fmt == "PNG" else "image/webp"
    return "data:%s;base64,%s" % (mime, base64.b64encode(buf.getvalue()).decode("ascii"))


src = Image.open(ROOT / "assets" / "preacher.png")
cut = extract_preacher(src)
bbox = cut.getbbox()
if not bbox:
    raise SystemExit("preacher vanished after keying")
cut = cut.crop(bbox)

nh = 96
nw = max(24, round(cut.width * (nh / cut.height)))
sprite = cut.resize((nw, nh), Image.Resampling.NEAREST)
sprite = fill_small_gaps(sprite)

out = ROOT / "assets" / "sprites" / "preacher.png"
sprite.save(out, optimize=True)
print("wrote", out, sprite.size)

uri = to_data_uri(sprite, optimize=True)

uris_path = ROOT / "assets" / "sprites" / "uris.json"
if uris_path.exists():
    data = json.loads(uris_path.read_text(encoding="utf-8"))
    data["preacher"] = uri.split(",", 1)[1]
    uris_path.write_text(json.dumps(data), encoding="utf-8")
    print("updated uris.json")

embed_path = ROOT / "assets" / "sprites" / "embed.js"
embed = embed_path.read_text(encoding="utf-8")
embed2, n = re.subn(
    r'window\.DG_PREACHER\s*=\s*"[^"]*";',
    'window.DG_PREACHER = "%s";' % uri,
    embed,
    count=1,
)
if n != 1:
    raise SystemExit("failed to patch embed.js preacher")
embed_path.write_text(embed2, encoding="utf-8")
print("patched embed.js", n)
