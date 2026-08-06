"""Cut boss sprites into clean limb overlays + limb-cleared body for hybrid animation.

Preferred draw stack in digistracts.js:
  legs (IK) -> body (chest intact, limbs cleared) -> arms -> head
"""
from __future__ import annotations

import base64
import io
import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SPR = ROOT / "assets" / "sprites"


def data_uri(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def punch_fringe(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 12 or (r > 240 and g > 240 and b > 240):
                px[x, y] = (0, 0, 0, 0)
    return im


def tight(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def normalize(im: Image.Image, height: int = 158) -> Image.Image:
    im = punch_fringe(im)
    im = tight(im)
    nh = height
    nw = max(64, round(im.width * (nh / im.height)))
    return im.resize((nw, nh), Image.Resampling.NEAREST)


def opaque(px, x, y) -> bool:
    return px[x, y][3] >= 12


def flood_mask(im: Image.Image, seeds, allowed) -> list[list[bool]]:
    """BFS flood fill constrained to `allowed` predicate. Returns bool mask."""
    w, h = im.size
    px = im.load()
    mask = [[False] * w for _ in range(h)]
    q = deque()
    for sx, sy in seeds:
        if 0 <= sx < w and 0 <= sy < h and opaque(px, sx, sy) and allowed(sx, sy):
            mask[sy][sx] = True
            q.append((sx, sy))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx]:
                if opaque(px, nx, ny) and allowed(nx, ny):
                    mask[ny][nx] = True
                    q.append((nx, ny))
    return mask


def mask_bbox(mask) -> tuple[int, int, int, int] | None:
    ys = [y for y, row in enumerate(mask) if any(row)]
    if not ys:
        return None
    xs = [x for row in mask for x, v in enumerate(row) if v]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def apply_mask(im: Image.Image, mask, invert: bool = False) -> Image.Image:
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sp, dp = im.load(), out.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            keep = mask[y][x]
            if invert:
                keep = not keep
            if keep and sp[x, y][3] >= 12:
                dp[x, y] = sp[x, y]
    return out


def erode_mask(mask, rounds: int = 1) -> list[list[bool]]:
    h, w = len(mask), len(mask[0])
    cur = mask
    for _ in range(rounds):
        nxt = [[False] * w for _ in range(h)]
        for y in range(h):
            for x in range(w):
                if not cur[y][x]:
                    continue
                if (
                    (y > 0 and cur[y - 1][x])
                    and (y + 1 < h and cur[y + 1][x])
                    and (x > 0 and cur[y][x - 1])
                    and (x + 1 < w and cur[y][x + 1])
                ):
                    nxt[y][x] = True
        cur = nxt
    return cur


def dilate_mask(mask, rounds: int = 1) -> list[list[bool]]:
    h, w = len(mask), len(mask[0])
    cur = [row[:] for row in mask]
    for _ in range(rounds):
        nxt = [row[:] for row in cur]
        for y in range(h):
            for x in range(w):
                if not cur[y][x]:
                    continue
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        nxt[ny][nx] = True
        cur = nxt
    return cur


def or_masks(*masks):
    h, w = len(masks[0]), len(masks[0][0])
    out = [[False] * w for _ in range(h)]
    for m in masks:
        for y in range(h):
            for x in range(w):
                if m[y][x]:
                    out[y][x] = True
    return out


def crop_masked(im: Image.Image, mask) -> tuple[Image.Image, dict]:
    """Return tight RGBA crop + placement meta in full-sprite coords."""
    bb = mask_bbox(mask)
    if not bb:
        empty = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        return empty, {"ox": 0, "oy": 0, "w": 1, "h": 1, "pivot": [0.5, 0.2]}
    x0, y0, x1, y1 = bb
    part = apply_mask(im, mask).crop((x0, y0, x1, y1))
    part = tight(part)
    # recompute ox/oy after tight (may trim transparent edges inside bb)
    # find first opaque relative to original masked crop
    full_masked = apply_mask(im, mask)
    tb = full_masked.getbbox() or (x0, y0, x1, y1)
    meta = {
        "ox": tb[0],
        "oy": tb[1],
        "w": part.width,
        "h": part.height,
        "pivot": [0.5, 0.18],
    }
    return part, meta


def strip_center_mass(mask, w, h, side: str, max_center_frac: float):
    """Aggressively kill mask pixels that reach into the chest/belly column."""
    cx0 = int(w * (0.5 - max_center_frac / 2))
    cx1 = int(w * (0.5 + max_center_frac / 2))
    # for arms: also kill anything past a side gate toward center
    if side == "L":
        gate = int(w * 0.38)
        for y in range(h):
            for x in range(gate, w):
                mask[y][x] = False
            # kill high-center (chest) even if left of gate in upper band
            for x in range(int(w * 0.28), gate):
                if y < int(h * 0.48) and x > int(w * 0.30):
                    # keep only if far from vertical center of torso band
                    if x >= cx0:
                        mask[y][x] = False
    else:
        gate = int(w * 0.62)
        for y in range(h):
            for x in range(0, gate):
                mask[y][x] = False
            for x in range(gate, int(w * 0.72)):
                if y < int(h * 0.48) and x <= cx1:
                    if x <= cx1:
                        mask[y][x] = False
    return mask


def keep_largest_component(mask) -> list[list[bool]]:
    h, w = len(mask), len(mask[0])
    seen = [[False] * w for _ in range(h)]
    best = []
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or seen[y][x]:
                continue
            comp = []
            q = deque([(x, y)])
            seen[y][x] = True
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    out = [[False] * w for _ in range(h)]
    for x, y in best:
        out[y][x] = True
    return out


def strip_chest_colors(im: Image.Image, mask, side: str) -> list[list[bool]]:
    """Drop saturated chest-core pixels that leaked into arm masks."""
    w, h = im.size
    px = im.load()
    gate = int(w * (0.30 if side == "L" else 0.70))
    for y in range(h):
        for x in range(w):
            if not mask[y][x]:
                continue
            r, g, b, a = px[x, y]
            # red core (final) or magenta/purple core (mid)
            is_red = r > 140 and r > g + 40 and r > b + 40
            is_purple = b > 120 and r > 100 and g < 120 and (r + b) > g * 2.2
            inward = x > gate if side == "L" else x < gate
            if inward and (is_red or is_purple):
                mask[y][x] = False
            # also kill deep inward fringe near chest column
            if side == "L" and x >= int(w * 0.32) and y < int(h * 0.50):
                mask[y][x] = False
            if side == "R" and x <= int(w * 0.68) and y < int(h * 0.50):
                mask[y][x] = False
    return mask


def extract_arm(im: Image.Image, side: str) -> tuple[Image.Image, dict, list[list[bool]]]:
    w, h = im.size
    px = im.load()
    y0, y1 = int(h * 0.22), int(h * 0.60)
    if side == "L":
        x_limit = int(w * 0.32)

        def allowed(x, y):
            return y0 <= y < y1 and x < x_limit

        seeds = []
        for y in range(y0, y1):
            for x in range(0, min(6, w)):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break
        for y in range(y0, y1, 2):
            for x in range(0, x_limit):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break
    else:
        x_limit = int(w * 0.68)

        def allowed(x, y):
            return y0 <= y < y1 and x >= x_limit

        seeds = []
        for y in range(y0, y1):
            for x in range(w - 1, max(w - 7, -1), -1):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break
        for y in range(y0, y1, 2):
            for x in range(w - 1, x_limit - 1, -1):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break

    mask = flood_mask(im, seeds, allowed)
    mask = strip_center_mass(mask, w, h, side, max_center_frac=0.40)
    mask = strip_chest_colors(im, mask, side)
    mask = erode_mask(mask, 1)
    mask = keep_largest_component(mask)
    mask = dilate_mask(mask, 1)
    mask = strip_center_mass(mask, w, h, side, max_center_frac=0.42)
    mask = strip_chest_colors(im, mask, side)
    mask = keep_largest_component(mask)

    # geometric fallback ROI if flood found almost nothing
    if sum(1 for row in mask for v in row if v) < 60:
        mask = [[False] * w for _ in range(h)]
        if side == "L":
            x0, x1 = 0, int(w * 0.28)
        else:
            x0, x1 = int(w * 0.72), w
        for y in range(int(h * 0.24), int(h * 0.58)):
            for x in range(x0, x1):
                if opaque(px, x, y):
                    mask[y][x] = True
        mask = strip_chest_colors(im, mask, side)
        mask = keep_largest_component(mask)

    part, meta = crop_masked(im, mask)
    if side == "L":
        meta["pivot"] = [0.82, 0.10]
    else:
        meta["pivot"] = [0.18, 0.10]
    meta["foot"] = [0.5, 0.92]
    return part, meta, mask


def extract_leg(im: Image.Image, side: str) -> tuple[Image.Image, dict, list[list[bool]]]:
    w, h = im.size
    px = im.load()
    y0 = int(h * 0.52)
    mid = w // 2
    # gap between legs around center — keep each side out of belly plating
    belly_y1 = int(h * 0.58)

    if side == "L":
        x0, x1 = 0, int(w * 0.52)

        def allowed(x, y):
            if y < y0 or x < x0 or x >= x1:
                return False
            # block upper-center belly
            if y < belly_y1 and x > int(w * 0.42):
                return False
            if x >= mid + 2:
                return False
            return True

        seeds = []
        for x in range(int(w * 0.15), int(w * 0.45)):
            for y in range(h - 1, y0, -1):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break
    else:
        x0, x1 = int(w * 0.48), w

        def allowed(x, y):
            if y < y0 or x < x0 or x >= x1:
                return False
            if y < belly_y1 and x < int(w * 0.58):
                return False
            if x <= mid - 2:
                return False
            return True

        seeds = []
        for x in range(int(w * 0.55), int(w * 0.88)):
            for y in range(h - 1, y0, -1):
                if opaque(px, x, y):
                    seeds.append((x, y))
                    break

    mask = flood_mask(im, seeds, allowed)
    # peel belly fringe
    for y in range(0, int(h * 0.56)):
        for x in range(w):
            mask[y][x] = False
    # kill center column in upper leg band
    cx0, cx1 = int(w * 0.44), int(w * 0.56)
    for y in range(y0, int(h * 0.68)):
        for x in range(cx0, cx1):
            mask[y][x] = False

    if sum(1 for row in mask for v in row if v) < 100:
        mask = [[False] * w for _ in range(h)]
        if side == "L":
            rx0, rx1 = int(w * 0.08), int(w * 0.48)
        else:
            rx0, rx1 = int(w * 0.52), int(w * 0.92)
        for y in range(int(h * 0.56), h):
            for x in range(rx0, rx1):
                if opaque(px, x, y):
                    mask[y][x] = True

    part, meta = crop_masked(im, mask)
    meta["pivot"] = [0.55 if side == "L" else 0.45, 0.08]
    meta["foot"] = [0.55 if side == "L" else 0.45, 0.96]
    return part, meta, mask


def extract_head(im: Image.Image) -> tuple[Image.Image, dict, list[list[bool]]]:
    w, h = im.size
    px = im.load()
    y1 = int(h * 0.26)
    x0, x1 = int(w * 0.16), int(w * 0.84)
    mask = [[False] * w for _ in range(h)]
    for y in range(0, y1):
        for x in range(x0, x1):
            if opaque(px, x, y):
                mask[y][x] = True
    # drop any lower neck spill past y1
    part, meta = crop_masked(im, mask)
    meta["pivot"] = [0.50, 0.88]
    return part, meta, mask


def geometric_clear_zones(im: Image.Image) -> list[list[bool]]:
    """Broader limb clear zones so the body layer does not leave limb stubs."""
    w, h = im.size
    px = im.load()
    mask = [[False] * w for _ in range(h)]
    # left arm zone (outer)
    for y in range(int(h * 0.22), int(h * 0.60)):
        for x in range(0, int(w * 0.30)):
            if opaque(px, x, y):
                mask[y][x] = True
    # right arm zone
    for y in range(int(h * 0.22), int(h * 0.60)):
        for x in range(int(w * 0.70), w):
            if opaque(px, x, y):
                mask[y][x] = True
    # legs zone below hips, exclude center crotch gap lightly
    for y in range(int(h * 0.56), h):
        for x in range(0, int(w * 0.48)):
            if opaque(px, x, y):
                mask[y][x] = True
        for x in range(int(w * 0.52), w):
            if opaque(px, x, y):
                mask[y][x] = True
    # head zone
    for y in range(0, int(h * 0.26)):
        for x in range(int(w * 0.16), int(w * 0.84)):
            if opaque(px, x, y):
                mask[y][x] = True
    return mask


def build_body(im: Image.Image, clear_masks) -> tuple[Image.Image, dict]:
    """Full sprite with limb (and head) regions cleared — chest stays intact."""
    w, h = im.size
    clear = or_masks(*clear_masks)
    # slight dilate so animated overlays cover the seam without leaving limb stubs
    clear = dilate_mask(clear, 2)
    # never clear the central chest column (protect red/purple core)
    cx0, cx1 = int(w * 0.34), int(w * 0.66)
    cy0, cy1 = int(h * 0.26), int(h * 0.58)
    for y in range(cy0, cy1):
        for x in range(cx0, cx1):
            clear[y][x] = False
    body = apply_mask(im, clear, invert=True)
    meta = {
        "ox": 0,
        "oy": 0,
        "w": w,
        "h": h,
        "pivot": [0.5, 0.5],
    }
    return body, meta


def split_boss(src: Path, out_dir: Path, tag: str, height: int = 158) -> dict:
    im = normalize(Image.open(src), height)
    w, h = im.size

    head, head_m, head_mask = extract_head(im)
    arm_l, arm_l_m, arm_l_mask = extract_arm(im, "L")
    arm_r, arm_r_m, arm_r_mask = extract_arm(im, "R")
    leg_l, leg_l_m, leg_l_mask = extract_leg(im, "L")
    leg_r, leg_r_m, leg_r_mask = extract_leg(im, "R")

    # body: clear arms+legs+head so overlays own those pixels; chest/pauldrons remain
    geo = geometric_clear_zones(im)
    body, body_m = build_body(
        im, [arm_l_mask, arm_r_mask, leg_l_mask, leg_r_mask, head_mask, geo]
    )

    # legacy tight torso (chest plate only) — unused by hybrid but kept for tooling
    torso = tight(im.crop((int(w * 0.18), int(h * 0.20), int(w * 0.82), int(h * 0.56))))

    out_dir.mkdir(parents=True, exist_ok=True)
    parts = {
        "head": head,
        "body": body,
        "torso": torso,
        "armL": arm_l,
        "armR": arm_r,
        "legL": leg_l,
        "legR": leg_r,
        "full": im,
    }
    for name, part in parts.items():
        part.save(out_dir / f"{tag}_{name}.png")

    meta = {
        "w": w,
        "h": h,
        "shoulderL": [0.28, 0.34],
        "shoulderR": [0.72, 0.34],
        "hipL": [0.38, 0.56],
        "hipR": [0.62, 0.56],
        "neck": [0.50, 0.24],
        "ground": 1.0,
        "parts": {
            "head": head_m,
            "body": body_m,
            "armL": arm_l_m,
            "armR": arm_r_m,
            "legL": leg_l_m,
            "legR": leg_r_m,
        },
    }
    uris = {k: data_uri(v) for k, v in parts.items()}
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
        sizes = {}
        for n, u in p["uris"].items():
            raw = base64.b64decode(u.split(",", 1)[1])
            sizes[n] = Image.open(io.BytesIO(raw)).size
        print(k, sizes)
        pm = p["meta"]["parts"]
        print(" ", {n: (pm[n]["ox"], pm[n]["oy"], pm[n]["w"], pm[n]["h"]) for n in pm})


if __name__ == "__main__":
    main()
