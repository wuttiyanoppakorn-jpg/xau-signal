const E = require('../src/engine.js');
const ds = process.argv[2] || 'bybit', tf = process.argv[3] || 'M5', COST = +(process.argv[4] || 0.3);
const data = require(`./data_${ds}.json`);
const bars = data[tf];
const mtf = {}; for (const k of E.TF_LIST) if (k !== tf) mtf[k] = E.tfModel(data[k], E.TF_SEC[k]);
const ctx = E.makeCtx(tf, mtf), ind = E.compute(bars);
const t0 = Date.now(); const evs = E.evaluateAll(bars, ind, ctx, bars.length - 1); const ms = Date.now() - t0;
const WARM = 250, split = Math.floor(WARM + (bars.length - WARM) * 0.6);
for (let j = 0; j < WARM; j++) evs[j] = null;
function stats(sigs) {
  const c = sigs.filter(s => s.result !== 'open'); if (!c.length) return {n: 0};
  let R = 0, Rn = 0, w = 0;
  for (const s of c) { const risk = Math.abs(s.entry - s.sl), pnl = s.result === 'win' ? Math.abs(s.tp - s.entry) : -risk; R += pnl / risk; Rn += (pnl - COST) / risk; if (s.result === 'win') w++; }
  return {n: c.length, win: (100 * w / c.length).toFixed(1), expR: (R / c.length).toFixed(3), expRnet: (Rn / c.length).toFixed(3)};
}
const fmt = s => s.n ? `n=${String(s.n).padStart(4)} win=${s.win.padStart(5)}% exp=${s.expR.padStart(6)}R net=${s.expRnet.padStart(6)}R` : 'n=0';
console.log(`${ds} ${tf}: ${bars.length} bars ${new Date(bars[WARM].t * 1000).toISOString().slice(0, 16)} → ${new Date(bars.at(-1).t * 1000).toISOString().slice(0, 16)} | split at ${new Date(bars[split].t * 1000).toISOString().slice(0, 16)} | eval ${ms}ms | cost $${COST}/trade`);
const rows = [];
for (const th of [0, 55, 60, 62, 65, 68, 70, 72, 75, 78, 80, 85]) {
  const sigs = E.signalsFrom(bars, ind, evs, {threshold: th});
  const tr = sigs.filter(s => s.idx < split), te = sigs.filter(s => s.idx >= split);
  const split2 = x => [stats(x.filter(s => !s.long)), stats(x.filter(s => s.long))];
  console.log(`th=${String(th).padStart(2)} TRAIN ${fmt(stats(tr))} | TEST ${fmt(stats(te))} | test short ${fmt(split2(te)[0])} | test long ${fmt(split2(te)[1])}`);
}
