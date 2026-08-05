import json
from pathlib import Path

u = json.loads(Path("assets/sprites/uris.json").read_text(encoding="utf-8"))
robots = u["robots"][:8]
lines = ["window.DG_ROBOTS = ["]
for r in robots:
    lines.append(f'  "data:image/png;base64,{r}",')
lines.append("];")
lines.append(f'window.DG_PREACHER = "data:image/png;base64,{u["preacher"]}";')
lines.append(f'window.DG_QR = "data:image/png;base64,{u["qr"]}";')
Path("assets/sprites/embed.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote embed.js", Path("assets/sprites/embed.js").stat().st_size)
