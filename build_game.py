from pathlib import Path
import base64
import io
import re
from rjsmin import jsmin
from mangle import mangle
from PIL import Image

css = Path("digistracts.css").read_text(encoding="utf-8")
css = re.sub(r"\s+", " ", css)
css = re.sub(r"\s*([{}:;,])\s*", r"\1", css).strip()


def data_uri(img, fmt="WEBP", **save_kw):
    buf = io.BytesIO()
    img.save(buf, format=fmt, **save_kw)
    mime = "image/webp" if fmt == "WEBP" else "image/png"
    return "data:%s;base64,%s" % (mime, base64.b64encode(buf.getvalue()).decode("ascii"))


def compress_robot(path, height=72):
    im = Image.open(path).convert("RGBA")
    px = im.getdata()
    cleaned = []
    for r, g, b, a in px:
        if a < 8 or (r > 235 and g > 235 and b > 235) or (r < 8 and g < 8 and b < 8 and a > 200):
            cleaned.append((0, 0, 0, 0))
        else:
            cleaned.append((r, g, b, 255))
    im.putdata(cleaned)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    h = height
    w = max(16, round(im.width * (h / im.height)))
    im = im.resize((w, h), Image.Resampling.NEAREST)
    return data_uri(im, quality=62, method=6)


def compress_platform(path, height=56):
    im = Image.open(path).convert("RGBA")
    px = im.getdata()
    cleaned = []
    for r, g, b, a in px:
        if a < 10:
            cleaned.append((0, 0, 0, 0))
        else:
            cleaned.append((r, g, b, 255 if a > 200 else a))
    im.putdata(cleaned)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    h = height
    w = max(48, round(im.width * (h / im.height)))
    im = im.resize((w, h), Image.Resampling.NEAREST)
    return data_uri(im, quality=72, method=6)


def compress_boss(path, height=158):
    im = Image.open(path).convert("RGBA")
    px = im.getdata()
    cleaned = []
    for r, g, b, a in px:
        if a < 10:
            cleaned.append((0, 0, 0, 0))
        else:
            cleaned.append((r, g, b, 255 if a > 200 else a))
    im.putdata(cleaned)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    h = height
    w = max(48, round(im.width * (h / im.height)))
    im = im.resize((w, h), Image.Resampling.NEAREST)
    return data_uri(im, quality=78, method=6)


# Prefer split singles (hq_01a/b); skip the dual hq_01 frame
robot_paths = []
for p in sorted(Path("assets/sprites").glob("hq_*.png")):
    if p.stem == "hq_01":
        continue
    robot_paths.append(p)
robot_uris = [compress_robot(p) for p in robot_paths]
if len(robot_uris) < 4:
    robot_paths = sorted(Path("assets/sprites").glob("robot_*.png"))
    robot_uris = [compress_robot(p, height=56) for p in robot_paths if p.stem != "robot_15"]

platform_paths = [
    Path("assets/sprites/platform_a_game.png"),
    Path("assets/sprites/platform_b_game.png"),
]
# Fall back to originals if game crops missing
platform_paths = [p if p.exists() else Path(str(p).replace("_game", "")) for p in platform_paths]
platform_uris = [compress_platform(p) for p in platform_paths if p.exists()]

boss_path = Path("assets/sprites/boss_redcore_game.png")
if not boss_path.exists():
    boss_path = Path("assets/sprites/boss_redcore.png")
boss_uri = compress_boss(boss_path) if boss_path.exists() else ""

boss_mid_path = Path("assets/sprites/boss_pulse_game.png")
if not boss_mid_path.exists():
    boss_mid_path = Path("assets/sprites/boss_pulse.png")
boss_mid_uri = compress_boss(boss_mid_path, height=158) if boss_mid_path.exists() else ""

# Skeletal parts (from split_boss_parts.py)
import json as _json
import subprocess as _subprocess
_parts_json = Path("assets/sprites/boss_parts.json")
if not _parts_json.exists():
    try:
        _subprocess.check_call(["python", "split_boss_parts.py"], cwd=str(Path(".").resolve()))
    except Exception:
        pass
boss_parts_obj = _json.loads(_parts_json.read_text(encoding="utf-8")) if _parts_json.exists() else None
boss_parts_js = _json.dumps(boss_parts_obj) if boss_parts_obj else "null"

