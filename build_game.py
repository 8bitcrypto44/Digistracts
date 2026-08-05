from pathlib import Path
import base64
import io
import re
from rjsmin import jsmin
from mangle import mangle
from PIL import Image, ImageOps

css = Path("digistracts.css").read_text(encoding="utf-8")
css = re.sub(r"\s+", " ", css)
css = re.sub(r"\s*([{}:;,])\s*", r"\1", css).strip()


def data_uri(img, fmt="WEBP", **save_kw):
    buf = io.BytesIO()
    img.save(buf, format=fmt, **save_kw)
    mime = "image/webp" if fmt == "WEBP" else "image/png"
    return "data:%s;base64,%s" % (mime, base64.b64encode(buf.getvalue()).decode("ascii"))


def compress_robot(path):
    im = Image.open(path).convert("RGBA")
    # scrub near-white fringe from sheet cutouts
    px = im.getdata()
    cleaned = []
    for r, g, b, a in px:
        if a < 8 or (r > 235 and g > 235 and b > 235):
            cleaned.append((0, 0, 0, 0))
        else:
            cleaned.append((r, g, b, 255))
    im.putdata(cleaned)
    h = 40
    w = max(12, round(im.width * (h / im.height)))
    im = im.resize((w, h), Image.Resampling.NEAREST)
    return data_uri(im, quality=18, method=6)


# HQ cutouts from assets/robots.png (skip merged/wide frames)
robot_paths = sorted(Path("assets/sprites").glob("hq_*.png"))
pick = [0]  # one HQ robot to leave room for detailed pickups
robot_uris = [compress_robot(robot_paths[i]) for i in pick if i < len(robot_paths)]
if len(robot_uris) < 1:
    robot_paths = sorted(Path("assets/sprites").glob("robot_*.png"))
    robot_uris = [compress_robot(p) for p in robot_paths[1:3]]
embed_source = Path("assets/sprites/embed.js").read_text(encoding="utf-8")
# Replace robot array; keep preacher/QR from embed.js
embed_source = re.sub(
    r"window\.DG_ROBOTS\s*=\s*\[(.*?)\];",
    "window.DG_ROBOTS=[" + ",".join('"%s"' % u for u in robot_uris) + "];",
    embed_source,
    count=1,
    flags=re.S,
)
embed_source = re.sub(r'window\.DG_QR\s*=\s*"[^"]*";', 'window.DG_QR="";', embed_source)
embed = jsmin(embed_source)
js = jsmin(mangle(Path("digistracts.js").read_text(encoding="utf-8")))

# Hosted full-res backgrounds (Postimg). 6 slots: levels 1-5 + boss (reuse #5).
BG_URLS = [
    "https://i.postimg.cc/y6mvPnqs/level-1.jpg",
    "https://i.postimg.cc/446B5wCg/level-2.jpg",
    "https://i.postimg.cc/tJNk4Rdm/level-3.jpg",
    "https://i.postimg.cc/BZTMgNWG/level-4.jpg",
    "https://i.postimg.cc/XNfQ8xM3/level-5.jpg",
    "https://i.postimg.cc/DfrBg5Vk/boss.jpg",
]
background_embed = "window.DG_BACKGROUNDS=[" + ",".join('"%s"' % u for u in BG_URLS) + "];"

