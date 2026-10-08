#!/usr/bin/env python3
"""Fetch gold / macro market-moving headlines + this week's economic calendar into <repo>/news.json.

Public sources only, no API keys, no secrets:
  * Google News RSS search (Thai "ราคาทอง/ทองคำ" + English gold / Fed / CPI / NFP / geopolitics)
  * FXStreet news RSS, Investing.com commodities RSS (filtered by keyword)
  * ForexFactory weekly calendar JSON (nfs.faireconomy.media) - refetched at most once an hour

    python3 tools/fetch_news.py            # refresh news.json if it is older than 10 min
    python3 tools/fetch_news.py --force    # refresh now

Designed to be called from publish_signals.py: hard time budget (~5 s), never raises, keeps the previous
data for any source that fails.
"""
import concurrent.futures as cf, datetime as dt, email.utils, html, json, pathlib, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "news.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; xau-signal-news/1.0; +https://wuttiyanoppakorn-jpg.github.io/xau-signal/)"}
MIN_AGE_S = 600          # refresh headlines at most every 10 min
CAL_MIN_AGE_S = 3600     # ForexFactory asks for light use: calendar at most hourly
BUDGET_S = 4.5
REQ_TIMEOUT = 3.5
MAX_ITEMS = 60
MAX_AGE_H = 36

def gn(q, th=False):
    q = urllib.parse.quote(q)
    return f"https://news.google.com/rss/search?q={q}&hl=th&gl=TH&ceid=TH:th" if th else f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

FEEDS = [  # (key, label, url, lang, keyword-filter?)
    ("gn_th", "Google News (ไทย)", gn('"ราคาทอง" OR "ทองคำโลก" OR "ทองโลก" OR เฟด OR "ดอกเบี้ยสหรัฐ" OR "เงินเฟ้อสหรัฐ" when:1d', th=True), "th", False),
    ("gn_gold", "Google News", gn('"gold price" OR XAUUSD OR "spot gold" OR bullion when:1d'), "en", False),
    ("gn_macro", "Google News", gn('"Federal Reserve" OR FOMC OR "CPI" OR "nonfarm payrolls" OR "rate decision" OR "central bank" when:1d'), "en", False),
    ("fxstreet", "FXStreet", "https://www.fxstreet.com/rss/news", "en", True),
    ("investing", "Investing.com", "https://www.investing.com/rss/news_11.rss", "en", True),
]
CAL_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
CAL_CCY = {"USD", "EUR", "GBP", "JPY", "CNY", "CHF", "AUD", "CAD", "NZD", "All"}

TAGS = [  # (tag, regex) - first match order = display order
    ("gold", r"\bgold\b|xau|bullion|ทอง"),
    ("fed", r"\bfed\b|fomc|powell|federal reserve|rate (cut|hike|decision)|interest rate|central bank|ecb|boj|pboc|\bboe\b|ดอกเบี้ย|เฟด|ธนาคารกลาง"),
    ("data", r"\bcpi\b|\bppi\b|\bpce\b|inflation|payroll|\bnfp\b|jobs report|unemployment|jobless|\bgdp\b|retail sales|\bism\b|pmi|jolts|เงินเฟ้อ|จ้างงาน|ว่างงาน"),
    ("geo", r"war\b|missile|attack|sanction|tariff|geopolit|israel|iran|russia|ukraine|middle east|gaza|taiwan|north korea|conflict|ceasefire|สงคราม|ภาษีนำเข้า|ภูมิรัฐศาสตร์|ความขัดแย้ง"),
    ("usd", r"dollar|\busd\b|dxy|treasury|yields?\b|ดอลลาร์|บอนด์|พันธบัตร"),
]
# low-value noise: chart-idea posts, per-city jewellery price pages, machine-translated aggregators
NOISE = re.compile(r"chart image by|gold (rate|price)s? today in |22 (and|&) 24 carat|carat gold|\bhallmark|jewell?ery|horoscope|ดวง|รูปปั้น|ดารา|นางเอก|พระเอก", re.I)
NOISE_SRC = {"Vietnam.vn"}
RELEVANT = re.compile(r"\bgold\b|xau|bullion|silver|precious|\bfed\b|fomc|powell|federal reserve|central bank|interest rate|rate (cut|hike|decision)|ecb|boj|pboc|\bcpi\b|\bppi\b|\bpce\b|inflation|payroll|\bnfp\b|jobs|unemployment|jobless|\bgdp\b|treasur|yield|dollar|dxy|tariff|war\b|sanction|geopolit|israel|iran|russia|ukraine|middle east|safe.haven", re.I)

def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=REQ_TIMEOUT) as r:
        return r.read()

def _ts(s):
    try:
        return int(email.utils.parsedate_to_datetime(s).timestamp())
    except Exception:
        return None

def parse_rss(key, label, raw, lang, filt):
    out = []
    root = ET.fromstring(raw)
    for it in root.iter("item"):
        title = html.unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        t = _ts(it.findtext("pubDate") or "")
        if not title or not link.startswith(("http://", "https://")) or not t:
            continue
        src = label
        se = it.find("source")
        if key.startswith("gn_"):
            if se is not None and (se.text or "").strip():
                src = se.text.strip()
            m = re.match(r"^(.*)\s+-\s+([^-]{2,60})$", title)   # Google News: "Title - Publisher"
            if m:
                title, src = m.group(1).strip(), (src if se is not None and se.text else m.group(2).strip())
        if NOISE.search(title) or src in NOISE_SRC:
            continue
        if filt and not RELEVANT.search(title):
            continue
        tags = [tg for tg, rx in TAGS if re.search(rx, title, re.I)]
        if lang == "th" and not tags:   # Thai search results drift off-topic: keep only gold / rates / data / geo / dollar
            continue
        out.append({"t": t, "title": title[:300], "url": link[:1000], "source": src[:60], "via": label, "lang": lang, "tags": tags})
    return out