embed_source = Path("assets/sprites/embed.js").read_text(encoding="utf-8")
embed_source = re.sub(
    r"window\.DG_ROBOTS\s*=\s*\[(.*?)\];",
    "window.DG_ROBOTS=[" + ",".join('"%s"' % u for u in robot_uris) + "];",
    embed_source,
    count=1,
    flags=re.S,
)
embed_source = re.sub(
    r"window\.DG_PLATFORMS\s*=\s*\[(.*?)\];",
    "window.DG_PLATFORMS=[" + ",".join('"%s"' % u for u in platform_uris) + "];",
    embed_source,
    count=1,
    flags=re.S,
)
embed_source = re.sub(
    r'window\.DG_BOSS\s*=\s*"[^"]*";',
    'window.DG_BOSS="%s";' % boss_uri,
    embed_source,
    count=1,
)
if "window.DG_BOSS_MID" not in embed_source:
    embed_source = embed_source.replace("window.DG_BOSS=", "window.DG_BOSS_MID=\"\";\nwindow.DG_BOSS=", 1)
embed_source = re.sub(
    r'window\.DG_BOSS_MID\s*=\s*"[^"]*";',
    'window.DG_BOSS_MID="%s";' % boss_mid_uri,
    embed_source,
    count=1,
)
if "window.DG_BOSS_PARTS" not in embed_source:
    embed_source = embed_source.replace(
        "window.DG_BOSS_MID=",
        "window.DG_BOSS_PARTS=null;\nwindow.DG_BOSS_MID=",
        1,
    )
if re.search(r"window\.DG_BOSS_PARTS\s*=", embed_source):
    embed_source = re.sub(
        r"window\.DG_BOSS_PARTS\s*=\s*null\s*;",
        "window.DG_BOSS_PARTS=%s;" % boss_parts_js,
        embed_source,
        count=1,
    )
    if "window.DG_BOSS_PARTS=null" in embed_source or re.search(
        r"window\.DG_BOSS_PARTS\s*=\s*null", embed_source
    ):
        # still null — force replace first assignment
        embed_source = embed_source.replace(
            "window.DG_BOSS_PARTS=null;",
            "window.DG_BOSS_PARTS=%s;" % boss_parts_js,
            1,
        )
else:
    embed_source = "window.DG_BOSS_PARTS=%s;\n" % boss_parts_js + embed_source
embed_source = re.sub(r'window\.DG_QR\s*=\s*"[^"]*";', 'window.DG_QR="";', embed_source)
embed = jsmin(embed_source)
print("robots embedded", len(robot_uris), "from", [p.name for p in robot_paths])
print("platforms embedded", len(platform_uris), "from", [p.name for p in platform_paths if p.exists()])
print("boss embedded", bool(boss_uri), boss_path.name if boss_path.exists() else "missing")
print("mid boss embedded", bool(boss_mid_uri), boss_mid_path.name if boss_mid_path.exists() else "missing")
print("boss parts embedded", bool(boss_parts_obj))
js = jsmin(mangle(Path("digistracts.js").read_text(encoding="utf-8")))

