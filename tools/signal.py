#!/usr/bin/env python3
"""Current XAU/USD setups as JSON for the chat routine — same confluence engine as the website (engine.js, run via Node).

No ML model is used: the walk-forward research (see RESULTS.md) found no ML/rule variant with a consistent positive
out-of-sample edge after spread. The only shipped change is the London/NY-overlap session tag (19:00-23:00 Bangkok),
which beat the 24h engine in most folds but is still not a proven profitable edge.

Usage:
  python3 /workspace/xau-research/signal.py                 # M5, threshold 60, confirmed signals in the last 3 closed bars + live pre-setups
  python3 /workspace/xau-research/signal.py --session-only  # only setups in 19:00-23:00 Bangkok
  python3 /workspace/xau-research/signal.py --tf M15 --threshold 70 --lookback 1 --stage confirmed
Exit code 0 = ok (setups may be empty), 2 = data/engine error (JSON has "error").
"""
import os, sys
_here = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if os.path.abspath(p or '.') != _here]   # this file is named signal.py: never let it shadow the stdlib 'signal' module
import argparse, json, pathlib, subprocess
HERE = pathlib.Path(__file__).resolve().parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tf", default="M5", choices=["M1", "M5", "M15", "H1", "H4"])
    ap.add_argument("--threshold", type=int, default=60)
    ap.add_argument("--lookback", type=int, default=3, help="confirmed signals from the last N closed bars")
    ap.add_argument("--session-only", action="store_true", help="only 19:00-23:00 Bangkok (12-16 UTC)")
    ap.add_argument("--stage", choices=["all", "confirmed", "pre"], default="all")
    a = ap.parse_args()
    arg = json.dumps({"tf": a.tf, "threshold": a.threshold, "lookback": a.lookback, "sessionOnly": a.session_only})
    p = subprocess.run(["node", str(HERE / "signal_engine.js"), arg], capture_output=True, text=True, timeout=90)
    try: out = json.loads(p.stdout)
    except Exception: out = {"error": (p.stderr or p.stdout or "no output").strip()[-500:]}
    if "error" not in out and a.stage != "all":
        out["setups"] = [s for s in out["setups"] if s["stage"] == a.stage]
    if "error" not in out:
        out["note"] = ("Backtest 2022-2026 (walk-forward, spread $0.25): no reliable positive edge. Signals in good_session=true "
                       "(19:00-23:00 BKK) were historically better than other hours. Not financial advice.")
    print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(2 if "error" in out else 0)

if __name__ == "__main__":
    main()
