/* XAU confluence signal engine — shared by the web page and the Node backtest. All functions are causal (no look-ahead). */
(function (root) {
'use strict';
const E = {};
E.TF_SEC = {M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14400};
E.TF_LIST = ['M1', 'M5', 'M15', 'H1', 'H4'];
E.MTF_W = {M1: 0.5, M5: 0.75, M15: 1, H1: 1.25, H4: 1.5};
E.W = {ema: 1.5, pullback: 0.75, adx: 1, rsi: 1, div: 1, macd: 1, stoch: 0.75, bb: 0.75, vwap: 0.75, sr: 1, candle: 1, struct: 1, vol: 0.5};
E.DEFAULTS = {threshold: 60, cooldown: 3, rrShort: 1.5, rrLong: 2.5, slShort: [1.5, 3], slLong: [2, 4], filterH4: true, sessionOnly: false,
  holdNeedM15: true, scalpSessUTC: [12, 16], minAtrRel: 0.7, beAtR: 1.0,   // golive candidate A (xau-research/golive_study)
  holdNeedW1D1: true, holdSkipEventDays: true};   // 2026-10-08 new inputs (xau-research/newinputs): passed walk-forward on 2018-2026 spot
E.GOLIVE_T = 1791444000;   // break-even rule applies to signals from this bar time on

// ---------------- new inputs (2026-10-08): D1/W1 trend context + US high-impact event days ----------------
// Daily model of gold: UTC daily bars (Saturday dropped, like spot data), up = close > EMA50 of daily closes (EMA seeded with the first close).
// Weekly: Mon-Fri closes grouped by week (label = the following Sunday 00:00 UTC), up = Friday close > EMA10 of weekly closes.
// Causal and identical to the research test: D1 = last COMPLETED day; W1 = the week completed BEFORE the most recent completed week.
E.dayModel = function (bars) {
  const d = (bars || []).filter(b => new Date(b.t * 1000).getUTCDay() !== 6).sort((a, b) => a.t - b.t);
  if (d.length < 60) return null;
  const k50 = 2 / 51, rows = []; let e = null;
  for (const b of d) { e = e == null ? b.c : b.c * k50 + e * (1 - k50); rows.push({t: b.t, up: b.c > e ? 1 : -1}); }
  const wk = new Map();
  for (const b of d) { const dw = new Date(b.t * 1000).getUTCDay(); if (dw === 0) continue;   // Sunday evening belongs to the next week's open
    const lab = b.t - ((dw + 6) % 7) * 86400 + 6 * 86400; wk.set(lab, b.c); }
  const labs = [...wk.keys()].sort((a, b) => a - b), k10 = 2 / 11, weeks = []; let w = null;
  for (const l of labs) { const c = wk.get(l); w = w == null ? c : c * k10 + w * (1 - k10); weeks.push({t: l, up: c > w ? 1 : -1}); }
  return {rows, weeks};
};
E.htfTrendAt = function (dm, tEnd) {   // {d1, w1} as of time tEnd, or null when the daily data is missing/stale
  if (!dm) return null;
  let i = -1; for (let k = dm.rows.length - 1; k >= 0; k--) if (dm.rows[k].t + 86400 <= tEnd) { i = k; break; }
  let j = -1; for (let k = dm.weeks.length - 1; k >= 0; k--) if (dm.weeks[k].t <= tEnd) { j = k; break; }
  if (i < 0 || j < 1 || tEnd - (dm.rows[i].t + 86400) > 4 * 86400) return null;
  return {d1: dm.rows[i].up === 1 ? 'up' : 'down', w1: dm.weeks[j - 1].up === 1 ? 'up' : 'down'};
};
// US CPI / NFP release days and FOMC statement days (UTC dates). History: ALFRED vintage dates (CPIAUCSL, PAYEMS) + federalreserve.gov.
// Live: extended from the ForexFactory weekly calendar that the site already publishes in news.json (E.loadCalendar).
E.DAILY = null;   // optional global daily model (the website sets it from its own daily fetch); ctx extra.d1 wins
E.EVENT_DAYS = new Set('180105 180112 180131 180202 180214 180309 180313 180321 180406 180411 180502 180504 180510 180601 180612 180613 180706 180712 180801 180803 180810 180907 180913 180926 181005 181011 181102 181108 181114 181207 181212 181219 190104 190111 190130 190201 190213 190308 190312 190320 190405 190410 190501 190503 190510 190607 190612 190619 190705 190711 190731 190802 190813 190906 190912 190918 191004 191010 191030 191101 191113 191206 191211 200110 200114 200129 200207 200213 200303 200306 200311 200315 200403 200410 200429 200508 200512 200605 200610 200702 200714 200729 200807 200812 200904 200911 200916 201002 201013 201105 201106 201112 201204 201210 201216 210108 210113 210127 210205 210210 210305 210310 210317 210402 210413 210428 210507 210512 210604 210610 210616 210702 210713 210728 210806 210811 210903 210914 210922 211008 211013 211103 211105 211110 211203 211210 211215 220107 220112 220126 220204 220210 220304 220310 220316 220401 220412 220504 220506 220511 220603 220610 220615 220708 220713 220727 220805 220810 220902 220913 220921 221007 221013 221102 221104 221110 221202 221213 221214 230106 230112 230201 230203 230214 230310 230314 230322 230407 230412 230503 230505 230510 230602 230613 230614 230707 230712 230726 230804 230810 230901 230913 230920 231006 231012 231101 231103 231114 231208 231212 231213 240105 240111 240131 240202 240213 240308 240312 240320 240405 240410 240501 240503 240515 240607 240612 240705 240711 240731 240802 240814 240906 240911 240918 241004 241010 241101 241107 241113 241206 241211 241218 250110 250115 250129 250207 250212 250307 250312 250319 250404 250410 250502 250507 250513 250606 250611 250618 250703 250715 250730 250801 250812 250905 250911 250917 251024 251029 251120 251210 251216 251218 260109 260113 260128 260211 260213 260306 260311 260318 260403 260410 260429 260508 260512 260605 260610 260617 260702 260714 260729 260807 260812 260904 260911 260916 261002 261028 261209 270127 270317 270428 270609 270728 270915 271027 271208'.split(' ').map(x => `20${x.slice(0, 2)}-${x.slice(2, 4)}-${x.slice(4, 6)}`));
E.EVENT_COVER = '2026-10-03';   // CPI/NFP dates are known up to this UTC date; later days need the live calendar
E.loadCalendar = function (news) {   // news.json content -> adds event days; returns a warning string or null
  try {
    if (!news || !Array.isArray(news.calendar) || !news.calendar_fetched_at) return 'ไม่มีปฏิทินข่าว (news.json) · ข้ามตัวกรองวันข่าวแรงสำหรับวันที่ยังไม่รู้';
    for (const x of news.calendar) {
      if (x.ccy !== 'USD' || !x.t) continue; const tt = String(x.title || '');
      if (/\bCPI\b/.test(tt) || /Non-Farm Employment Change/i.test(tt) || /FOMC Statement|Federal Funds Rate/i.test(tt)) E.EVENT_DAYS.add(new Date(x.t * 1000).toISOString().slice(0, 10));
    }
    // ForexFactory week = Sunday..Saturday (New York); the fetched week is fully covered
    const f = new Date(news.calendar_fetched_at * 1000 - 4 * 3600 * 1000), sat = new Date(f.getTime() + (6 - f.getUTCDay()) * 86400000).toISOString().slice(0, 10);
    if (sat > E.EVENT_COVER) E.EVENT_COVER = sat;
    return null;
  } catch (e) { return 'อ่านปฏิทินข่าวไม่ได้: ' + e.message; }
};
E.isEventDay = function (t) { const d = new Date(t * 1000).toISOString().slice(0, 10); return E.EVENT_DAYS.has(d) ? true : d <= E.EVENT_COVER ? false : null; };
// London/New York overlap 12:00-16:00 UTC (19:00-23:00 Bangkok). Walk-forward research (xau-research, 2022-2026) found M5 signals in this window
// beat the 24h engine out-of-sample in 17/20, 8/10 and 5/5 quarterly folds (PAXG all / PAXG 2024Q3+ / XAUT), but it is NOT a proven positive edge.
E.GOOD_SESSION = {fromUTC: 12, toUTC: 16};
E.inGoodSession = function (t) { const h = new Date(t * 1000).getUTCHours(); return h >= E.GOOD_SESSION.fromUTC && h < E.GOOD_SESSION.toUTC; };
const PIV = 3;
E.PIV = PIV;

// ---------------- indicators ----------------
function ema(v, p) {
  const out = new Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, sum = 0, cnt = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue;
    if (prev == null) { sum += x; if (++cnt === p) { prev = sum / p; out[i] = prev; } } else { prev = x * k + prev * (1 - k); out[i] = prev; } }
  return out;
}
function sma(v, p) {
  const out = new Array(v.length).fill(null); let sum = 0, cnt = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] == null) { sum = 0; cnt = 0; continue; }
    sum += v[i]; cnt++;
    if (cnt > p) { sum -= v[i - p]; cnt = p; }
    if (cnt === p) out[i] = sum / p;
  }
  return out;
}
function rsi(c, p = 14) {
  const out = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
  return out;
}
function atr(b, p = 14) {
  const out = new Array(b.length).fill(null); let a = 0;
  for (let i = 1; i < b.length; i++) { const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i <= p) { a += tr; if (i === p) { a /= p; out[i] = a; } } else { a = (a * (p - 1) + tr) / p; out[i] = a; } }
  return out;
}
function adx(b, p = 14) {
  const n = b.length, ADX = new Array(n).fill(null), PDI = new Array(n).fill(null), MDI = new Array(n).fill(null);
  let str = 0, sp = 0, sm = 0, dxs = [], adxPrev = null;
  for (let i = 1; i < n; i++) {
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
    const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    if (i <= p) { str += tr; sp += pdm; sm += mdm; if (i < p) continue; }
    else { str = str - str / p + tr; sp = sp - sp / p + pdm; sm = sm - sm / p + mdm; }
    const pdi = str ? 100 * sp / str : 0, mdi = str ? 100 * sm / str : 0, dx = pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
    PDI[i] = pdi; MDI[i] = mdi;
    if (adxPrev == null) { dxs.push(dx); if (dxs.length === p) { adxPrev = dxs.reduce((a, x) => a + x, 0) / p; ADX[i] = adxPrev; } }
    else { adxPrev = (adxPrev * (p - 1) + dx) / p; ADX[i] = adxPrev; }
  }
  return {adx: ADX, pdi: PDI, mdi: MDI};
}
function macd(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = c.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  const sig = ema(line, 9);
  return {line, sig, hist: line.map((x, i) => x != null && sig[i] != null ? x - sig[i] : null)};
}
function stochRsi(r, p = 14) {
  const st = r.map((x, i) => {
    if (x == null || i < p - 1) return null; let mn = Infinity, mx = -Infinity;
    for (let k = i - p + 1; k <= i; k++) { if (r[k] == null) return null; mn = Math.min(mn, r[k]); mx = Math.max(mx, r[k]); }
    return mx === mn ? 50 : 100 * (x - mn) / (mx - mn);
  });
  const K = sma(st, 3), D = sma(K, 3);
  return {k: K, d: D};
}
function boll(c, p = 20, m = 2) {
  const mid = sma(c, p), up = [], lo = [], bw = [], sq = [];
  for (let i = 0; i < c.length; i++) {
    if (mid[i] == null) { up.push(null); lo.push(null); bw.push(null); sq.push(false); continue; }
    let s = 0; for (let k = i - p + 1; k <= i; k++) s += (c[k] - mid[i]) ** 2;
    const sd = Math.sqrt(s / p); up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd); bw.push(2 * m * sd / mid[i]);
    const hist = []; for (let k = Math.max(0, i - 120); k < i; k++) if (bw[k] != null) hist.push(bw[k]);
    if (hist.length >= 50) { hist.sort((a, b) => a - b); sq.push(bw[i] <= hist[Math.floor(hist.length * 0.2)]); } else sq.push(false);
  }
  return {mid, up, lo, bw, sq};
}
function vwap(b) {
  const out = new Array(b.length).fill(null); let day = -1, pv = 0, vv = 0;
  for (let i = 0; i < b.length; i++) {
    const d = Math.floor(b[i].t / 86400); if (d !== day) { day = d; pv = 0; vv = 0; }
    const v = b[i].v || 0; pv += (b[i].h + b[i].l + b[i].c) / 3 * v; vv += v;
    out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}
function trendOf(c, e20, e50) {
  if (e20 == null || e50 == null) return null;
  if (c > e50 && e20 > e50) return 'up';
  if (c < e50 && e20 < e50) return 'down';
  return 'side';
}
E.trendOf = trendOf;

E.compute = function (bars) {
  const n = bars.length, c = bars.map(b => b.c), v = bars.map(b => b.v || 0);
  const ind = {c, e9: ema(c, 9), e20: ema(c, 20), e50: ema(c, 50), e200: ema(c, 200), rsi: rsi(c), atr: atr(bars), md: macd(c), adx: adx(bars), bb: boll(c), vwap: vwap(bars)};
  ind.st = stochRsi(ind.rsi);
  ind.volAvg = sma(v, 20); ind.hasVol = v.some(x => x > 0);
  { const A = ind.atr, ps = [0], pc = [0];   // ATR relative to its 1000-bar mean (same definition as features.js atr_rel)
    for (let i = 0; i < n; i++) { ps.push(ps[i] + (A[i] == null ? 0 : A[i])); pc.push(pc[i] + (A[i] == null ? 0 : 1)); }
    ind.atrRel = A.map((a, i) => { const lo = Math.max(0, i - 999), k = pc[i + 1] - pc[lo]; return a == null || !k ? null : a / ((ps[i + 1] - ps[lo]) / k); }); }
  const pivH = [], pivL = [];
  for (let i = PIV; i < n - PIV; i++) {
    let isH = true, isL = true;
    for (let k = i - PIV; k <= i + PIV; k++) { if (k === i) continue; if (bars[k].h > bars[i].h) isH = false; if (bars[k].l < bars[i].l) isL = false; }
    if (isH) pivH.push(i); if (isL) pivL.push(i);
  }
  ind.pivH = pivH; ind.pivL = pivL;
  return ind;
};

// ---------------- higher/lower TF models ----------------
E.tfModel = function (bars, sec) {
  const c = bars.map(b => b.c), e20 = ema(c, 20), e50 = ema(c, 50);
  return {bars, sec, tr: bars.map((b, i) => trendOf(b.c, e20[i], e50[i]))};
};
// trend of the last candle of that TF that was CLOSED at time tEnd
E.trendAt = function (m, tEnd) {
  if (!m || !m.bars.length) return null;
  let lo = 0, hi = m.bars.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (m.bars[mid].t + m.sec <= tEnd) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx < 0) return null;
  if (tEnd - (m.bars[idx].t + m.sec) > 3 * m.sec + 3600 * 72) return null; // data gap / stale
  return m.tr[idx];
};
function dayMap(bars) {
  const m = new Map();
  for (const b of bars) { const d = Math.floor(b.t / 86400); const x = m.get(d); if (!x) m.set(d, {h: b.h, l: b.l, c: b.c}); else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; } }
  return m;
}
function pivotsFor(dm, t) {
  let d = Math.floor(t / 86400) - 1, x = null;
  for (let k = 0; k < 4 && !x; k++, d--) x = dm.get(d);   // previous trading day
  if (!x) return [];
  const P = (x.h + x.l + x.c) / 3;
  return [{v: P, n: 'Pivot P'}, {v: 2 * P - x.l, n: 'R1'}, {v: 2 * P - x.h, n: 'S1'}, {v: P + (x.h - x.l), n: 'R2'}, {v: P - (x.h - x.l), n: 'S2'}];
}

