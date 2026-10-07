// Final backtest with the shipped defaults. Out-of-sample = last 40% of each dataset (never used for choosing settings).
const E = require('../src/engine.js'); const COST = 0.3;
const lines = ['| ข้อมูล | TF | ช่วง | ชุด | threshold | จำนวน | Win% | Expectancy (ก่อนต้นทุน) | Expectancy (หักสเปรด $0.30) |', '|---|---|---|---|---|---|---|---|---|'];
const st = x => { const c = x.filter(s => s.result !== 'open'); let R = 0, Rn = 0, w = 0; for (const s of c) { const r = Math.abs(s.entry - s.sl), p = s.result === 'win' ? Math.abs(s.tp - s.entry) : -r; R += p / r; Rn += (p - COST) / r; if (s.result === 'win') w++; } return [c.length, c.length ? (100 * w / c.length).toFixed(1) : '-', c.length ? (R / c.length).toFixed(3) : '-', c.length ? (Rn / c.length).toFixed(3) : '-']; };
for (const ds of ['bybit', 'binance']) for (const tf of ['M5', 'M15']) {
  const data = require(`./data_${ds}.json`), bars = data[tf], mtf = {}; for (const t of E.TF_LIST) if (t !== tf) mtf[t] = E.tfModel(data[t], E.TF_SEC[t]);
  const ind = E.compute(bars), evs = E.evaluateAll(bars, ind, E.makeCtx(tf, mtf), bars.length - 1); for (let j = 0; j < 250; j++) evs[j] = null;
  const split = Math.floor(250 + (bars.length - 250) * 0.6), d = i => new Date(bars[i].t * 1000 + 7 * 3600e3).toISOString().slice(0, 10);
  for (const th of [0, 60, 70, 80]) { const s = E.signalsFrom(bars, ind, evs, {threshold: th});
    for (const [nm, x, rg] of [['train', s.filter(q => q.idx < split), `${d(250)}→${d(split)}`], ['TEST', s.filter(q => q.idx >= split), `${d(split)}→${d(bars.length - 1)}`]]) {
      const r = st(x); lines.push(`| ${ds === 'bybit' ? 'Bybit XAUT' : 'Binance PAXG'} | ${tf} | ${rg} | ${nm} | ${th}% | ${r[0]} | ${r[1]} | ${r[2]}R | ${r[3]}R |`); } }
}
require('fs').writeFileSync('RESULTS.md', lines.join('\n') + '\n'); console.log(lines.join('\n'));
