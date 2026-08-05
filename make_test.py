"""Wrap the GoDaddy block in a self-driving page so headless Chrome can smoke-test it."""
import re
import sys
from pathlib import Path

block = Path("digistracts_godaddy_block.html").read_text(encoding="utf-8")
target = sys.argv[1] if len(sys.argv) > 1 else "boss"

# Kill the i-frame invulnerability blink so screenshots always show the preacher.
block, n = re.subn(r"M\.floor\([A-Za-z0-9_$]+\.[A-Za-z0-9_$]+/3\)%2===0", "false", block)
print("blink patches:", n)

keys = sys.argv[2] if len(sys.argv) > 2 else ""
hold = keys.split(",") if keys and keys != "-" else []
name = sys.argv[3] if len(sys.argv) > 3 else target

# Pin the boss energy globe on (or off) so a still frame shows what we want to review.
forced = "if(1)" if name == "boss" else "if(0)"
block, n = re.subn(
    r"if\(![A-Za-z0-9_$]+\.[A-Za-z0-9_$]+\)(?=[A-Za-z0-9_$]+\((?:sx|x)\+39,s?y\+54,76\))",
    forced,
    block,
)
print("shield forced %s:" % forced, n)

driver = """
<script>
var HOLD = %s;
window.__errs = [];""" % repr(hold).replace("'", '"')

driver += """
window.addEventListener("error", function (e) { window.__errs.push(String(e.message)); });
window.addEventListener("unhandledrejection", function (e) { window.__errs.push("reject:" + e.reason); });
setInterval(function () {
  document.title = "ERRCOUNT=" + window.__errs.length + " ERRS=" + window.__errs.join(" ~ ");
}, 120);
setTimeout(function () {
  var btn = document.querySelector("#dg-%s") || document.querySelector("#dg-start");
  if (btn) { btn.click(); } else { window.__errs.push("missing start button"); }
  HOLD.forEach(function (k) { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); });
  setInterval(function () {
    HOLD.forEach(function (k) { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "z" }));
  }, 120);
}, 400);
</script>
""" % target

Path("test_%s.html" % name).write_text(
    "<!doctype html><meta charset='utf-8'><title>boot</title>"
    "<body style='margin:0;background:#000'>" + block + driver,
    encoding="utf-8",
)
print("wrote test_%s.html" % name)
