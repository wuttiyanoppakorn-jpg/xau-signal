# XAU signal engine — walk-forward research (2026-10-08)

## Data (all real, public, no auth; nothing synthesised)
| Source | Instrument | TFs | Range (UTC) | Bars |
|---|---|---|---|---|
| Binance public archives data.binance.vision | PAXG/USDT | M1 / M5 / M15 / H1 / H4 | 2020-08-28 12:00 → 2026-10-06 23:59 | 3,210,496 / 642,101 / 214,035 / 53,513 / 13,383 |
| Bybit public v5 kline API | XAUT/USDT | M5 / M15 / H1 / H4 | 2025-04-11 → 2026-10-07 20:40 | 156,801 / 52,267 / 13,067 / 3,268 |

Not used: Dukascopy (a single datafeed probe returned HTTP 429; the earlier freeserv endpoint needed a spoofed Referer), histdata.com (download sits behind an interactive form). So there is **no spot XAU/USD history**: all research runs on gold tokens. PAXG 2020-2023 is illiquid (19-47% flat M5 bars in 2020/2022/2023, versus 0.6% in 2025-26), which is why the PAXG ≥2024Q3 "liquid era" is reported separately.

## Method
* `extract.js` runs the **shipped engine.js** bar by bar (causal, 8000-bar segments + 1500-bar warm-up, MTF from the real M1/M15/H1/H4 series) and writes every bar/direction that has ≥1 trigger: all factor scores, confidence, trigger types + session, time of day, ATR (bp) and ATR regime, distances to M5 EMA20/50/200 and H1/H4 EMA20/50 (in ATR), swing distances, momentum, candle shape, relative volume.
* Labels: TP-before-SL, net of spread. BUY fills at ask (mid + $0.25) and exits at bid; SELL fills at bid and exits at ask. **A bar that touches both SL and TP counts as SL.** Exit at market after 48 h (576 M5 bars). Spot-closed hours (Fri 21:00 → Sun 22:00 UTC and the daily 21-22 UTC break) are excluded.
* Candidates: PAXG 559,606 (388,080 in market hours), XAUT 134,306 (96,302).
* Walk-forward: quarterly test folds (PAXG 2022Q1-2026Q4 = 20 folds, XAUT 2025Q4-2026Q4 = 5 folds). Everything (threshold, filters, SL/TP scheme, ML model + probability cut) is fitted only on data **before** the test quarter (expanding window; the ML probability cut is chosen on the last 25 % of the train window).
* Variants: A = fixed rules (thresholds, sessions, H4 filter, 13 SL/TP schemes), B = 1248-combination rule grid re-tuned per fold, C = logistic regression and LightGBM P(win) filters for 5 SL/TP schemes.

