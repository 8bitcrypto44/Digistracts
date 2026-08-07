#!/usr/bin/env python3
"""QA every stage on Easy, Medium (normal), and Hard via Chrome CDP."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

PORT = 8801
CDP_PORT = 9344
WATCH = "--watch" in sys.argv
KEEP_OPEN = WATCH or "--keep-open" in sys.argv
RESUME = "--resume" in sys.argv
RESULTS_PATH = "qa_all_diffs_results.json"
for arg in sys.argv[1:]:
    if arg.startswith("--port="):
        PORT = int(arg.split("=", 1)[1])
    elif arg.startswith("--cdp="):
        CDP_PORT = int(arg.split("=", 1)[1])
    elif arg.isdigit():
        PORT = int(arg)

BASE = f"http://127.0.0.1:{PORT}"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DIFFS = [
    ("easy", "EASY"),
    ("normal", "MEDIUM"),
    ("hard", "HARD"),
]

STAGE_SPECS = [
    {"label": "L1", "level": 0, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L2", "level": 1, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L3", "level": 2, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L4", "level": 3, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L5", "level": 4, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L6", "level": 5, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "L7", "level": 6, "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "SECRET ember", "secret": "ember", "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "SECRET storm", "secret": "storm", "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "SECRET signal", "secret": "signal", "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "BOSS mid", "boss": "mid", "skipTalk": True, "maxSteps": 150000, "wallMs": 90000},
    {"label": "BOSS final", "boss": "final", "skipTalk": True, "maxSteps": 180000, "wallMs": 120000},
]


def http_json(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def wait_cdp(timeout: float = 30.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            return http_json(f"http://127.0.0.1:{CDP_PORT}/json/version")
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Chrome CDP not ready")


class CDP:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=120)
        self._id = 0

    def call(self, method: str, params=None, timeout: float = 120.0):
        self._id += 1
        msg = {"id": self._id, "method": method}
        if params is not None:
            msg["params"] = params
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps(msg))
        while True:
            raw = self.ws.recv()
            data = json.loads(raw)
            if "method" in data and "id" not in data:
                continue
            if data.get("id") == self._id:
                if "error" in data:
                    raise RuntimeError(f"{method}: {data['error']}")
                return data.get("result", {})

    def evaluate(self, expression: str, timeout: float = 600.0, await_promise: bool = False):
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "timeout": int(min(timeout * 1000, 2147483647)),
            },
            timeout=timeout + 30,
        )
        if result.get("exceptionDetails"):
            raise RuntimeError(json.dumps(result["exceptionDetails"], indent=2)[:2000])
        return result.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    # Ensure server is up
    try:
        urllib.request.urlopen(f"{BASE}/qa.html", timeout=3).read(200)
    except Exception as e:
        raise SystemExit(f"QA server not reachable at {BASE}: {e}")

    profile = tempfile.mkdtemp(prefix="dg-qa-diffs-")
    chrome_args = [
        CHROME,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--window-size=1280,800",
        "about:blank",
    ]
    if WATCH:
        chrome_args.insert(-1, "--start-maximized")
    else:
        chrome_args.insert(-1, "--disable-gpu")
        chrome_args.insert(-1, "--headless=new")
    proc = subprocess.Popen(chrome_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report = {
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "layout": [],
        "diffs": {},
        "pass": True,
    }
    completed: set[tuple[str, str]] = set()
    if RESUME and os.path.exists(RESULTS_PATH):
        try:
            with open(RESULTS_PATH, encoding="utf-8") as f:
                prev = json.load(f)
            report["layout"] = prev.get("layout") or []
            report["diffs"] = dict(prev.get("diffs") or {})
            report["pass"] = prev.get("pass", True)
            report["startedAt"] = prev.get("startedAt") or report["startedAt"]
            for diff_id, rows in report["diffs"].items():
                for row in rows:
                    completed.add((diff_id, row.get("label", "")))
            print(f"RESUME skip {len(completed)} completed stages", flush=True)
        except Exception as e:
            print(f"RESUME load failed: {e}", flush=True)
    try:
        wait_cdp()
        page = None
        for _ in range(50):
            tabs = http_json(f"http://127.0.0.1:{CDP_PORT}/json/list")
            for t in tabs:
                if t.get("type") == "page":
                    page = t
                    break
            if page:
                break
            time.sleep(0.2)
        if not page:
            raise RuntimeError("No Chrome page target found")

        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        try:
            cdp.call("Network.enable")
            cdp.call("Network.setCacheDisabled", {"cacheDisabled": True})
        except Exception:
            pass

        ready = False
        last_err = ""
        for boot_try in range(4):
            cdp.call("Page.navigate", {"url": f"{BASE}/qa.html?qa=1&cdp=1&v={int(time.time() * 1000)}"})
            time.sleep(3.0 + boot_try)
            try:
                cdp.call("Page.bringToFront")
            except Exception:
                pass
            for _ in range(80):
                try:
                    info = cdp.evaluate(
                        "({qa:!!window.__DG_QA, bw:typeof (window.__DG_QA&&window.__DG_QA.burstWatch),"
                        "title:document.title, ready:document.readyState,"
                        "err:(window.__dgBootErr||null)})"
                    )
                except Exception as e:
                    last_err = str(e)
                    time.sleep(0.4)
                    continue
                if info and info.get("qa") and info.get("bw") == "function":
                    ready = True
                    break
                last_err = str(info)
                time.sleep(0.4)
            if ready:
                break
            # Install error trap before next reload
            try:
                cdp.evaluate(
                    "window.__dgBootErr=null;"
                    "window.addEventListener('error',function(e){"
                    "window.__dgBootErr=String(e.message)+' @'+e.filename+':'+e.lineno;}); true"
                )
            except Exception:
                pass
        if not ready:
            raise RuntimeError(f"__DG_QA not ready ({last_err})")

        if not report["layout"]:
            layout = cdp.evaluate("window.__DG_QA.validateAll()", timeout=180)
            report["layout"] = [
                {
                    "label": r["label"],
                    "ok": r["ok"],
                    "spikeNearHole": r["spikeNearHole"],
                    "platformOverlap": r["platformOverlap"],
                }
                for r in layout
            ]
            if any(not r["ok"] for r in layout):
                report["pass"] = False
            print("LAYOUT", json.dumps(report["layout"]), flush=True)
        else:
            print("LAYOUT", json.dumps(report["layout"]), " (resumed)", flush=True)

        t_all = time.time()
        for diff_id, diff_label in DIFFS:
            print(f"DIFF_START {diff_label}", flush=True)
            rows = list(report["diffs"].get(diff_id, []))
            for base in STAGE_SPECS:
                spec = dict(base)
                spec["diff"] = diff_id
                spec["traversal"] = True
                spec["label"] = f"{diff_label} {base['label']}"
                if (diff_id, spec["label"]) in completed:
                    print("STAGE_SKIP", spec["label"], flush=True)
                    continue
                print("STAGE_START", spec["label"], flush=True)
                t0 = time.time()
                if WATCH:
                    timeout_s = max(spec["wallMs"] / 1000.0 + 180, 300)
                    expr = (
                        "(async function(){"
                        f"const spec = {json.dumps(spec)};"
                        "const t0 = performance.now();"
                        "const r = await window.__DG_QA.burstWatch(spec, spec.maxSteps, { chunk: 280 });"
                        "r.ms = Math.round(performance.now()-t0);"
                        "r.diff = spec.diff;"
                        "return r;"
                        "})()"
                    )
                    r = cdp.evaluate(expr, timeout=timeout_s, await_promise=True)
                else:
                    expr = (
                        "(function(){"
                        f"const spec = {json.dumps(spec)};"
                        "const t0 = performance.now();"
                        "const r = window.__DG_QA.burst(spec, spec.maxSteps);"
                        "r.ms = Math.round(performance.now()-t0);"
                        "r.diff = spec.diff;"
                        "return r;"
                        "})()"
                    )
                    r = cdp.evaluate(expr, timeout=240)
                wall = round(time.time() - t0, 1)
                summary = {
                    "label": r.get("label"),
                    "diff": diff_id,
                    "ok": r.get("ok"),
                    "okPlay": r.get("okPlay"),
                    "result": r.get("result"),
                    "progress": r.get("progress"),
                    "deaths": r.get("deaths"),
                    "causes": r.get("causes"),
                    "steps": r.get("steps"),
                    "maxX": r.get("maxX"),
                    "endX": r.get("endX"),
                    "ms": r.get("ms"),
                    "wall_s": wall,
                    "spikeNearHole": r.get("spikeNearHole"),
                    "platformOverlap": r.get("platformOverlap"),
                    "godMode": r.get("godMode"),
                }
                rows.append(summary)
                if not summary["ok"]:
                    report["pass"] = False
                print("STAGE_DONE", json.dumps(summary), flush=True)
                report["diffs"][diff_id] = rows
                with open(RESULTS_PATH, "w", encoding="utf-8") as f:
                    json.dump(report, f, indent=2)
                if WATCH:
                    time.sleep(1.2)

            passed = sum(1 for x in rows if x["ok"])
            print(f"DIFF_DONE {diff_label} {passed}/{len(rows)}", flush=True)

        report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        report["ms"] = int((time.time() - t_all) * 1000)
        with open(RESULTS_PATH, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        # Compact console table
        print("==== QA SUMMARY ====", flush=True)
        print("Layout:", "PASS" if all(r["ok"] for r in report["layout"]) else "FAIL", flush=True)
        for diff_id, diff_label in DIFFS:
            rows = report["diffs"].get(diff_id, [])
            for r in rows:
                mark = "PASS" if r["ok"] else "FAIL"
                print(
                    f"{mark} {r['label']:22} result={r['result']:12} prog={r['progress']:3}% "
                    f"deaths={r['deaths']} env={json.dumps(r.get('causes') or {})}",
                    flush=True,
                )
            ok_n = sum(1 for x in rows if x["ok"])
            print(f"-- {diff_label}: {ok_n}/{len(rows)}", flush=True)
        print("OVERALL", "PASS" if report["pass"] else "FAIL", "ms=", report["ms"], flush=True)
        if WATCH:
            print("WATCH mode: Chrome left open — close the window when done reviewing.", flush=True)
        cdp.close()
        return 0 if report["pass"] else 1
    finally:
        if not KEEP_OPEN:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
