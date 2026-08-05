import re
from pathlib import Path

block = Path("digistracts_godaddy_block.html").read_text(encoding="utf-8")
bg_m = re.search(r"DG_BACKGROUNDS=(\[[^\]]*\])", block)
if not bg_m:
    bg_m = re.search(r"DG_BACKGROUND='([^']+)'", block)
background = bg_m.group(1) if bg_m else ""
sprites = re.findall(r'"data:image/(?:png|webp);base64,[^"]+"', block)
sprite_bytes = sum(len(s) for s in sprites)

print("total    ", len(block))
print("background", len(background))
print("sprites   ", sprite_bytes, "count", len(sprites))
print("code+css  ", len(block) - len(background) - sprite_bytes)