E.makeCtx = function (tf, mtf, extra) {
  const daySrc = mtf && mtf.H1 && mtf.H1.bars.length ? mtf.H1.bars : null;
  return {tf, sec: E.TF_SEC[tf], mtf: mtf || {}, dm: daySrc ? dayMap(daySrc) : null, d1: extra && extra.d1 ? extra.d1 : E.DAILY};
};

function levelsAt(bars, ind, j, ctx) {
  const px = ind.c[j]; let sup = null, res = null, supN = '', resN = '';
  for (const i of ind.pivL) { if (i + PIV > j) break; if (i < j - 200) continue; const v = bars[i].l; if (v < px && (sup == null || v > sup)) { sup = v; supN = 'แนวรับ swing'; } }
  for (const i of ind.pivH) { if (i + PIV > j) break; if (i < j - 200) continue; const v = bars[i].h; if (v > px && (res == null || v < res)) { res = v; resN = 'แนวต้าน swing'; } }
  const dm = ctx.dm || (ctx._dmLocal || (ctx._dmLocal = dayMap(bars)));
  for (const p of pivotsFor(dm, bars[j].t)) {
    if (p.v < px && (sup == null || p.v > sup)) { sup = p.v; supN = p.n; }
    if (p.v > px && (res == null || p.v < res)) { res = p.v; resN = p.n; }
  }
  return {sup, res, supN, resN};
}
E.levelsAt = levelsAt;
function lastPivots(list, j, count) { const out = []; for (let k = list.length - 1; k >= 0 && out.length < count; k--) if (list[k] + PIV <= j) out.unshift(list[k]); return out; }