## Out-of-sample results (cell = trades · win% · expectancy R · PF · max DD in R · folds with positive expectancy · folds that beat A0)
| variant                                            | PAXG 22Q1-26Q4                                              | PAXG 24Q3-26Q4                                             | XAUT 25Q4-26Q4                                          |
|:---------------------------------------------------|:------------------------------------------------------------|:-----------------------------------------------------------|:--------------------------------------------------------|
| A0 current engine (th60, H4 filter), spread $0.25  | 49297 · 29.6% · -0.147R · PF 0.8 · DD 7822R · 5/20 · -      | 23432 · 33.2% · -0.027R · PF 0.96 · DD 1227R · 5/10 · -    | 10688 · 34.5% · +0.022R · PF 1.03 · DD 244R · 2/5 · -   |
| A0 gross (spread 0)                                | 49297 · 31.0% · -0.072R · PF 0.9 · DD 4948R · 7/20 · 20/20  | 23432 · 33.9% · +0.022R · PF 1.03 · DD 873R · 6/10 · 10/10 | 10688 · 35.0% · +0.057R · PF 1.09 · DD 218R · 3/5 · 5/5 |
| A0 spread $0.30                                    | 49297 · 29.3% · -0.163R · PF 0.78 · DD 8499R · 4/20 · 0/20  | 23432 · 33.1% · -0.037R · PF 0.95 · DD 1333R · 4/10 · 0/10 | 10688 · 34.4% · +0.015R · PF 1.02 · DD 269R · 2/5 · 0/5 |
| A1 threshold 50                                    | 60032 · 30.7% · -0.133R · PF 0.81 · DD 8685R · 6/20 · 12/20 | 28819 · 34.2% · -0.018R · PF 0.97 · DD 1238R · 6/10 · 5/10 | 13139 · 35.4% · +0.024R · PF 1.04 · DD 245R · 3/5 · 2/5 |
| A1 threshold 70                                    | 37567 · 28.7% · -0.150R · PF 0.8 · DD 6312R · 5/20 · 10/20  | 17721 · 32.7% · -0.017R · PF 0.98 · DD 973R · 5/10 · 7/10  | 8076 · 33.9% · +0.035R · PF 1.05 · DD 247R · 2/5 · 3/5  |
| A1 threshold 80                                    | 23998 · 27.6% · -0.145R · PF 0.81 · DD 4184R · 6/20 · 9/20  | 11267 · 32.0% · +0.007R · PF 1.01 · DD 668R · 5/10 · 7/10  | 5197 · 33.6% · +0.069R · PF 1.1 · DD 155R · 3/5 · 4/5   |
| A2 07-21 UTC only                                  | 34493 · 30.0% · -0.138R · PF 0.81 · DD 5181R · 4/20 · 12/20 | 16532 · 33.1% · -0.034R · PF 0.95 · DD 1022R · 4/10 · 3/10 | 7539 · 34.3% · +0.010R · PF 1.01 · DD 305R · 2/5 · 2/5  |
| A2 12-16 UTC only (19-23 BKK) <- shipped as opt-in | 8423 · 33.7% · -0.040R · PF 0.94 · DD 745R · 6/20 · 16/20   | 4098 · 35.6% · +0.040R · PF 1.06 · DD 251R · 5/10 · 7/10   | 1901 · 37.0% · +0.086R · PF 1.14 · DD 40R · 3/5 · 5/5   |
| A3 no H4 filter                                    | 67219 · 30.0% · -0.176R · PF 0.76 · DD 12209R · 4/20 · 7/20 | 31690 · 33.8% · -0.054R · PF 0.92 · DD 2096R · 4/10 · 3/10 | 14355 · 35.7% · +0.007R · PF 1.01 · DD 325R · 2/5 · 2/5 |
| A4 SL 1ATR RR1                                     | 49297 · 38.2% · -0.310R · PF 0.53 · DD 15283R · 0/20 · 2/20 | 23432 · 46.0% · -0.143R · PF 0.75 · DD 3359R · 0/10 · 1/10 | 10693 · 49.1% · -0.060R · PF 0.89 · DD 698R · 1/5 · 1/5 |
| A4 SL 1.5ATR RR1.5                                 | 49297 · 33.6% · -0.208R · PF 0.7 · DD 10292R · 3/20 · 2/20  | 23432 · 38.1% · -0.090R · PF 0.86 · DD 2128R · 3/10 · 2/10 | 10692 · 41.1% · -0.003R · PF 0.99 · DD 231R · 3/5 · 3/5 |
| A4 SL 2ATR RR2                                     | 49297 · 28.9% · -0.173R · PF 0.76 · DD 8944R · 3/20 · 5/20  | 23432 · 32.8% · -0.051R · PF 0.93 · DD 1588R · 3/10 · 5/10 | 10688 · 34.4% · +0.002R · PF 1.0 · DD 353R · 2/5 · 2/5  |
| A4 SL 3ATR RR1                                     | 49297 · 46.4% · -0.097R · PF 0.82 · DD 4795R · 3/20 · 14/20 | 23432 · 50.0% · -0.023R · PF 0.96 · DD 579R · 3/10 · 5/10  | 10687 · 49.7% · -0.021R · PF 0.96 · DD 403R · 2/5 · 1/5 |
| A4 SL 2ATR RR3                                     | 49297 · 22.1% · -0.166R · PF 0.79 · DD 9113R · 6/20 · 8/20  | 23432 · 25.7% · -0.017R · PF 0.98 · DD 1333R · 6/10 · 6/10 | 10688 · 27.0% · +0.040R · PF 1.05 · DD 311R · 2/5 · 5/5 |
| A4 swing SL RR1                                    | 49297 · 44.0% · -0.161R · PF 0.72 · DD 7929R · 1/20 · 8/20  | 23432 · 48.3% · -0.068R · PF 0.87 · DD 1602R · 1/10 · 3/10 | 10692 · 49.9% · -0.026R · PF 0.95 · DD 394R · 1/5 · 1/5 |
| A4 swing SL RR2                                    | 49296 · 29.0% · -0.173R · PF 0.77 · DD 8874R · 3/20 · 5/20  | 23431 · 32.6% · -0.060R · PF 0.91 · DD 1731R · 3/10 · 2/10 | 10689 · 34.7% · +0.012R · PF 1.02 · DD 234R · 3/5 · 3/5 |
| B rule grid re-tuned per fold (1248 combos)        | 8430 · 45.8% · -0.057R · PF 0.9 · DD 758R · 8/19 · 15/19    | 2775 · 47.0% · +0.075R · PF 1.14 · DD 79R · 7/9 · 7/9      | 787 · 27.8% · +0.071R · PF 1.1 · DD 50R · 2/4 · 2/4     |
| C logreg P(win), SL/TP cur                         | 7506 · 40.2% · -0.035R · PF 0.94 · DD 316R · 12/20 · 14/20  | 5806 · 39.9% · -0.036R · PF 0.94 · DD 316R · 5/10 · 5/10   | 7658 · 39.3% · -0.054R · PF 0.91 · DD 446R · 0/5 · 2/5  |
| C lgb P(win), SL/TP cur                            | 5889 · 44.1% · +0.056R · PF 1.1 · DD 178R · 11/20 · 13/20   | 2692 · 41.6% · +0.000R · PF 1.0 · DD 178R · 4/10 · 4/10    | 2561 · 40.6% · +0.050R · PF 1.08 · DD 140R · 2/4 · 2/4  |
| C logreg P(win), SL/TP f1_1                        | 10669 · 51.6% · -0.033R · PF 0.94 · DD 684R · 11/20 · 14/20 | 7986 · 49.4% · -0.067R · PF 0.87 · DD 684R · 4/10 · 4/10   | 1352 · 50.5% · -0.057R · PF 0.89 · DD 103R · 1/4 · 1/4  |
| C lgb P(win), SL/TP f1_1                           | 7233 · 55.4% · +0.040R · PF 1.08 · DD 291R · 10/20 · 13/20  | 4192 · 51.9% · -0.023R · PF 0.95 · DD 291R · 3/10 · 4/10   | 7220 · 49.8% · -0.068R · PF 0.87 · DD 517R · 2/4 · 1/4  |
| C logreg P(win), SL/TP f2_2                        | 8622 · 33.5% · -0.031R · PF 0.96 · DD 346R · 8/20 · 14/20   | 7271 · 33.5% · -0.028R · PF 0.96 · DD 346R · 4/10 · 5/10   | 3537 · 32.7% · -0.060R · PF 0.91 · DD 346R · 1/5 · 2/5  |
| C lgb P(win), SL/TP f2_2                           | 13312 · 35.2% · +0.016R · PF 1.02 · DD 316R · 12/20 · 17/20 | 10401 · 35.5% · +0.026R · PF 1.04 · DD 316R · 7/10 · 8/10  | 4389 · 35.7% · +0.040R · PF 1.06 · DD 231R · 1/3 · 1/3  |
| C logreg P(win), SL/TP sw_1.5                      | 8042 · 41.4% · -0.010R · PF 0.98 · DD 324R · 10/19 · 13/19  | 5992 · 40.7% · -0.020R · PF 0.97 · DD 324R · 3/9 · 4/9     | 8687 · 40.9% · -0.010R · PF 0.98 · DD 278R · 1/5 · 2/5  |
| C lgb P(win), SL/TP sw_1.5                         | 6434 · 45.5% · +0.087R · PF 1.15 · DD 90R · 12/19 · 14/19   | 3464 · 43.9% · +0.050R · PF 1.08 · DD 90R · 4/9 · 5/9      | 9324 · 41.6% · +0.007R · PF 1.01 · DD 298R · 2/4 · 1/4  |
| C logreg P(win), SL/TP f1.5_2                      | 11441 · 35.2% · +0.008R · PF 1.01 · DD 302R · 13/20 · 13/20 | 9560 · 34.7% · -0.004R · PF 0.99 · DD 302R · 5/10 · 5/10   | 7495 · 33.8% · -0.030R · PF 0.96 · DD 368R · 2/4 · 1/4  |
| C lgb P(win), SL/TP f1.5_2                         | 8907 · 37.2% · +0.058R · PF 1.09 · DD 69R · 17/20 · 17/20   | 5631 · 36.8% · +0.050R · PF 1.08 · DD 69R · 9/10 · 8/10    | 2090 · 37.5% · +0.070R · PF 1.11 · DD 128R · 2/4 · 3/4  |

