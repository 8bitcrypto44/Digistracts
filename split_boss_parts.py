"""Cut boss sprites into head / torso / arms / legs for skeletal animation."""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SPR = ROOT / "assets" / "sprites"


def data_uri(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def tight(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def clear_rect(im: Image.Image, x0, y0, x1, y1):
    px = im.load()
    w, h = im.size
    for y in range(max(0, y0), min(h, y1)):
        for x in range(max(0, x0), min(w, x1)):
            px[x, y] = (0, 0, 0, 0)


def split_boss(src: Path, out_dir: Path, tag: str, height: int = 158) -> dict:
    im = Image.open(src).convert("RGBA")
    # punch near-white fringe
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 12 or (r > 240 and g > 240 and b > 240):
                px[x, y] = (0, 0, 0, 0)
    im = tight(im)
    # normalize height
    nh = height
    nw = max(64, round(im.width * (nh / im.height)))
    im = im.resize((nw, nh), Image.Resampling.NEAREST)
    w, h = im.size

    # Proportional humanoid cuts (pixel art standing pose)
    head = tight(im.crop((int(w * 0.18), 0, int(w * 0.82), int(h * 0.26))))
    torso = im.copy()
    # Clear limbs from torso so they don't double-draw
    clear_rect(torso, 0, int(h * 0.22), int(w * 0.30), int(h * 0.58))  # left arm
    clear_rect(torso, int(w * 0.70), int(h * 0.22), w, int(h * 0.58))  # right arm
    clear_rect(torso, 0, int(h * 0.55), w, h)  # both legs
    torso = tight(torso.crop((int(w * 0.12), int(h * 0.18), int(w * 0.88), int(h * 0.58))))

    arm_l = tight(im.crop((0, int(h * 0.22), int(w * 0.38), int(h * 0.60))))
    arm_r = tight(im.crop((int(w * 0.62), int(h * 0.22), w, int(h * 0.60))))
    leg_l = tight(im.crop((int(w * 0.10), int(h * 0.52), int(w * 0.52), h)))
    leg_r = tight(im.crop((int(w * 0.48), int(h * 0.52), int(w * 0.90), h)))

    out_dir.mkdir(parents=True, exist_ok=True)
    parts = {
        "head": head,
        "torso": torso,
        "armL": arm_l,
        "armR": arm_r,
        "legL": leg_l,
        "legR": leg_r,
        "full": im,
    }
    for name, part in parts.items():
        part.save(out_dir / f"{tag}_{name}.png")

    # Joint anchors as fractions of drawn boss box (facing left art)
    meta = {
        "w": w,
        "h": h,
        "shoulderL": [0.28, 0.34],
        "shoulderR": [0.72, 0.34],
        "hipL": [0.38, 0.56],
        "hipR": [0.62, 0.56],
        "neck": [0.50, 0.24],
        "headPivot": [0.50, 0.90],  # relative to head image bottom-center-ish
    }
    uris = {k: data_uri(v) for k, v in parts.items() if k != "full"}
    uris["full"] = data_uri(im)
    return {"uris": uris, "meta": meta}


def main():
    packs = {}
    packs["final"] = split_boss(SPR / "boss_redcore.png", SPR / "boss_parts", "final", 158)
    packs["mid"] = split_boss(SPR / "boss_pulse.png", SPR / "boss_parts", "mid", 158)
    out = {
        "final": {"uris": packs["final"]["uris"], "meta": packs["final"]["meta"]},
        "mid": {"uris": packs["mid"]["uris"], "meta": packs["mid"]["meta"]},
    }
    (SPR / "boss_parts.json").write_text(json.dumps(out), encoding="utf-8")
    print("wrote", SPR / "boss_parts.json")
    for k, p in packs.items():
        print(k, {n: Image.open(io.BytesIO(base64.b64decode(u.split(",", 1)[1]))).size
                  for n, u in p["uris"].items()})


if __name__ == "__main__":
    main()