const TH = {up: 'ขาขึ้น', down: 'ขาลง', side: 'ไซด์เวย์'};
const f2 = x => x.toFixed(2);

// ---------------- confluence scoring of bar j ----------------
// returns {BUY:{conf,trig,factors}, SELL:{...}, mtf:{tf:trend}}
E.evalBar = function (bars, ind, j, ctx, tEnd) {
  const out = {BUY: {sum: 0, w: 0, trig: [], factors: []}, SELL: {sum: 0, w: 0, trig: [], factors: []}, mtf: {}};
  const A = ind.atr[j], b = bars[j], p = bars[j - 1], c = ind.c;
  if (j < 30 || A == null || ind.e50[j] == null || ind.rsi[j] == null || ind.md.hist[j - 1] == null) return null;
  const add = (key, w, sb, ss, nb, ns, tb, ts) => {
    out.BUY.sum += w * sb; out.BUY.w += w; out.SELL.sum += w * ss; out.SELL.w += w;
    out.BUY.factors.push({k: key, s: sb, n: nb}); out.SELL.factors.push({k: key, s: ss, n: ns});
    if (tb) out.BUY.trig.push(tb); if (ts) out.SELL.trig.push(ts);
  };
  // 1) multi-timeframe trend
  for (const tf of E.TF_LIST) {
    const tr = tf === ctx.tf ? trendOf(c[j], ind.e20[j], ind.e50[j]) : E.trendAt(ctx.mtf[tf], tEnd);
    out.mtf[tf] = tr; if (tr == null) continue;
    const s = tr === 'up' ? 1 : tr === 'down' ? -1 : 0;
    add('mtf_' + tf, E.MTF_W[tf], s, -s, `เทรนด์ ${tf} ${TH[tr]}`, `เทรนด์ ${tf} ${TH[tr]}`);
  }
  // 2) EMA 9/20/50/200 stack
  { const e9 = ind.e9[j], e20 = ind.e20[j], e50 = ind.e50[j], e200 = ind.e200[j];
    const checks = [c[j] > e9, e9 > e20, e20 > e50]; if (e200 != null) checks.push(e50 > e200, c[j] > e200);
    const bull = checks.filter(Boolean).length, s = (2 * bull - checks.length) / checks.length;
    const crossUp = ind.e9[j - 1] <= ind.e20[j - 1] && e9 > e20 && c[j] > e50, crossDn = ind.e9[j - 1] >= ind.e20[j - 1] && e9 < e20 && c[j] < e50;
    add('ema', E.W.ema, s, -s, `EMA เรียงตัวขาขึ้น ${bull}/${checks.length}`, `EMA เรียงตัวขาลง ${checks.length - bull}/${checks.length}`, crossUp && 'EMA9 ตัดขึ้น EMA20', crossDn && 'EMA9 ตัดลง EMA20');
    // pullback to EMA20 inside a trend
    const pbB = e20 > e50 && b.l <= e20 + 0.15 * A && b.c > e20 && b.c > b.o, pbS = e20 < e50 && b.h >= e20 - 0.15 * A && b.c < e20 && b.c < b.o;
    if (pbB || pbS) add('pullback', E.W.pullback, pbB ? 1 : -1, pbS ? 1 : -1, 'ย่อแตะ EMA20 แล้วเด้ง', 'เด้งแตะ EMA20 แล้วถูกกด', pbB && 'ย่อแตะ EMA20 ในขาขึ้น', pbS && 'เด้งแตะ EMA20 ในขาลง');
  }
  // 3) ADX trend strength
  { const a = ind.adx.adx[j];
    if (a != null) {
      if (a < 18) add('adx', E.W.adx, -0.3, -0.3, `ADX ${a.toFixed(0)} ตลาดไม่มีเทรนด์`, `ADX ${a.toFixed(0)} ตลาดไม่มีเทรนด์`);
      else { const d = (ind.adx.pdi[j] > ind.adx.mdi[j] ? 1 : -1) * Math.min(1, Math.max(0, (a - 15) / 20)); add('adx', E.W.adx, d, -d, `ADX ${a.toFixed(0)} ${d > 0 ? '+DI นำ' : '-DI นำ'}`, `ADX ${a.toFixed(0)} ${d < 0 ? '-DI นำ' : '+DI นำ'}`); }
    } }
  // 4) RSI
  { const r = ind.rsi[j], sc = x => x > 75 ? -0.6 : x >= 50 ? 0.7 : x >= 30 ? -0.5 : 0.2;
    add('rsi', E.W.rsi, sc(r), sc(100 - r), `RSI ${r.toFixed(0)}`, `RSI ${r.toFixed(0)}`); }
  // 5) RSI divergence (confirmed pivots)
  { const pl = lastPivots(ind.pivL, j, 2), ph = lastPivots(ind.pivH, j, 2);
    let db = 0, ds = 0, tb = null, ts = null;
    if (pl.length === 2 && j - pl[1] <= 10 && pl[1] - pl[0] <= 40 && bars[pl[1]].l < bars[pl[0]].l && ind.rsi[pl[1]] > ind.rsi[pl[0]] + 2) { db = 1; if (pl[1] + PIV === j) tb = 'RSI Bullish Divergence'; }
    if (ph.length === 2 && j - ph[1] <= 10 && ph[1] - ph[0] <= 40 && bars[ph[1]].h > bars[ph[0]].h && ind.rsi[ph[1]] < ind.rsi[ph[0]] - 2) { ds = 1; if (ph[1] + PIV === j) ts = 'RSI Bearish Divergence'; }
    if (db || ds) add('div', E.W.div, db - ds, ds - db, db ? 'RSI Bullish Divergence' : 'มี Bearish Divergence', ds ? 'RSI Bearish Divergence' : 'มี Bullish Divergence', tb, ts); }
  // 6) MACD
  { const m = ind.md, h = m.hist[j], hp = m.hist[j - 1];
    const s = 0.5 * (m.line[j] > m.sig[j] ? 1 : -1) + 0.5 * (h > hp ? 1 : -1);
    const cu = m.line[j - 1] <= m.sig[j - 1] && m.line[j] > m.sig[j], cd = m.line[j - 1] >= m.sig[j - 1] && m.line[j] < m.sig[j];
    add('macd', E.W.macd, s, -s, `MACD ${s > 0 ? 'หนุนขาขึ้น' : 'ยังไม่หนุน'}`, `MACD ${s < 0 ? 'หนุนขาลง' : 'ยังไม่หนุน'}`, cu && 'MACD ตัดขึ้น', cd && 'MACD ตัดลง'); }
  // 7) Stochastic RSI
  { const K = ind.st.k[j], D = ind.st.d[j], Kp = ind.st.k[j - 1], Dp = ind.st.d[j - 1];
    if (K != null && D != null && Kp != null && Dp != null) {
      const cu = Kp <= Dp && K > D && Math.min(Kp, Dp) < 25, cd = Kp >= Dp && K < D && Math.max(Kp, Dp) > 75;
      const sb = cu ? 1 : K > 90 ? -0.4 : K > D ? 0.4 : -0.4, ss = cd ? 1 : K < 10 ? -0.4 : K < D ? 0.4 : -0.4;
      add('stoch', E.W.stoch, sb, ss, `StochRSI ${K.toFixed(0)}${cu ? ' ตัดขึ้นจากโซนต่ำ' : ''}`, `StochRSI ${K.toFixed(0)}${cd ? ' ตัดลงจากโซนสูง' : ''}`, cu && 'StochRSI ตัดขึ้นจาก Oversold', cd && 'StochRSI ตัดลงจาก Overbought');
    } }
  // 8) Bollinger Bands squeeze/breakout/bounce
  { const B = ind.bb; if (B.up[j] != null) {
      const sq = B.sq[j - 1] || B.sq[j - 2];
      if (sq && b.c > B.up[j]) add('bb', E.W.bb, 1, -1, 'BB บีบตัวแล้วเบรกขึ้น', 'BB เบรกขึ้น', 'Bollinger squeeze breakout ขึ้น', null);
      else if (sq && b.c < B.lo[j]) add('bb', E.W.bb, -1, 1, 'BB เบรกลง', 'BB บีบตัวแล้วเบรกลง', null, 'Bollinger squeeze breakout ลง');
      else if (b.l <= B.lo[j] && b.c > B.lo[j] && b.c > b.o) add('bb', E.W.bb, 0.7, -0.5, 'เด้งจากขอบล่าง BB', 'ราคาเด้งจากขอบล่าง BB', 'เด้งขอบล่าง Bollinger', null);
      else if (b.h >= B.up[j] && b.c < B.up[j] && b.c < b.o) add('bb', E.W.bb, -0.5, 0.7, 'ราคาโดนกดจากขอบบน BB', 'โดนกดจากขอบบน BB', null, 'โดนกดจากขอบบน Bollinger');
    } }
  // 9) VWAP (daily, needs volume)
  { const vw = ind.vwap[j], vp = ind.vwap[j - 1];
    if (vw != null && vp != null) {
      const cu = c[j - 1] <= vp && c[j] > vw, cd = c[j - 1] >= vp && c[j] < vw, s = c[j] > vw ? 0.6 : -0.6;
      add('vwap', E.W.vwap, cu ? 1 : s, cd ? 1 : -s, `ราคา${c[j] > vw ? 'เหนือ' : 'ใต้'} VWAP ${f2(vw)}`, `ราคา${c[j] < vw ? 'ใต้' : 'เหนือ'} VWAP ${f2(vw)}`, cu && 'ตัดขึ้นเหนือ VWAP', cd && 'หลุดลงใต้ VWAP');
    } }
  // 10) Support/Resistance + daily pivots
  { const L = levelsAt(bars, ind, j, ctx), Lp = levelsAt(bars, ind, j - 1, ctx);
    let sb = null, ss = null, nb = '', ns = '', tb = null, ts = null;
    if (Lp.res != null && c[j - 1] <= Lp.res && b.c > Lp.res + 0.1 * A) { sb = 0.8; ss = -0.8; nb = ns = `เบรก ${Lp.resN} ${f2(Lp.res)}`; tb = nb; }
    else if (Lp.sup != null && c[j - 1] >= Lp.sup && b.c < Lp.sup - 0.1 * A) { sb = -0.8; ss = 0.8; nb = ns = `หลุด ${Lp.supN} ${f2(Lp.sup)}`; ts = ns; }
    else {
      if (L.sup != null && b.l <= L.sup + 0.3 * A && b.c > L.sup && b.c > b.o) { sb = 1; nb = `เด้งจาก ${L.supN} ${f2(L.sup)}`; tb = nb; }
      else if (L.res != null && L.res - b.c < 0.5 * A) { sb = -0.6; nb = `ใกล้ ${L.resN} ${f2(L.res)} (ที่ว่างน้อย)`; }
      if (L.res != null && b.h >= L.res - 0.3 * A && b.c < L.res && b.c < b.o) { ss = 1; ns = `ถูกกดจาก ${L.resN} ${f2(L.res)}`; ts = ns; }
      else if (L.sup != null && b.c - L.sup < 0.5 * A) { ss = -0.6; ns = `ใกล้ ${L.supN} ${f2(L.sup)} (ที่ว่างน้อย)`; }
    }
    if (sb != null || ss != null) add('sr', E.W.sr, sb || 0, ss || 0, nb || 'แนวรับ/ต้าน', ns || 'แนวรับ/ต้าน', tb, ts); }
  // 11) Candlestick patterns
  { const body = Math.abs(b.c - b.o), rng = b.h - b.l, pb = Math.abs(p.c - p.o);
    const lw = Math.min(b.o, b.c) - b.l, uw = b.h - Math.max(b.o, b.c);
    let s = 0, n = '';
    if (p.c < p.o && b.c > b.o && b.c >= p.o && b.o <= p.c && body > pb) { s = 1; n = 'Bullish Engulfing'; }
    else if (p.c > p.o && b.c < b.o && b.c <= p.o && b.o >= p.c && body > pb) { s = -1; n = 'Bearish Engulfing'; }
    else if (rng >= 0.5 * A && lw >= 2 * body && lw >= 0.6 * rng) { s = 0.8; n = 'Pin bar ขาขึ้น (หางล่างยาว)'; }
    else if (rng >= 0.5 * A && uw >= 2 * body && uw >= 0.6 * rng) { s = -0.8; n = 'Pin bar ขาลง (หางบนยาว)'; }
    else if (j >= 2) { const mo = bars[j - 2]; if (p.h <= mo.h && p.l >= mo.l) { if (b.c > mo.h) { s = 0.7; n = 'Inside bar เบรกขึ้น'; } else if (b.c < mo.l) { s = -0.7; n = 'Inside bar เบรกลง'; } } }
    if (s) add('candle', E.W.candle, s, -s, n, n, s > 0 && n, s < 0 && n); }
  // 12) Market structure HH/HL, LH/LL, Break of Structure
  { const ph = lastPivots(ind.pivH, j, 2), pl = lastPivots(ind.pivL, j, 2);
    if (ph.length === 2 && pl.length === 2) {
      const HH = bars[ph[1]].h > bars[ph[0]].h, HL = bars[pl[1]].l > bars[pl[0]].l;
      let s = HH && HL ? 0.7 : !HH && !HL ? -0.7 : 0, n = HH && HL ? 'โครงสร้าง HH/HL' : !HH && !HL ? 'โครงสร้าง LH/LL' : 'โครงสร้างไม่ชัด', tb = null, ts = null;
      const lh = bars[ph[1]].h, ll = bars[pl[1]].l;
      if (c[j - 1] <= lh && b.c > lh) { s = 1; n = `Break of Structure ขึ้น ${f2(lh)}`; tb = n; }
      else if (c[j - 1] >= ll && b.c < ll) { s = -1; n = `Break of Structure ลง ${f2(ll)}`; ts = n; }
      add('struct', E.W.struct, s, -s, n, n, tb, ts);
    } }
  // 13) Volume confirmation (exchange volume of the gold token)
  { const va = ind.volAvg[j];
    if (ind.hasVol && va && (b.v || 0) > 1.5 * va) { const s = b.c > b.o ? 0.8 : b.c < b.o ? -0.8 : 0; if (s) add('vol', E.W.vol, s, -s, `Volume สูง ${((b.v) / va).toFixed(1)}x`, `Volume สูง ${((b.v) / va).toFixed(1)}x`); } }

  for (const d of ['BUY', 'SELL']) { const o = out[d]; o.conf = o.w ? Math.round(50 + 50 * o.sum / o.w) : 0; }
  out.atrRel = ind.atrRel ? ind.atrRel[j] : null; out.hourUTC = new Date(b.t * 1000).getUTCHours();
  out.t = b.t; out.htf = E.htfTrendAt(ctx.d1, tEnd);   // D1/W1 context (null = daily data missing -> that input is skipped)
  return out;
};

