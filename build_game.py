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

embed_source = Path("assets/sprites/embed.js").read_text(encoding="utf-8")
embed_source = re.sub(
    r"window\.DG_ROBOTS\s*=\s*\[(.*?)\];",
    "window.DG_ROBOTS=[" + ",".join('"%s"' % u for u in robot_uris) + "];",
    embed_source,
    count=1,
    flags=re.S,
)
embed_source = re.sub(r'window\.DG_QR\s*=\s*"[^"]*";', 'window.DG_QR="";', embed_source)
embed = jsmin(embed_source)
print("robots embedded", len(robot_uris), "from", [p.name for p in robot_paths])
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
    <span><kbd>&larr;&rarr;</kbd>/<kbd>AD</kbd> Move</span>
    <span><kbd>&uarr;&darr;</kbd> Aim</span>
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

ASSET_V = "1"
PAGES_URL = "https://8bitcrypto44.github.io/Digistracts/"
iframe_src_attr = PAGES_URL + "?embed=1&amp;v=" + ASSET_V
cover_imgs = BG_URLS[:4]

preview = (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
    "<meta charset=\"UTF-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no\">\n"
    "<title>Digistracts by 8bitcrypto_44</title>\n"
    "<style>"
    "html,body{margin:0;background:#020617}"
    "body{padding:16px}"
    "html.dg-embed,body.dg-embed{padding:0!important;height:100%;overflow:hidden}"
    "body.dg-embed #digistracts-root{max-width:none;height:100vh;height:100dvh;border-radius:0;border-left:0;border-right:0}"
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
.dg-gd.is-open.is-land{{
  position:fixed;inset:0;z-index:9999;max-width:none;width:100%;height:100%;height:100dvh;margin:0;
  background:#020617
}}
.dg-gd.is-open.is-land .dg-gd-card{{
  height:100%;border:0;border-radius:0;padding:0;box-shadow:none;
  display:flex;flex-direction:column;background:#020617
}}
.dg-gd.is-open.is-land .dg-gd-top{{display:none}}
.dg-gd.is-open.is-land .dg-gd-stage{{
  flex:1;min-height:0;aspect-ratio:auto;height:auto;border:0;border-radius:0
}}
.dg-gd:fullscreen,.dg-gd:-webkit-full-screen{{
  width:100%;height:100%;max-width:none;background:#020617
}}
.dg-gd:fullscreen .dg-gd-card,.dg-gd:-webkit-full-screen .dg-gd-card{{
  height:100%;border:0;border-radius:0;padding:0;box-shadow:none;
  display:flex;flex-direction:column
}}
.dg-gd:fullscreen .dg-gd-top,.dg-gd:-webkit-full-screen .dg-gd-top{{display:none}}
.dg-gd:fullscreen .dg-gd-stage,.dg-gd:-webkit-full-screen .dg-gd-stage{{
  flex:1;min-height:0;aspect-ratio:auto;height:auto;border:0;border-radius:0
}}
@media (max-width:700px){{
  .dg-gd-card{{padding:4px;border-width:2px}}
  .dg-gd-top{{margin-bottom:4px}}
  .dg-gd-brand{{font-size:13px}}
  .dg-gd-enter{{padding:14px 22px;min-height:48px;width:min(100%,280px);font-size:16px}}
  .dg-gd-title{{font-size:clamp(28px,9vw,44px)}}
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
          <p class="dg-gd-tip">Play → PRESS START · Phone landscape goes full screen</p>
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
    return ("ontouchstart" in window)||(navigator.maxTouchPoints>0)||window.innerWidth<=900;
  }}
  function land(){{
    if(window.matchMedia&&window.matchMedia("(orientation: landscape)").matches)return true;
    return window.innerWidth>window.innerHeight;
  }}
  function isFs(){{
    return !!(document.fullscreenElement||document.webkitFullscreenElement);
  }}
  function syncFsClass(){{
    root.classList.toggle("is-fs",isFs());
  }}
  function syncLand(){{
    root.classList.toggle("is-land", root.classList.contains("is-open") && playing && phone() && land());
    syncFsClass();
  }}
  function enterFs(){{
    if(isFs())return;
    var req=root.requestFullscreen||root.webkitRequestFullscreen;
    if(!req)return;
    try{{
      var p=req.call(root);
      if(p&&p.catch)p.catch(function(){{}});
    }}catch(e){{}}
  }}
  function exitFs(){{
    var exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(exit&&isFs()){{
      try{{
        var p=exit.call(document);
        if(p&&p.catch)p.catch(function(){{}});
      }}catch(e){{}}
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
    if(phone()&&land())enterFs();
    try{{frame.focus();}}catch(e){{}}
    setTimeout(function(){{root.classList.remove("is-fading");}},600);
  }}
  btn.addEventListener("click",openGame);
  frame.addEventListener("load",function(){{
    root.classList.remove("is-loading");
  }});
  setTimeout(function(){{root.classList.remove("is-loading");}},8000);
  root.addEventListener("touchstart",function(){{
    if(!root.classList.contains("is-land")||isFs())return;
    enterFs();
  }},{{passive:true}});
  window.addEventListener("message",function(e){{
    if(!e.data)return;
    if(e.data.type==="dg-chrome"){{
      if(typeof e.data.inGame==="boolean")playing=!!e.data.inGame;
      syncLand();
    }}
    if(e.data.type==="dg-fs")enterFs();
    if(e.data.type==="dg-fs-exit")exitFs();
  }});
  function onFsChange(){{syncFsClass();syncLand();}}
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