# Hosted full-res backgrounds (Postimg). 6 slots: levels 1-5 + boss.
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
    "<!-- DIGISTRACTS by 8bitcrypto_44 -->\n"
    "<style>\n"
    + css
    + "\n</style>\n"
    """<div id="digistracts-root">
  <div class="dg-top">
    <div class="dg-brand">DIGISTRACTS <span>by 8bitcrypto_44</span></div>
    <div class="dg-hud">
      <div>SCORE <b id="dg-score">000000</b></div>
      <div>LIVES <b id="dg-lives">♥♥♥</b></div>
      <div>WEAPON <b id="dg-gun">PISTOL</b></div>
      <div class="dg-combo">COMBO <b id="dg-combo">×0</b></div>
      <div>TIME <b id="dg-time">120</b></div>
      <div><b id="dg-level">LV 1</b></div>
      <div class="dg-hi">HI <b id="dg-hi">000000</b></div>
      <div class="dg-air">AIR <b id="dg-super">2</b></div>
    </div>
    <div class="dg-audio">
      <label for="dg-vol">VOL</label>
      <input id="dg-vol" type="range" min="0" max="1" step="0.01" value="0.35" aria-label="Volume">
      <button type="button" id="dg-mute" aria-pressed="false">MUTE</button>
      <button type="button" id="dg-fx" aria-pressed="true" title="Screen shake / hit-stop">FX: ON</button>
      <button type="button" id="dg-pause" aria-pressed="false">PAUSE</button>
      <button type="button" id="dg-fs" aria-pressed="false">FS</button>
    </div>
  </div>
  <div class="dg-stage">
    <canvas id="dg-canvas" width="800" height="450" aria-label="Digistracts game canvas"></canvas>
    <div id="dg-msg">NEON DOCKS</div>
    <div class="dg-controls" aria-label="Touch controls">
      <div id="dg-stick" class="dg-stick" aria-label="Move joystick"><div id="dg-knob" class="dg-knob"></div></div>
      <div class="dg-actions">
        <button type="button" id="dg-jump">JUMP</button>
        <button type="button" id="dg-shoot">FIRE</button>
        <button type="button" id="dg-swap">SWAP</button>
      </div>
    </div>
  </div>
  <div id="dg-overlay">
    <h2 id="dg-title">DIGISTRACTS</h2>
    <p id="dg-sub">by 8bitcrypto_44</p>
    <div id="dg-medals" class="dg-medals" aria-live="polite"></div>
    <div class="dg-menu-actions">
      <button type="button" id="dg-diff">DIFF: NORMAL</button>
      <button type="button" id="dg-assist" aria-pressed="true">AIM: ON</button>
      <button type="button" id="dg-ng" style="display:none">NG+</button>
      <button type="button" id="dg-daily">DAILY</button>
      <button type="button" id="dg-god" aria-pressed="false">GOD: OFF</button>
      <button type="button" id="dg-start">PRESS START</button>
      <button type="button" id="dg-share" style="display:none">COPY SCORE</button>
    </div>
    <div id="dg-levels" class="dg-levels" aria-label="Level select"></div>
  </div>
  <div class="dg-help" aria-label="Keyboard controls">
    <span><kbd>&larr;&rarr;</kbd>/<kbd>AD</kbd> Move</span>
    <span><kbd>&uarr;&darr;</kbd> Aim</span>
    <span><kbd>SPACE</kbd> Jump · ×2 Super</span>
    <span><kbd>Z</kbd>/<kbd>X</kbd> Fire · hold charge</span>
    <span><kbd>Q</kbd>/<kbd>Tab</kbd> Swap gun</span>
    <span><kbd>P</kbd>/<kbd>ESC</kbd> Pause</span>
    <span><kbd>R</kbd> Retry sector</span>
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

ASSET_V = "49"
PAGES_URL = "https://8bitcrypto44.github.io/Digistracts/"
iframe_src_attr = PAGES_URL + "?embed=1&amp;v=" + ASSET_V
cover_imgs = BG_URLS[:4]

preview = (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
    "<meta charset=\"UTF-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no\">\n"
    "<title>Digistracts by 8bitcrypto_44</title>\n"
    "<style>"
    "html,body{margin:0;background:#020617;height:100%}"
    "body{padding:16px}"
    "html.dg-embed,body.dg-embed{padding:0!important;height:100%;overflow:hidden}"
    "body.dg-embed #digistracts-root{max-width:none;width:100%;height:100%;min-height:100vh;min-height:100dvh;margin:0;border-radius:0;border-left:0;border-right:0;display:flex;flex-direction:column;overflow:hidden}"
    "@media(max-width:700px){body{padding:0!important}}"
    "</style>\n"
    "</head>\n<body>\n"
    + markup
    + "\n</body>\n</html>\n"
)
Path("index.html").write_text(preview, encoding="utf-8", newline="\n")

iframe_snippet = f"""<!-- Digistracts / GoDaddy: cover card -> expand on PLAY -->
<style>
.dg-gd{{box-sizing:border-box;width:100%;max-width:920px;margin:0 auto;font-family:"Courier New",Courier,monospace;color:#e2e8f0}}
.dg-gd *{{box-sizing:border-box}}
.dg-gd-card{{
  border:4px solid #00e5ff;border-radius:12px;padding:10px;overflow:hidden;
  background:linear-gradient(180deg,#05070f,#101828 55%,#070b14);
  box-shadow:0 0 24px rgba(0,229,255,.28),0 12px 28px rgba(0,0,0,.45)
}}
.dg-gd-top{{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}}
.dg-gd-brand{{font-size:15px;letter-spacing:1px;color:#ffd400;font-weight:700}}
.dg-gd-brand span{{color:#00e5ff;font-weight:400;font-size:13px}}
.dg-gd-stage{{position:relative;width:100%;aspect-ratio:16/9;background:#05070f;border:2px solid #1e3a5f;border-radius:8px;overflow:hidden}}
.dg-gd-cover{{position:absolute;inset:0;transition:opacity .55s ease}}
.dg-gd-hero{{position:absolute;inset:0;background:#05070f}}
.dg-gd-hero img{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 1.1s ease}}
.dg-gd-hero img.is-on{{opacity:1}}
@keyframes dgTrail{{0%,100%{{opacity:.92}}50%{{opacity:1}}}}
.dg-gd.is-trailer .dg-gd-veil{{animation:dgTrail 2.4s ease-in-out infinite}}
.dg-gd-veil{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;background:linear-gradient(180deg,rgba(5,7,15,.35) 0%,rgba(5,7,15,.78) 45%,rgba(2,6,23,.94) 100%)}}
.dg-gd-title{{margin:0;font-size:clamp(26px,5vw,40px);font-weight:700;letter-spacing:2px;color:#ffd400;text-shadow:0 0 18px rgba(255,43,214,.45),3px 3px 0 #05070f;line-height:1.1}}
.dg-gd-tag{{margin:0;font-size:clamp(13px,2.8vw,15px);color:#e2e8f0;letter-spacing:.2px;max-width:28em;line-height:1.45}}
.dg-gd-tip{{margin:0;font-size:clamp(12px,2.4vw,14px);color:#67e8f9;letter-spacing:.2px;max-width:28em;line-height:1.4}}
.dg-gd-promo{{margin:0;font-size:12px;color:#94a3b8;max-width:32em;line-height:1.4}}
.dg-gd.is-fading .dg-gd-cover{{opacity:0}}
.dg-gd-enter{{appearance:none;border:3px solid #00e5ff;border-radius:10px;padding:12px 28px;font:700 16px "Courier New",Courier,monospace;letter-spacing:.3px;cursor:pointer;color:#05070f;background:linear-gradient(180deg,#00e5ff,#0b8de0);box-shadow:0 0 18px rgba(0,229,255,.35),0 4px 0 #062033;transition:transform .12s,box-shadow .12s}}
.dg-gd-enter:hover{{transform:translateY(-2px) scale(1.03);box-shadow:0 0 26px rgba(255,43,214,.45),0 6px 0 #062033}}
.dg-gd-enter:active{{transform:scale(.98)}}
.dg-gd-play{{display:none;position:absolute;inset:0;background:#020617;line-height:0}}
.dg-gd-play iframe{{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#020617}}
.dg-gd-load{{
  display:none;position:absolute;inset:0;z-index:15;align-items:center;justify-content:center;
  background:rgba(2,6,23,.92);color:#00e5ff;font:700 16px "Courier New",Courier,monospace;
  letter-spacing:.3px;text-align:center;padding:20px
}}
.dg-gd.is-loading .dg-gd-load{{display:flex}}
.dg-gd.is-open .dg-gd-cover{{display:none}}
.dg-gd.is-open .dg-gd-play{{display:block}}
.dg-gd.is-open.is-land,
.dg-gd.is-fs-mode{{
  position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;
  inset:0!important;width:100vw!important;width:100dvw!important;height:100vh!important;height:100dvh!important;
  max-width:none!important;margin:0!important;padding:0!important;
  z-index:2147483646!important;background:#020617!important;
  transform:none!important;filter:none!important;perspective:none!important
}}
.dg-gd.is-open.is-land .dg-gd-card,
.dg-gd.is-fs-mode .dg-gd-card{{
  height:100%!important;width:100%!important;max-width:none!important;border:0!important;border-radius:0!important;padding:0!important;box-shadow:none!important;
  display:flex!important;flex-direction:column!important;background:#020617!important
}}
.dg-gd.is-open.is-land .dg-gd-top,
.dg-gd.is-fs-mode .dg-gd-top{{display:none!important}}
.dg-gd.is-open.is-land .dg-gd-stage,
.dg-gd.is-fs-mode .dg-gd-stage{{
  flex:1!important;min-height:0!important;aspect-ratio:auto!important;height:auto!important;border:0!important;border-radius:0!important
}}
.dg-gd.is-fs-mode .dg-gd-play iframe{{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}}
/* Phone portrait open: still expand to a tall play shell (not trapped 16:9 card) */
.dg-gd.is-open.is-phone:not(.is-fs-mode):not(.is-land){{
  position:fixed!important;inset:0!important;width:100vw!important;width:100dvw!important;
  height:100vh!important;height:100dvh!important;max-width:none!important;margin:0!important;z-index:2147483645!important;
  background:#020617!important;padding:0!important
}}
.dg-gd.is-open.is-phone:not(.is-fs-mode):not(.is-land) .dg-gd-card{{
  height:100%!important;border:0!important;border-radius:0!important;padding:0!important;box-shadow:none!important;
  display:flex!important;flex-direction:column!important
}}
.dg-gd.is-open.is-phone:not(.is-fs-mode):not(.is-land) .dg-gd-top{{display:none!important}}
.dg-gd.is-open.is-phone:not(.is-fs-mode):not(.is-land) .dg-gd-stage{{
  flex:1!important;min-height:0!important;aspect-ratio:auto!important;height:auto!important;border:0!important;border-radius:0!important
}}
/* GoDaddy traps fixed positioning via parent transforms — JS moves #dg-gd onto document.body.
   Native fullscreen is requested on the iframe element so in-game clicks do not cancel it. */
@media (max-width:700px){{
  .dg-gd-card{{padding:4px;border-width:2px}}
  .dg-gd-top{{margin-bottom:4px}}
  .dg-gd-brand{{font-size:13px}}
  .dg-gd-enter{{padding:14px 22px;min-height:48px;width:min(100%,280px);font-size:16px}}
  .dg-gd-title{{font-size:clamp(28px,9vw,44px)}}
  .dg-gd-tip{{font-size:13px}}
}}
</style>
<div class="dg-gd" id="dg-gd">
  <div class="dg-gd-card">
    <div class="dg-gd-top">
      <div class="dg-gd-brand">DIGISTRACTS <span>by 8bitcrypto_44</span></div>
    </div>
    <div class="dg-gd-stage">
      <div class="dg-gd-cover">
        <div class="dg-gd-hero" id="dg-gd-hero" aria-hidden="true">
          <img class="is-on" src="{cover_imgs[0]}" alt="" width="920" height="518" decoding="async">
          <img src="{cover_imgs[1]}" alt="" width="920" height="518" decoding="async">
          <img src="{cover_imgs[2]}" alt="" width="920" height="518" decoding="async">
          <img src="{cover_imgs[3]}" alt="" width="920" height="518" decoding="async">
        </div>
        <div class="dg-gd-veil">
          <h2 class="dg-gd-title">DIGISTRACTS</h2>
          <p class="dg-gd-tag">Neon streets · Robot hunters · Staff magic · Boss core</p>
          <p class="dg-gd-tip">Play → PRESS START · Phone: fullscreen + stick / JUMP / FIRE</p>
          <button type="button" class="dg-gd-enter" id="dg-gd-enter" aria-expanded="false">PLAY DIGISTRACTS</button>
          <p class="dg-gd-promo">Also: Primal Odyssey · Thank You For Your Service kids books</p>
        </div>
      </div>
      <div class="dg-gd-play" id="dg-gd-play">
        <div class="dg-gd-load" id="dg-gd-load" aria-live="polite">Loading Digistracts…</div>
        <iframe
          id="dg-gd-frame"
          title="Digistracts"
          width="100%"
          height="450"
          data-src="{iframe_src_attr}"
          allow="autoplay; fullscreen; gamepad"
          allowfullscreen
          scrolling="no"
          referrerpolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>
    </div>
  </div>
</div>
<script>
(function(){{
  var root=document.getElementById("dg-gd");
  var btn=document.getElementById("dg-gd-enter");
  var frame=document.getElementById("dg-gd-frame");
  if(!root||!btn||!frame)return;
  var playing=false;
  var baseSrc="{iframe_src_attr}".replace(/&amp;/g,"&");
  function phone(){{
    try{{
      if(window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(pointer: coarse)").matches)return false;
    }}catch(e){{}}
    return (("ontouchstart" in window)||(navigator.maxTouchPoints>0)) && !!(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches);
  }}
  function land(){{
    if(window.matchMedia&&window.matchMedia("(orientation: landscape)").matches)return true;
    return window.innerWidth>window.innerHeight;
  }}
  function isFs(){{
    return root.classList.contains("is-fs-mode") ||
      !!(document.fullscreenElement||document.webkitFullscreenElement);
  }}
  function syncFsClass(){{
    root.classList.toggle("is-fs", root.classList.contains("is-fs-mode"));
  }}
  function syncLand(){{
    var onPhone=phone();
    root.classList.toggle("is-phone", onPhone && root.classList.contains("is-open"));
    root.classList.toggle("is-land", root.classList.contains("is-open") && playing && onPhone && land());
    syncFsClass();
  }}
  function notifyFrame(){{
    try{{
      if(frame.contentWindow)frame.contentWindow.postMessage({{type:"dg-fs-state",active:isFs()}},"*");
    }}catch(e){{}}
  }}
  function restoreLayout(){{
    // Browsers leave oversized inline styles on an iframe after native fullscreen exits.
    root.classList.remove("is-fs-mode","is-fs");
    root.style.cssText="";
    var card=root.querySelector(".dg-gd-card");
    var stage=root.querySelector(".dg-gd-stage");
    var top=root.querySelector(".dg-gd-top");
    if(card)card.style.cssText="";
    if(stage)stage.style.cssText="";
    if(top)top.style.cssText="";
    frame.removeAttribute("style");
    frame.style.position="absolute";
    frame.style.inset="0";
    frame.style.width="100%";
    frame.style.height="100%";
    frame.style.border="0";
    frame.style.display="block";
    frame.style.background="#020617";
    try{{document.documentElement.style.overflow="";document.body.style.overflow="";}}catch(e){{}}
  }}
  function mountFs(){{
    if(root.dataset.dgMounted==="1")return;
    var rect=root.getBoundingClientRect();
    var slot=document.createElement("div");
    slot.setAttribute("data-dg-slot","1");
    slot.style.cssText="display:block;width:100%;max-width:920px;margin:0 auto;height:"+Math.max(1,Math.round(rect.height))+"px";
    if(root.parentNode)root.parentNode.insertBefore(slot, root);
    document.body.appendChild(root);
    root.dataset.dgMounted="1";
  }}
  function unmountFs(){{
    if(root.dataset.dgMounted!=="1")return;
    var slot=document.querySelector("[data-dg-slot]");
    if(slot&&slot.parentNode){{
      slot.parentNode.insertBefore(root, slot);
      slot.parentNode.removeChild(slot);
    }}
    delete root.dataset.dgMounted;
  }}
  function finishExit(){{
    unmountFs();
    restoreLayout();
    syncLand();
    syncFsClass();
    notifyFrame();
    setTimeout(function(){{restoreLayout();syncLand();notifyFrame();}},50);
    setTimeout(function(){{restoreLayout();notifyFrame();}},200);
  }}
  function enterFs(){{
    mountFs();
    root.classList.add("is-fs-mode");
    try{{document.documentElement.style.overflow="hidden";document.body.style.overflow="hidden";}}catch(e){{}}
    syncFsClass();
    notifyFrame();
    // Fullscreen the iframe (not the wrapper) so clicks inside the game do not cancel it
    var native=document.fullscreenElement||document.webkitFullscreenElement;
    if(!native){{
      var req=frame.requestFullscreen||frame.webkitRequestFullscreen;
      if(req){{
        try{{
          var p=req.call(frame);
          if(p&&p.catch)p.catch(function(){{}});
        }}catch(e){{}}
      }}
    }}
    setTimeout(notifyFrame,120);
  }}
  function exitFs(){{
    root.classList.remove("is-fs-mode");
    try{{document.documentElement.style.overflow="";document.body.style.overflow="";}}catch(e){{}}
    var exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(exit&&(document.fullscreenElement||document.webkitFullscreenElement)){{
      try{{
        var p=exit.call(document);
        if(p&&p.then)p.then(finishExit).catch(finishExit);
        else finishExit();
      }}catch(e){{finishExit();}}
    }}else{{
      finishExit();
    }}
  }}
  root.classList.add("is-trailer");
  var heroImgs=root.querySelectorAll("#dg-gd-hero img");
  var hi=0;
  if(heroImgs.length>1){{
    setInterval(function(){{
      if(!root.classList.contains("is-trailer"))return;
      heroImgs[hi].classList.remove("is-on");
      hi=(hi+1)%heroImgs.length;
      heroImgs[hi].classList.add("is-on");
    }},3200);
  }}
  function openGame(){{
    frame.setAttribute("src",baseSrc);
    root.classList.add("is-open");
    root.classList.add("is-loading");
    root.classList.add("is-fading");
    root.classList.remove("is-trailer");
    playing=true;
    btn.setAttribute("aria-expanded","true");
    syncLand();
    // Phones: expand to fullscreen shell immediately (portrait or landscape)
    if(phone())enterFs();
    try{{frame.focus();}}catch(e){{}}
    setTimeout(function(){{root.classList.remove("is-fading");}},600);
  }}
  btn.addEventListener("click",openGame);
  frame.addEventListener("load",function(){{
    root.classList.remove("is-loading");
  }});
  setTimeout(function(){{root.classList.remove("is-loading");}},8000);
  root.addEventListener("touchstart",function(){{
    if(!phone()||isFs())return;
    if(root.classList.contains("is-open"))enterFs();
  }},{{passive:true}});
  window.addEventListener("message",function(e){{
    if(!e.data||typeof e.data!=="object")return;
    if(e.data.type==="dg-chrome"){{
      if(typeof e.data.inGame==="boolean")playing=!!e.data.inGame;
      syncLand();
      if(e.data.inGame&&phone()&&!isFs())enterFs();
    }}
    if(e.data.type==="dg-fs")enterFs();
    if(e.data.type==="dg-fs-exit")exitFs();
  }});
  function onFsChange(){{
    var native=!!(document.fullscreenElement||document.webkitFullscreenElement);
    // Esc / browser UI exit — still need to collapse the CSS fullscreen shell
    if(!native&&(root.classList.contains("is-fs-mode")||root.dataset.dgMounted==="1")){{
      root.classList.remove("is-fs-mode");
      finishExit();
      return;
    }}
    syncFsClass();
    syncLand();
    notifyFrame();
  }}
  document.addEventListener("fullscreenchange",onFsChange);
  document.addEventListener("webkitfullscreenchange",onFsChange);
  window.addEventListener("resize",syncLand);
  window.addEventListener("orientationchange",function(){{setTimeout(syncLand,120);}});
}})();
</script>
"""

Path("godaddy_iframe_snippet.html").write_text(iframe_snippet, encoding="utf-8", newline="\n")
Path("digistracts_godaddy_block.html").write_text(
    "<!-- Digistracts paste: cover card + expand. Full game on GitHub Pages. -->\n" + iframe_snippet,
    encoding="utf-8",
    newline="\n",
)
Path("digistracts_full_singlefile.html").write_text(preview, encoding="utf-8", newline="\n")

readme = f"""# Digistracts by 8bitcrypto_44

Contra-style 8-bit HTML side-scroller. Hosted on GitHub Pages; GoDaddy embeds via iframe.

## Play
- Local: open `index.html`
- Live: [{PAGES_URL}]({PAGES_URL})

## GoDaddy (iframe)
1. Website Builder -> add an **HTML** section
2. Paste **entire** contents of `godaddy_iframe_snippet.html` (same as `digistracts_godaddy_block.html`)
3. Publish -- cover card loads first; **PLAY DIGISTRACTS** expands the hosted game

## Controls
- **PC:** Left/Right or A/D move · Space jumps · Up/W and Down/S aim · FIRE · double-tap Space for air supers
- **Phone:** joystick · JUMP · FIRE; landscape goes full screen like Primal Odyssey
- Volume slider + MUTE / UNMUTE

## Robot enemy types
- **Walker** -- marches in, contact damage
- **Gunner** -- stops and shoots when in range
- **Tank** -- slow, high HP, heavy bolts, HP bar
- **Dasher** -- yellow telegraph, then red charge attack
- **Flyer** -- aerial hunter with jet trails
- **Drone** -- triple-shot hover unit

## Features
- Preacher staff magic vs robots (your art)
- Full HQ robot sprites (iframe = no paste-size budget)
- 5 levels + warehouse boss
- Gun upgrades: RIFLE, SPREAD, MAXI
- QR collectibles, 3 lives, techno soundtrack

## Build
```bash
python build_game.py
```
Rebuilds `index.html`, iframe stub, and single-file archive.
"""
Path("README.md").write_text(readme, encoding="utf-8", newline="\n")

stub_n = len(iframe_snippet.encode("utf-8"))
print("pages index.html", Path("index.html").stat().st_size, "v=" + ASSET_V)
print("iframe stub", stub_n, "bytes", "OK" if stub_n < 51375 else "TOO BIG")
print("archive", Path("digistracts_full_singlefile.html").stat().st_size)
assert "iframe" in iframe_snippet
assert stub_n < 51375
print("Paste godaddy_iframe_snippet.html into GoDaddy.")
