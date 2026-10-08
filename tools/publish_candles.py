#!/usr/bin/env python3
"""Publish OANDA:XAUUSD candles for the website to the repo's `data` branch (served CORS-ok by raw.githubusercontent.com).

The `data` branch is NOT the GitHub Pages source, so these frequent pushes never trigger a Pages build.
  python3 tools/publish_candles.py            # fetch OANDA via TradingView feed + spot, write, commit, push
  python3 tools/publish_candles.py --no-push  # write only
Called every routine cycle by run_cycle.py (publish(bars, spot, spot_src)). Never raises into the caller (returns a status string).
No secrets: TradingView's public chart feed is used without login; gold-api spot is public."""
import datetime as dt, importlib.util, json, os, pathlib, subprocess, sys, time, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
DATA = pathlib.Path(os.environ.get("XAU_DATA_WT", "/workspace/xau-signal-data"))   # git worktree checked out on branch `data`
KEEP = {"M1": 1000, "M5": 1500, "M15": 1000, "H1": 1500, "H4": 1500, "D1": 500}
FETCH_N = {"H1": 10000}   # long H1 history -> UTC daily bars (D1) for the D1/W1 trend context
TF_SEC = {"M1": 60, "M5": 300, "M15": 900, "H1": 3600, "H4": 14400}

def load_tv():
    spec = importlib.util.spec_from_file_location("tv_oanda", HERE / "tv_oanda.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def utc_daily(h1):
    """UTC calendar-day bars aggregated from OANDA H1 rows [[t,o,h,l,c,v],...] (TradingView's own D1 uses the 17:00 New York session)."""
    out = {}
    for b in h1:
        d = int(b[0]) // 86400 * 86400; x = out.get(d)
        if x is None: out[d] = [d, b[1], b[2], b[3], b[4], b[5] if len(b) > 5 else 0]
        else: x[2] = max(x[2], b[2]); x[3] = min(x[3], b[3]); x[4] = b[4]; x[5] += b[5] if len(b) > 5 else 0
    return [out[k] for k in sorted(out)]

def fetch_oanda():
    """All TFs the site + chat engine use, in one websocket session. Returns {tf: [[t,o,h,l,c,v], ...]} incl. D1 (UTC days)."""
    raw = load_tv().fetch(("M5", "M1", "M15", "H1", "H4"), FETCH_N)
    raw["D1"] = utc_daily(raw.get("H1") or [])
    return raw

def _git(*a, timeout=40):
    return subprocess.run(["git", "-C", str(DATA), *a], capture_output=True, text=True, timeout=timeout)

def ensure_worktree():
    if (DATA / ".git").exists(): return
    r = subprocess.run(["git", "-C", str(REPO), "fetch", "origin", "data"], capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        subprocess.run(["git", "-C", str(REPO), "worktree", "add", "-B", "data", str(DATA), "origin/data"], check=True, capture_output=True, text=True, timeout=60)
    else:   # first time: create an orphan branch
        subprocess.run(["git", "-C", str(REPO), "worktree", "add", "--orphan", "-b", "data", str(DATA)], check=True, capture_output=True, text=True, timeout=60)

def build(bars, spot=None, spot_src=None, now=None):
    """bars: {tf: [[t,o,h,l,c,v], ...] or [{'t','o','h','l','c','v'}, ...]} (OANDA only; includes the forming bar)."""
    now = int(now or time.time()); out = {}
    for tf, keep in KEEP.items():
        rows = []
        for b in (bars.get(tf) or [])[-keep:]:
            if isinstance(b, dict): b = [b["t"], b["o"], b["h"], b["l"], b["c"], b.get("v", 0)]
            rows.append([int(b[0]), round(float(b[1]), 3), round(float(b[2]), 3), round(float(b[3]), 3), round(float(b[4]), 3), int(b[5] or 0)])
        out[tf] = rows
    m5 = out.get("M5") or []
    if len(m5) < 300: raise RuntimeError(f"M5 too short ({len(m5)})")
    live = (out.get("M1") or m5)[-1][4]
    return {"v": 1, "symbol": "OANDA:XAUUSD", "source": "OANDA XAU/USD (bid) via TradingView public chart feed",
            "updated_t": now, "updated_bkk": dt.datetime.fromtimestamp(now, dt.timezone(dt.timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S"),
            "live_px": live, "spot": spot, "spot_src": spot_src, "basis_spot_minus_oanda": round(spot - live, 3) if spot else None,
            "fields": ["t", "o", "h", "l", "c", "tickvol"], "bars": out}

def publish(bars, spot=None, spot_src=None, push=True):
    try:
        doc = build(bars, spot, spot_src)
        ensure_worktree()
        p = DATA / "candles.json"; tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, separators=(",", ":"))); os.replace(tmp, p)
        rd = DATA / "README.md"
        if not rd.exists(): rd.write_text("Auto-published OANDA:XAUUSD candles for the xau-signal website (read by index.html). Written every routine cycle by tools/publish_candles.py. Do not edit.\n")
        if not push: return "written (no push)"
        _git("add", "candles.json", "README.md")
        r = _git("commit", "-q", "-m", f"candles {doc['updated_bkk']} BKK")
        if r.returncode != 0 and "nothing to commit" in (r.stdout + r.stderr): return "unchanged"
        r = _git("push", "-q", "origin", "HEAD:data", timeout=60)
        if r.returncode != 0:   # only this script writes `data`; if the remote moved anyway, rebase our file on top and retry once
            _git("fetch", "-q", "origin", "data"); _git("rebase", "-X", "ours", "origin/data")
            r = _git("push", "-q", "origin", "HEAD:data", timeout=60)
            if r.returncode != 0: return "push failed: " + (r.stderr.strip()[-200:])
        return f"published {doc['updated_bkk']} (M5 last {doc['bars']['M5'][-1][0]})"
    except Exception as e:
        return f"candles publish failed: {e}"

def fetch_spot():
    try:
        with urllib.request.urlopen(urllib.request.Request("https://api.gold-api.com/price/XAU", headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as r:
            d = json.load(r); return float(d["price"]), "gold-api"
    except Exception:
        return None, None

if __name__ == "__main__":
    bars = fetch_oanda(); spot, ss = fetch_spot()
    print(publish(bars, spot, ss, push="--no-push" not in sys.argv))