## Extra checks on the best ML candidate (LightGBM, SL 1.5 ATR, RR 2), validate.py
* Re-run, seeds and hyper-parameters (7 configs): PAXG 2022Q1+ +0.038…+0.058 R, 13-16/20 positive folds; PAXG 2024Q3+ +0.019…+0.063 R, 5-9/10.
* Bootstrap by trading day, 90 % CI at $0.25: PAXG 2022Q1+ +0.039 [+0.014, +0.065]; PAXG 2024Q3+ +0.030 [-0.001, +0.062], beats A0 in only 6/10 folds; **PAXG 2025Q2+ (last 6 quarters) +0.012 [-0.024, +0.047], beats A0 in 3/7 folds**, about −0.001 R at $0.30.
* Cross-instrument (trained on PAXG history, traded on XAUT): +0.072 R [+0.019, +0.122], 3/4 folds positive.
* Verdict: most of its lead over A0 comes from the illiquid 2022-2024 PAXG period. In the recent liquid period it is not consistently better than the current engine, and on PAXG it does not beat break-even. On the same quarters it is clearly positive on XAUT and roughly flat on PAXG, so the edge is fragile. **Not shipped.**

## Session robustness (robust.py), current-engine trades by entry hour
The 12-16 UTC (19-23 Bangkok) window is the best stretch in all three samples, and its neighbours (13-16, 12-15, 12-17, 13-17) look the same. Outside it (Asia, London morning, late NY) expectancy is lower.
Day-block bootstrap of mean R in 12-16 UTC: PAXG 2022Q1+ −0.039 [−0.083, +0.008]; PAXG 2024Q3+ +0.045 [−0.021, +0.111]; XAUT +0.098 [+0.003, +0.193].
Beats the 24 h engine in 17/20, 8/10 and 5/5 folds (recent 7 PAXG quarters: 5/7).

## What was shipped
Only the session information, and only as an opt-in: each card gets a 🕖 "ช่วงดี" or "นอกช่วงดี" tag, plus a toggle "🕖 เฉพาะ 19:00–23:00 น." (off by default) that limits signals, pre-signals and alerts to 12-16 UTC. Engine scoring, threshold and SL/TP are unchanged. This is **not** a proven profitable edge: it is less bad than 24 h trading and slightly positive in the recent data.

## Honest bottom line
The current confluence engine is roughly break-even before costs (A0 gross: −0.07 R on PAXG 2022+, +0.02 R on PAXG 2024Q3+, +0.06 R on XAUT) and below break-even after a $0.25-0.30 spread in most folds. No rule tuning, SL/TP scheme or ML model gave a consistent, statistically solid positive edge after costs.

## Files
fetch_bybit.py, build_binance.py (data) · extract.js (features + labels using engine.js) · research.py (walk-forward, resumable: results/<sym>/*.pkl) · report.py / combined.py (tables) · robust.py · validate.py / boot.py · signal.py + signal_engine.js (chat routine).
