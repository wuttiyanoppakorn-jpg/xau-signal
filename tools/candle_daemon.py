#!/usr/bin/env python3
"""Keeps the website's OANDA candles fresh: fetch OANDA:XAUUSD (all TFs) at ~second 2 of every minute and publish to branch `data`.
Started/kept alive by run_cycle.py (every routine cycle); single instance via flock. Heartbeat file lets run_cycle skip its own publish.
  python3 tools/candle_daemon.py            # run forever (detached by run_cycle)
Stops by itself after 3 h without the routine touching KEEPALIVE (so it never runs unattended forever), and idles on weekends."""
import fcntl, importlib.util, json, os, pathlib, sys, time, traceback

HERE = pathlib.Path(__file__).resolve().parent
STATE = pathlib.Path(os.environ.get("XAU_DAEMON_DIR", "/workspace/xau-research/oanda"))
LOCK, BEAT, KEEP, LOG = STATE / "daemon.lock", STATE / "daemon.heartbeat", STATE / "daemon.keepalive", STATE / "daemon.log"

def log(msg):
    with open(LOG, "a") as f: f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    if LOG.stat().st_size > 2_000_000: LOG.write_text("")

def main():
    STATE.mkdir(parents=True, exist_ok=True)
    lk = open(LOCK, "w")
    try: fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: print("already running"); return 0
    lk.write(str(os.getpid())); lk.flush()
    spec = importlib.util.spec_from_file_location("publish_candles", HERE / "publish_candles.py"); pc = importlib.util.module_from_spec(spec); spec.loader.exec_module(pc)
    log(f"start pid {os.getpid()}"); last_m5 = None; idle = 0
    while True:
        if not KEEP.exists() or time.time() - KEEP.stat().st_mtime > 3 * 3600: log("no keepalive from the routine for 3 h: exit"); return 0
        now = time.time(); time.sleep(max(0.0, 60 - (now % 60) + 2))   # run at second ~2 of each minute
        try:
            t0 = time.time(); bars = pc.fetch_oanda(); spot, ss = None, None
            m5 = bars.get("M5") or []
            if m5 and time.time() - m5[-1][0] > 1800:   # market closed: publish once, then only every 30 min
                idle += 1
                if last_m5 == m5[-1][0] and idle % 30: BEAT.write_text(str(time.time())); continue
            else: idle = 0
            r = pc.publish(bars, spot, ss, slot=int(t0 // 60)); last_m5 = m5[-1][0] if m5 else None
            BEAT.write_text(str(time.time()))
            if not r.startswith(("published", "unchanged")): log(r)
        except Exception as e:
            log("error: " + repr(e)[:300]); time.sleep(5)

if __name__ == "__main__":
    sys.exit(main())
