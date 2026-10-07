// download real history for backtesting (Bybit XAUTUSDT + Binance PAXGUSDT)
const fs = require('fs');
const BY = {M1: '1', M5: '5', M15: '15', H1: '60', H4: '240'}, BN = {M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h'};
const need = {M1: 3000, M5: 12000, M15: 4000, H1: 1500, H4: 600};
async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); }
async function bybit(tf, n) {
  let end = Date.now(), out = [];
  while (out.length < n) {
    const d = await j(`https://api.bybit.com/v5/market/kline?category=spot&symbol=XAUTUSDT&interval=${BY[tf]}&limit=1000&end=${end}`);
    const l = d.result.list; if (!l.length) break;
    out = out.concat(l.map(r => ({t: +r[0] / 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]})));
    end = +l[l.length - 1][0] - 1; if (l.length < 1000) break;
  }
  return out.sort((a, b) => a.t - b.t).filter((b, i, a) => !i || b.t !== a[i - 1].t);
}
async function binance(tf, n) {
  let end = Date.now(), out = [];
  while (out.length < n) {
    const l = await j(`https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=${BN[tf]}&limit=1000&endTime=${end}`);
    if (!l.length) break;
    out = out.concat(l.map(r => ({t: r[0] / 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]})));
    end = l[0][0] - 1; if (l.length < 1000) break;
  }
  return out.sort((a, b) => a.t - b.t).filter((b, i, a) => !i || b.t !== a[i - 1].t);
}
(async () => {
  for (const [name, fn] of [['bybit', bybit], ['binance', binance]]) {
    const data = {};
    for (const tf of Object.keys(need)) { data[tf] = await fn(tf, need[tf]); console.log(name, tf, data[tf].length, new Date(data[tf][0].t * 1000).toISOString()); }
    fs.writeFileSync(`data_${name}.json`, JSON.stringify(data));
  }
})();
