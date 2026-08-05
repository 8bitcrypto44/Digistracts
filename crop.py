"""Crop and upscale a region of a screenshot so sprite detail is reviewable."""
import sys
from PIL import Image

src, x, y, w, h, scale, dst = sys.argv[1:8]
x, y, w, h, scale = int(x), int(y), int(w), int(h), int(scale)
img = Image.open(src).convert("RGB").crop((x, y, x + w, y + h))
img = img.resize((w * scale, h * scale), Image.Resampling.NEAREST)
img.save(dst)
print("wrote", dst, img.size)