// ---------------- risk model + outcome ----------------
E.levelsFor = function (bars, ind, j, dir, long, entry, opt) {
  const A = ind.atr[j], sm = long ? opt.slLong : opt.slShort, minD = sm[0] * A, maxD = sm[1] * A, lo = Math.max(0, j - 4);
  let sl;
  if (dir === 'BUY') { const sw = Math.min(...bars.slice(lo, j + 1).map(x => x.l)) - 0.2 * A; sl = Math.min(sw, entry - minD); sl = Math.max(sl, entry - maxD); }
  else { const sw = Math.max(...bars.slice(lo, j + 1).map(x => x.h)) + 0.2 * A; sl = Math.max(sw, entry + minD); sl = Math.min(sl, entry + maxD); }
  const rr = long ? opt.rrLong : opt.rrShort, risk = Math.abs(entry - sl);
  return {sl, tp: dir === 'BUY' ? entry + rr * risk : entry - rr * risk, rr};
};
E.outcome = function (bars, fromIdx, dir, sl, tp, entry, beAtR) {   // SL checked first within a bar (conservative)
  // optional break-even: once price reaches entry +/- beAtR x risk, the stop moves to entry from the NEXT bar ('be' result)
  const be = entry != null && beAtR ? entry + (dir === 'BUY' ? 1 : -1) * beAtR * Math.abs(entry - sl) : null; let stop = sl, armed = false;
  for (let k = fromIdx; k < bars.length; k++) { const x = bars[k];
    if (dir === 'BUY') { if (x.l <= stop) return {r: armed ? 'be' : 'loss', k}; if (x.h >= tp) return {r: 'win', k}; if (be != null && !armed && x.h >= be) { armed = true; stop = entry; } }
    else { if (x.h >= stop) return {r: armed ? 'be' : 'loss', k}; if (x.l <= tp) return {r: 'win', k}; if (be != null && !armed && x.l <= be) { armed = true; stop = entry; } } }
  return {r: 'open', k: -1};
};
E.isLong = function (ev, dir) { const want = dir === 'BUY' ? 'up' : 'down'; return ev.mtf.H1 === want && ev.mtf.H4 === want && ev.mtf.M15 !== (want === 'up' ? 'down' : 'up'); };

