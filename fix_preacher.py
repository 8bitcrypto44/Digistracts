"""Re-extract preacher with edge flood-fill so white robes stay opaque."""
from pathlib import Path
import base64
import io
import json
import re
from collections import deque
from PIL import Image

ROOT = Path(__file__).resolve().parent


def flood_key_background(img, thresh=248):
    """Make near-white background transparent via edge flood-fill only."""
    im = img.convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_bg(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and r >= thresh and g >= thresh and b >= thresh

    seen = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))
    return im


def harden_robes(im):
    """Nudge remaining pure white robe pixels slightly off-white so they never
    get treated as chroma-key again, while staying readable as white cloth."""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if r >= 250 and g >= 250 and b >= 250:
                px[x, y] = (245, 245, 248, 255)
    return im


def to_data_uri(im, fmt="PNG", **kw):
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kw)
    mime = "image/png" if fmt == "PNG" else "image/webp"
    return "data:%s;base64,%s" % (mime, base64.b64encode(buf.getvalue()).decode("ascii"))


src = Image.open(ROOT / "assets" / "preacher.png")
cut = flood_key_background(src, thresh=248)
bbox = cut.getbbox()
if not bbox:
    raise SystemExit("preacher vanished after keying")
cut = cut.crop(bbox)
cut = harden_robes(cut)

# Higher-res game sprite (was 28x56 and lost robe fill)
nh = 96
nw = max(24, round(cut.width * (nh / cut.height)))
sprite = cut.resize((nw, nh), Image.Resampling.NEAREST)
sprite = harden_robes(sprite)

out = ROOT / "assets" / "sprites" / "preacher.png"
sprite.save(out, optimize=True)
print("wrote", out, sprite.size)

uri = to_data_uri(sprite, optimize=True)

# Update uris.json if present
uris_path = ROOT / "assets" / "sprites" / "uris.json"
if uris_path.exists():
    data = json.loads(uris_path.read_text(encoding="utf-8"))
    # store raw base64 without data: prefix for export_embed compatibility
    data["preacher"] = uri.split(",", 1)[1]
    uris_path.write_text(json.dumps(data), encoding="utf-8")
    print("updated uris.json")

# Patch embed.js preacher string in place
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

# Also fix extract_sprites.py so future runs don't punch holes in robes
extract = ROOT / "extract_sprites.py"
if extract.exists():
    txt = extract.read_text(encoding="utf-8")
    old = '''preacher = Image.open("assets/preacher.png").convert("RGBA")
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
print("preacher", preacher_s.size)'''
    new = '''# Preacher has white robes — never chroma-key all whites. Use edge flood-fill.
from collections import deque as _deque
preacher = Image.open("assets/preacher.png").convert("RGBA")
_px = preacher.load()
_pw, _ph = preacher.size
def _is_bg(x, y, t=248):
    r, g, b, a = _px[x, y]
    return a > 0 and r >= t and g >= t and b >= t
_seen = [[False] * _pw for _ in range(_ph)]
_q = _deque()
for _x in range(_pw):
    for _y in (0, _ph - 1):
        if _is_bg(_x, _y) and not _seen[_y][_x]:
            _seen[_y][_x] = True; _q.append((_x, _y))
for _y in range(_ph):
    for _x in (0, _pw - 1):
        if _is_bg(_x, _y) and not _seen[_y][_x]:
            _seen[_y][_x] = True; _q.append((_x, _y))
while _q:
    _x, _y = _q.popleft()
    _px[_x, _y] = (0, 0, 0, 0)
    for _nx, _ny in ((_x + 1, _y), (_x - 1, _y), (_x, _y + 1), (_x, _y - 1)):
        if 0 <= _nx < _pw and 0 <= _ny < _ph and not _seen[_ny][_nx] and _is_bg(_nx, _ny):
            _seen[_ny][_nx] = True; _q.append((_nx, _ny))
for _y in range(_ph):
    for _x in range(_pw):
        r, g, b, a = _px[_x, _y]
        if a >= 8 and r >= 250 and g >= 250 and b >= 250:
            _px[_x, _y] = (245, 245, 248, 255)
bbox = preacher.getbbox()
preacher = preacher.crop(bbox)
nh = 96
nw = max(24, int(preacher.width * nh / preacher.height))
preacher_s = preacher.resize((nw, nh), Image.NEAREST)
preacher_s.save("assets/sprites/preacher.png", optimize=True)
buf = io.BytesIO()
preacher_s.save(buf, format="PNG", optimize=True)
preacher_uri = base64.b64encode(buf.getvalue()).decode("ascii")
print("preacher", preacher_s.size)'''
    if old in txt:
        extract.write_text(txt.replace(old, new), encoding="utf-8")
        print("patched extract_sprites.py")
    else:
        print("extract_sprites.py pattern not exact — left unchanged")
