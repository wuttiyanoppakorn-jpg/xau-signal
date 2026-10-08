#!/usr/bin/env python3
"""Fetch OANDA:XAUUSD candles (the same feed TradingView shows for OANDA) via TradingView's public chart websocket.
Stdlib only (minimal RFC6455 client). No login / no token: uses TradingView's 'unauthorized_user_token'.
fetch(tf_list, n) -> {tf: [[t,o,h,l,c,tickvol], ...]}  (t = unix seconds, bar open time, UTC)"""
import base64, json, os, random, re, socket, ssl, string, struct, time

HOST = "data.tradingview.com"
RES = {"M1": "1", "M5": "5", "M15": "15", "H1": "60", "H4": "240"}

class WS:
    def __init__(self, timeout=15):
        raw = socket.create_connection((HOST, 443), timeout=timeout)
        self.s = ssl.create_default_context().wrap_socket(raw, server_hostname=HOST)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET /socket.io/websocket?from=chart%2F&type=chart HTTP/1.1\r\nHost: {HOST}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
               f"Origin: https://www.tradingview.com\r\nUser-Agent: Mozilla/5.0\r\n\r\n")
        self.s.sendall(req.encode()); self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            d = self.s.recv(4096)
            if not d: raise ConnectionError("handshake closed")
            self.buf += d
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]: raise ConnectionError(head[:200].decode("latin1"))
    def send(self, text):
        p = text.encode(); hdr = bytearray([0x81]); n = len(p)
        if n < 126: hdr.append(0x80 | n)
        elif n < 65536: hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else: hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        m = os.urandom(4); hdr += m
        self.s.sendall(bytes(hdr) + bytes(b ^ m[i % 4] for i, b in enumerate(p)))
    def _need(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d: raise ConnectionError("closed")
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]; return out
    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._need(2); n = b1 & 0x7F
            if n == 126: n = struct.unpack(">H", self._need(2))[0]
            elif n == 127: n = struct.unpack(">Q", self._need(8))[0]
            mask = self._need(4) if b1 & 0x80 else None
            p = self._need(n)
            if mask: p = bytes(b ^ mask[i % 4] for i, b in enumerate(p))
            op = b0 & 0x0F
            if op == 8: raise ConnectionError("server close")
            if op == 9: continue
            msg += p
            if b0 & 0x80: return msg.decode("utf-8", "replace")
    def close(self):
        try: self.s.close()
        except Exception: pass

def _frame(obj):
    t = json.dumps(obj, separators=(",", ":")); return f"~m~{len(t)}~m~{t}"

def _split(raw):
    out, i = [], 0
    while raw.startswith("~m~", i):
        j = raw.index("~m~", i + 3); n = int(raw[i + 3:j]); out.append(raw[j + 3:j + 3 + n]); i = j + 3 + n
    return out

def fetch(tfs=("M5",), n=1500, symbol="OANDA:XAUUSD", timeout=25):
    """n: bar count for every TF, or a dict {tf: count} (missing TFs: 1500)."""
    cnt = (lambda tf: n.get(tf, 1500)) if isinstance(n, dict) else (lambda tf: n)
    ws = WS(); rnd = lambda: "".join(random.choice(string.ascii_lowercase) for _ in range(12))
    cs = "cs_" + rnd(); out = {}; series = {}
    try:
        ws.send(_frame({"m": "set_auth_token", "p": ["unauthorized_user_token"]}))
        ws.send(_frame({"m": "chart_create_session", "p": [cs, ""]}))
        ws.send(_frame({"m": "resolve_symbol", "p": [cs, "sym1", "=" + json.dumps({"symbol": symbol, "adjustment": "splits", "session": "regular"})]}))
        # one series per chart session at a time: request tf 1, then modify_series for the next
        pending = list(tfs); cur = pending.pop(0); sid = "s1"
        ws.send(_frame({"m": "create_series", "p": [cs, sid, "s1", "sym1", RES[cur], cnt(cur), ""]}))
        bars, t0 = {}, time.time()
        while time.time() - t0 < timeout:
            raw = ws.recv()
            for m in _split(raw):
                if m.startswith("~h~"): ws.send(f"~m~{len(m)}~m~{m}"); continue
                try: j = json.loads(m)
                except Exception: continue
                mt = j.get("m")
                if mt in ("timescale_update", "du"):
                    s = j["p"][1].get(sid) if isinstance(j["p"][1], dict) else None
                    for b in (s or {}).get("s", []):
                        v = b["v"]; bars[int(v[0])] = [int(v[0]), v[1], v[2], v[3], v[4], (v[5] if len(v) > 5 else 0)]
                elif mt in ("series_completed",):
                    out[cur] = [bars[k] for k in sorted(bars)]
                    if not pending: return out
                    cur = pending.pop(0); bars = {}
                    ws.send(_frame({"m": "remove_series", "p": [cs, sid]}))
                    sid = "s" + str(len(out) + 1)
                    ws.send(_frame({"m": "create_series", "p": [cs, sid, sid, "sym1", RES[cur], cnt(cur), ""]}))
                elif mt in ("symbol_error", "series_error", "critical_error", "protocol_error"):
                    raise RuntimeError(f"{mt}: {j.get('p')}")
        if bars and cur not in out: out[cur] = [bars[k] for k in sorted(bars)]
        return out
    finally:
        ws.close()

if __name__ == "__main__":
    import sys
    t = time.time(); r = fetch(tuple(sys.argv[1:]) or ("M5",), 1500)
    for k, v in r.items(): print(k, len(v), v[0], v[-1], time.strftime("%Y-%m-%d %H:%M", time.localtime(v[-1][0])))
    print("took %.1fs" % (time.time() - t))
