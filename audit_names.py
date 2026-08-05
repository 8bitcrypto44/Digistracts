"""List the receiver object for every member access of a renamed identifier.

Anything read off a browser object (audio element, canvas context, DOM node)
must not be renamed, because the browser owns that property name.
"""
import re
from collections import defaultdict
from pathlib import Path

from mangle import BROWSER_OBJECTS, PROTECTED, SAFE

src = Path("digistracts.js").read_text(encoding="utf-8")
receivers = defaultdict(set)
for name in SAFE:
    for m in re.finditer(r"([A-Za-z_$][A-Za-z0-9_$\.]*)\.%s\b" % re.escape(name), src):
        receivers[name].add(m.group(1))

for name in sorted(receivers):
    objs = receivers[name]
    unsafe = {o for o in objs if o in BROWSER_OBJECTS and (o, name) not in PROTECTED}
    flag = "  <== UNSAFE, browser owns this property" if unsafe else ""
    print("%-18s %s%s" % (name, sorted(objs), flag))
