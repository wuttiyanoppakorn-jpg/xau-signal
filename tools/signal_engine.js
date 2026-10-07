// Runs the exact web engine (engine.js, same file the site inlines) on live public candles and prints JSON. Called by signal.py.
const E = require(require('fs').existsSync(__dirname + '/engine.js') ? './engine.js' : '../src/engine.js');
const a = JSON.parse(process.argv[2] || '{}');
const TF = a.tf || 'M5', TH = a.threshold || E.DEFAULTS.threshold, LOOK = a.lookback || 3, SESS = !!a.sessionOnly;
const IV = {M1: '1', M5: '5', M15: '15', H1: '60', H4: '240'};
async function j(u) { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, {signal: AbortSignal.timeout(10000)}); if (r.ok) return await r.json(); } catch (e) {} await new Promise(r => setTimeout(r, 800)); } throw new Error('fetch failed ' + u); }
async function bybit(tf, limit = 1000) {
  const d = await j(`https://api.bybit.com/v5/market/kline?category=spot&symbol=XAUTUSDT&interval=${IV[tf]}&limit=${limit}`);
  return d.result.list.map(x => ({t: +x[0] / 1000, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5]})).reverse();
}
(async () => {
  const [bars, ...others] = await Promise.all([bybit(TF), ...E.TF_LIST.filter(t => t !== TF).map(t => bybit(t))]);
  const mtf = {}; E.TF_LIST.filter(t => t !== TF).forEach((t, i) => mtf[t] = E.tfModel(others[i], E.TF_SEC[t]));
  let spot = null; try { const s = await j('https://api.gold-api.com/price/XAU'); spot = s && s.price ? +s.price : null; } catch (e) {}
  const sec = E.TF_SEC[TF], now = Date.now() / 1000, n = bars.length;
  const forming = bars[n - 1].t + sec > now; const lastClosed = forming ? n - 2 : n - 1;
  const ctx = E.makeCtx(TF, mtf), ind = E.compute(bars);
  const evs = E.evaluateAll(bars, ind, ctx, lastClosed);
  const sigs = E.signalsFrom(bars, ind, evs, {threshold: TH, sessionOnly: SESS});
  const last = bars[lastClosed].c, off = spot != null ? last - spot : null;   // chart (XAUT) minus spot
  const fmt = (s, stage) => ({stage, side: s.dir, type: s.long ? 'hold' : 'scalp', type_th: s.long ? 'ถือยาว' : 'เก็บสั้นๆ', bar_open_utc: new Date(s.t * 1000).toISOString(), bar_open_bkk: new Date((s.t + 7 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' '),
    conf: s.conf, entry_xaut: +s.entry.toFixed(2), sl_xaut: +s.sl.toFixed(2), tp_xaut: +s.tp.toFixed(2), rr: s.rr,
    spot_note: 'spot levels use the CURRENT XAUT-spot gap', entry_spot: off != null ? +(s.entry - off).toFixed(2) : null, sl_spot: off != null ? +(s.sl - off).toFixed(2) : null, tp_spot: off != null ? +(s.tp - off).toFixed(2) : null,
    good_session: s.goodSess, triggers: s.trig, agree: s.agree.slice(0, 6), against: s.against.slice(0, 4), result_so_far: s.result});
  const confirmed = sigs.filter(s => s.idx > lastClosed - LOOK).map(s => fmt(s, 'confirmed'));
  let pre = [];
  if (forming) {
    const ev = E.evalBar(bars, ind, n - 1, ctx, now);
    if (ev && (!SESS || E.inGoodSession(bars[n - 1].t))) for (const d of ['BUY', 'SELL']) {
      const o = ev[d]; if (E.DEFAULTS.filterH4 && ev.mtf.H4 === (d === 'BUY' ? 'down' : 'up')) continue;
      const lastS = [...sigs].reverse().find(s => s.dir === d); if (lastS && n - 1 - lastS.idx <= E.DEFAULTS.cooldown) continue;
      if (o.trig.length && o.conf >= TH) pre.push(fmt(E.makeSignal(bars, ind, n - 1, ev, d, bars[n - 1].c, E.DEFAULTS), 'pre'));
    }
  }
  process.stdout.write(JSON.stringify({generated_utc: new Date().toISOString(), source: 'Bybit XAUT/USDT (same engine as the website)', tf: TF, threshold: TH, session_only: SESS,
    last_closed_bar_utc: new Date(bars[lastClosed].t * 1000).toISOString(), price_xaut: last, spot_xau: spot, xaut_minus_spot: off != null ? +off.toFixed(2) : null,
    in_good_session_now: E.inGoodSession(now), good_session_bkk: '19:00-23:00', setups: confirmed.concat(pre)}));
})().catch(e => { process.stdout.write(JSON.stringify({error: String(e.message || e)})); process.exit(2); });