// golive filters: returns a Thai reason when direction d is blocked, else null
E.blockReason = function (ev, d, opt) {
  opt = opt || E.DEFAULTS; const long = E.isLong(ev, d), want = d === 'BUY' ? 'up' : 'down';
  if (opt.minAtrRel && ev.atrRel != null && ev.atrRel < opt.minAtrRel) return 'ตลาดนิ่งเกินไป (ATR ต่ำกว่าปกติ)';
  if (long && opt.holdNeedM15 && ev.mtf.M15 !== want) return 'ไม้ถือยาวต้องให้เทรนด์ M15 ไปทางเดียวกัน';
  if (!long && opt.scalpSessUTC && ev.hourUTC != null && !(ev.hourUTC >= opt.scalpSessUTC[0] && ev.hourUTC < opt.scalpSessUTC[1])) return 'ไม้เก็บสั้นส่งเฉพาะช่วง 19:00–23:00 น.';
  if (long && opt.holdNeedW1D1 && ev.htf && !(ev.htf.d1 === want && ev.htf.w1 === want)) return 'ไม้ถือยาวต้องให้เทรนด์ D1 และ W1 ไปทางเดียวกัน';
  if (long && opt.holdSkipEventDays && ev.t != null && E.isEventDay(ev.t) === true) return 'วันนี้มีข่าวแรง (CPI/NFP/FOMC) · งดไม้ถือยาว';
  return null;
};
function pick(ev, threshold, filterH4, opt) {
  let best = null;
  for (const d of ['BUY', 'SELL']) { const o = ev[d];
    if (filterH4 && ev.mtf.H4 === (d === 'BUY' ? 'down' : 'up')) continue;   // never trade against the H4 trend
    if (E.blockReason(ev, d, opt)) continue;
    if (o.conf >= threshold && o.trig.length && (!best || o.conf > ev[best].conf)) best = d; }
  return best;
}
E.pick = pick;
E.makeSignal = function (bars, ind, j, ev, dir, entry, opt) {
  const long = E.isLong(ev, dir), lv = E.levelsFor(bars, ind, j, dir, long, entry, opt), o = ev[dir];
  const agree = o.factors.filter(f => f.s > 0.25).sort((a, b) => b.s - a.s).map(f => f.n);
  const against = o.factors.filter(f => f.s < -0.25).map(f => f.n);
  return {t: bars[j].t, idx: j, dir, long, entry, sl: lv.sl, tp: lv.tp, rr: lv.rr, conf: o.conf, trig: o.trig.slice(), agree, against, goodSess: E.inGoodSession(bars[j].t)};
};