markup = (
    "<!-- DIGISTRACTS by 8bitcrypto_44 — paste this entire block into a GoDaddy Website Builder HTML section -->\n"
    "<style>\n"
    + css
    + "\n</style>\n"
    """<div id="digistracts-root">
  <div class="dg-top">
    <div class="dg-brand">DIGISTRACTS <span>by 8bitcrypto_44</span></div>
    <div class="dg-hud">
      <div>SCORE <b id="dg-score">000000</b></div>
      <div>LIVES <b id="dg-lives">♥♥♥</b></div>
      <div>AIR SUPER <b id="dg-super">2</b></div>
      <div>GUN <b id="dg-gun">PISTOL</b></div>
      <div>TIME <b id="dg-time">120</b></div>
      <div><b id="dg-level">LV 1</b></div>
    </div>
    <div class="dg-audio">
      <label for="dg-vol">VOL</label>
      <input id="dg-vol" type="range" min="0" max="1" step="0.01" value="0.35" aria-label="Volume">
      <button type="button" id="dg-mute" aria-pressed="false">MUTE</button>
    </div>
  </div>
  <div class="dg-stage">
    <canvas id="dg-canvas" width="800" height="450" aria-label="Digistracts game canvas"></canvas>
    <div id="dg-msg">NEON DOCKS</div>
  </div>
  <div id="dg-overlay">
    <h2 id="dg-title">DIGISTRACTS</h2>
    <p id="dg-sub">by 8bitcrypto_44</p>
    <button type="button" id="dg-start">PRESS START</button>
  </div>
  <div class="dg-controls" aria-label="Touch controls">
    <div id="dg-stick" class="dg-stick" aria-label="Move joystick"><div id="dg-knob" class="dg-knob"></div></div>
    <div class="dg-actions">
      <button type="button" id="dg-jump">JUMP</button>
      <button type="button" id="dg-shoot">FIRE</button>
    </div>
  </div>
  <div class="dg-help" aria-label="Keyboard controls">
    <span><kbd>←→</kbd>/<kbd>AD</kbd> Move</span>
    <span><kbd>↑↓</kbd> Aim</span>
    <span><kbd>SPACE</kbd> Jump · ×2 Super</span>
    <span><kbd>Z</kbd>/<kbd>X</kbd>/<kbd>CTRL</kbd> Fire</span>
  </div>
</div>
<script>
"""
    + background_embed
    + "\n"
    + embed
    + "\n"
    + js
    + "\n</script>\n"
)
markup = re.sub(r"<!--.*?-->\s*", "", markup, flags=re.S)
markup = re.sub(r">\s+<", "><", markup).strip()

Path("digistracts_godaddy_block.html").write_text(markup, encoding="utf-8")

preview = (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
    "<meta charset=\"UTF-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no\">\n"
    "<title>Digistracts by 8bitcrypto_44</title>\n"
    "<style>body{margin:0;background:#020617;padding:16px}@media(max-width:700px){body{padding:0!important}}</style>\n"
    "</head>\n<body>\n"
    + markup
    + "\n</body>\n</html>\n"
)

Path("index.html").write_text(preview, encoding="utf-8")

readme = """# Digistracts by 8bitcrypto_44

Contra-style 8-bit HTML side-scroller for GoDaddy Website Builder.

## Play locally
Open `index.html` in a browser.

## GoDaddy install
1. Open Website Builder → add an **HTML** section/block.
2. Paste the **entire** contents of `digistracts_godaddy_block.html`.
3. Publish / preview.
4. Click the page once if music is blocked (browser autoplay rules).

## Controls
- **PC:** Left/Right or A/D move • Space jumps • Up/W and Down/S aim • FIRE shoots in the aimed direction • double-tap Space for up to 2 airborne boosts
- **Phone:** On-screen joystick to move/aim • JUMP • FIRE; double-tap JUMP for up to 2 airborne boosts
- Volume slider + MUTE / UNMUTE

## Features
- Preacher shoots staff magic at robots (your reference art)
- Five original level backgrounds: two neon streets, data tunnel, skyscraper rooftops, and core sewers
- Articulated walking robots plus flying robot enemies
- 5 levels with sharply rising robot counts and difficulty
- Mario-style rules: reach each level's EXIT door before the 2-minute timer expires
- Timing out costs a life and restarts the current level; remaining time awards bonus points
- Levels include cliffs, holes, and safe pre-hole respawning
- Increasing robot and drone counts, movement speed, and drone frequency every level
- Final warehouse boss: telegraphed green lasers, forward jumps, two phases, health bar, MAXI gun supply cache, and extra shield health
- Three gun upgrades per level: RIFLE, SPREAD, and MAXI beams with 5 seconds of firing fuel
- Default pistol fires three bullet bursts once per FIRE press; holding FIRE works only with special guns
- Up/W aims upward instead of jumping; upward shots and special laser fans can hit aerial enemies
- Jump to collect QR codes for points
- 3 lives
- Procedural techno soundtrack
"""
Path("README.md").write_text(readme, encoding="utf-8")
print("godaddy block", Path("digistracts_godaddy_block.html").stat().st_size)
print("index", Path("index.html").stat().st_size)
