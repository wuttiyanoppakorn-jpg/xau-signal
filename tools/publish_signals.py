#!/usr/bin/env python3
"""Publish chat signals to the website.

Reads the chat routine's log (default /workspace/xau-signals/sent.json, never modified),
converts it to <repo>/signals.json and commits + pushes ONLY if the signal list changed.

    python3 /workspace/xau-signal-repo/tools/publish_signals.py            # convert, commit, push if changed
    python3 /workspace/xau-signal-repo/tools/publish_signals.py --dry-run  # just show what would change

sent.json format (list of objects): sent_bkk, data_bkk ("YYYY-MM-DD HH:MM", Bangkok time),
side (BUY/SELL), type (scalp/hold), entry, sl, tp (spot XAU/USD prices), setup (text).
Optional (run_cycle.py): conf, conf_adj, conf_final, weak, result, result_bkk, r_net, mfe_r, mae_r, lesson_th, gap_spot_minus_chart, engine_key.
Also commits the public journal/ mirror (outcomes + lessons, market data only) when it changed.
"""
import argparse, datetime as dt, hashlib, json, pathlib, re, subprocess, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
BKK = dt.timezone(dt.timedelta(hours=7))

def epoch(bkk_str):
    return int(dt.datetime.strptime(bkk_str.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=BKK).timestamp())

OPTIONAL = ("conf", "conf_adj", "conf_final", "weak", "rr", "result", "result_t", "result_bkk", "r_net", "mfe_r", "mae_r",
            "minutes_to_result", "exit_price_spot", "lesson_th")

def convert(rows):
    out = []
    for r in rows:
        try:
            side = str(r["side"]).upper()
            if side not in ("BUY", "SELL"):
                continue
            typ = "hold" if str(r.get("type", "")).lower() in ("hold", "long", "ถือยาว") else "scalp"
            sent = epoch(r["sent_bkk"])
            data_t = epoch(r.get("data_bkk") or r["sent_bkk"])
            entry, sl, tp = float(r["entry"]), float(r["sl"]), float(r["tp"])
        except (KeyError, ValueError, TypeError) as e:
            print(f"skip malformed row {r!r}: {e}", file=sys.stderr)
            continue
        setup = str(r.get("setup", ""))
        m = re.search(r"XAUT gap\s*([+-]?\d+(?:\.\d+)?)", setup)
        sid = hashlib.sha1(f"{r['sent_bkk']}|{side}|{typ}|{entry}|{sl}|{tp}".encode()).hexdigest()[:12]
        gap = r.get("gap_spot_minus_chart")
        item = {"id": sid, "sent": sent, "sent_bkk": r["sent_bkk"], "t": data_t, "data_bkk": r.get("data_bkk"),
                "side": side, "type": typ, "entry": entry, "sl": sl, "tp": tp, "setup": setup,
                "xaut_gap": float(gap) if gap is not None else (float(m.group(1)) if m else None),
                "basis": "spot" if "spot basis" in setup.lower() else "unspecified"}
        # optional fields written by run_cycle.py (engine signals + server-side outcome tracking)
        for k in OPTIONAL:
            if r.get(k) is not None:
                item[k] = r[k]
        if r.get("engine_key"):
            item["engine"] = True
        out.append(item)
    out.sort(key=lambda x: (x["sent"], x["id"]))
    return out

def git(*args):
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout.strip()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/workspace/xau-signals/sent.json")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    rows = json.loads(pathlib.Path(a.src).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        sys.exit("sent.json must be a JSON list")
    signals = convert(rows)
    dst = REPO / "signals.json"
    old = []
    if dst.exists():
        try:
            old = json.loads(dst.read_text(encoding="utf-8")).get("signals", [])
        except Exception:
            old = []
    journal = REPO / "journal"
    if old == signals and not journal_dirty(journal):
        print(f"no change ({len(signals)} signals) - nothing to publish")
        return
    new_ids = {s["id"] for s in signals} - {s.get("id") for s in old}
    if a.dry_run:
        print(f"would publish {len(signals)} signals ({len(new_ids)} new)")
        return
    try:
        git("pull", "--ff-only", "-q")
    except subprocess.CalledProcessError as e:
        print("warning: git pull failed:", e.stderr.strip(), file=sys.stderr)
    if old != signals:
        doc = {"version": 1, "basis": "spot XAU/USD", "updated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "count": len(signals), "signals": signals}
        dst.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    git("add", "signals.json")
    if journal.exists():
        git("add", "journal")
    if subprocess.run(["git", "-C", str(REPO), "diff", "--cached", "--quiet"]).returncode == 0:
        print(f"no change ({len(signals)} signals) - nothing to publish")
        return
    git("commit", "-q", "-m", f"Update chat signals ({len(signals)} total, {len(new_ids)} new)")
    git("push", "-q")
    print(f"published {len(signals)} signals ({len(new_ids)} new) -> {git('rev-parse', '--short', 'HEAD')}")

def journal_dirty(journal):
    if not journal.exists():
        return False
    st = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--", "journal"], capture_output=True, text=True).stdout.strip()
    return bool(st)

if __name__ == "__main__":
    main()