// evaluate all closed bars once; signals for any threshold can be derived cheaply
E.evaluateAll = function (bars, ind, ctx, lastClosed) {
  const evs = new Array(bars.length).fill(null);
  for (let j = 30; j <= lastClosed; j++) evs[j] = E.evalBar(bars, ind, j, ctx, bars[j].t + ctx.sec);
  return evs;
};
E.signalsFrom = function (bars, ind, evs, opt) {
  opt = Object.assign({}, E.DEFAULTS, opt); const out = []; let lastB = -99, lastS = -99;
  for (let j = 0; j < evs.length; j++) { const ev = evs[j]; if (!ev) continue;
    if (opt.sessionOnly && !E.inGoodSession(bars[j].t)) continue;
    const d = pick(ev, opt.threshold, opt.filterH4, opt); if (!d) continue;
    if (d === 'BUY' ? j - lastB <= opt.cooldown : j - lastS <= opt.cooldown) continue;
    const s = E.makeSignal(bars, ind, j, ev, d, bars[j].c, opt);
    const oc = E.outcome(bars, j + 1, d, s.sl, s.tp, bars[j].t >= E.GOLIVE_T ? s.entry : null, opt.beAtR); s.result = oc.r; s.exitIdx = oc.k;
    out.push(s); if (d === 'BUY') lastB = j; else lastS = j;
  }
  return out;
};

if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