def norm_title(s):
    return re.sub(r"[^\w]+", " ", s.lower()).strip()[:90]

def fetch_cal(raw):
    rows = json.loads(raw)
    out = []
    for r in rows:
        if r.get("country") not in CAL_CCY or r.get("impact") not in ("High", "Medium"):
            continue
        try:
            t = int(dt.datetime.fromisoformat(r["date"]).timestamp())
        except Exception:
            continue
        out.append({"t": t, "title": str(r.get("title", ""))[:120], "ccy": r.get("country"), "impact": r.get("impact"),
                    "forecast": str(r.get("forecast") or "")[:20], "previous": str(r.get("previous") or "")[:20]})
    out.sort(key=lambda x: x["t"])
    return out

def load_old():
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        return {}

def is_due(min_age=MIN_AGE_S):
    old = load_old()
    return time.time() - (old.get("fetched_at") or 0) >= min_age

def refresh(force=False, budget=BUDGET_S):
    """Returns True if news.json was rewritten. Never raises."""
    try:
        return _refresh(force, budget)
    except Exception as e:
        print("news: refresh failed:", e, file=sys.stderr)
        return False

def _refresh(force, budget):
    t0 = time.time()
    old = load_old()
    if not force and t0 - (old.get("fetched_at") or 0) < MIN_AGE_S:
        print("news: fresh enough, skipped")
        return False
    jobs = {k: u for k, _, u, _, _ in FEEDS}
    cal_tried = old.get("calendar_tried_at") or old.get("calendar_fetched_at") or 0
    cal_due = (force and t0 - cal_tried >= 300) or t0 - cal_tried >= CAL_MIN_AGE_S   # also back off after a failure (HTTP 429)
    if cal_due:
        jobs["calendar"] = CAL_URL
    got, errs = {}, {}
    ex = cf.ThreadPoolExecutor(max_workers=len(jobs))
    futs = {ex.submit(_get, u): k for k, u in jobs.items()}
    try:
        for f in cf.as_completed(futs, timeout=max(0.5, budget - (time.time() - t0))):
            k = futs[f]
            try:
                got[k] = f.result()
            except Exception as e:
                errs[k] = str(e)[:120]
    except cf.TimeoutError:
        for f, k in futs.items():
            if k not in got and k not in errs:
                errs[k] = "timeout"
    ex.shutdown(wait=False, cancel_futures=True)

    status = dict(old.get("status") or {})
    per_src = {}
    old_items = old.get("items") or []
    for key, label, _, lang, filt in FEEDS:
        if key in got:
            try:
                per_src[key] = parse_rss(key, label, got[key], lang, filt)
                status[key] = {"ok": True, "n": len(per_src[key]), "at": int(t0)}
                continue
            except Exception as e:
                errs[key] = "parse: " + str(e)[:100]
        status[key] = {"ok": False, "err": errs.get(key, "?"), "at": int(t0)}
        per_src[key] = [i for i in old_items if i.get("feed") == key]   # keep previous items of a failing source
    items, seen = [], set()
    cutoff = t0 - MAX_AGE_H * 3600
    for key, lst in per_src.items():
        for i in lst:
            i = dict(i, feed=key)
            n = norm_title(i["title"])
            if i["t"] < cutoff or i["t"] > t0 + 600 or n in seen:
                continue
            seen.add(n)
            items.append(i)
    items.sort(key=lambda x: -x["t"])
    # keep Thai headlines visible: cap per language
    th = [i for i in items if i["lang"] == "th"][:20]
    en = [i for i in items if i["lang"] != "th"][:MAX_ITEMS - len(th)]
    items = sorted(th + en, key=lambda x: -x["t"])

    calendar, cal_at = old.get("calendar") or [], old.get("calendar_fetched_at") or 0
    if "calendar" in got:
        try:
            calendar, cal_at = fetch_cal(got["calendar"]), int(t0)
            status["calendar"] = {"ok": True, "n": len(calendar), "at": int(t0)}
        except Exception as e:
            status["calendar"] = {"ok": False, "err": "parse: " + str(e)[:100], "at": int(t0)}
    elif cal_due:
        status["calendar"] = {"ok": False, "err": errs.get("calendar", "?"), "at": int(t0)}

    if not items and not calendar:
        print("news: every source failed, keeping old file", errs, file=sys.stderr)
        return False
    doc = {"version": 1, "fetched_at": int(t0), "updated_utc": dt.datetime.fromtimestamp(t0, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "calendar_fetched_at": cal_at, "calendar_tried_at": int(t0) if cal_due else cal_tried, "sources": [{"key": k, "label": l, "lang": lg} for k, l, _, lg, _ in FEEDS] +
           [{"key": "calendar", "label": "ForexFactory calendar", "lang": "en"}],
           "status": status, "items": items, "calendar": calendar}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"news: {len(items)} headlines, {len(calendar)} calendar events, {len(errs)} source errors, {time.time() - t0:.1f}s"
          + (f" {errs}" if errs else ""))
    return True

if __name__ == "__main__":
    refresh(force="--force" in sys.argv)
