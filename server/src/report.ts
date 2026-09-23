/**
 * Tek dosyalık HTML rapor üreteci. Harici CSS/font, ağ isteği ve üçüncü taraf
 * JS yok — hem sonuç kartı (`renderResult`) hem de tüm zamanlar panosu
 * (`renderDashboard`) tek bir bağımsız `.html` dosyası üretir.
 */
import path from "node:path";
import type { HistoryRow, Personal } from "./history";
import type { Result, SeriesPoint, WordStat, KeyStat } from "./metrics";
import type { Lang, Options, Theme } from "./options";
import { reportsDir, writeFileSafe } from "./paths";
import type { Keystroke } from "./session";
import { escapeHtml } from "./text";

const WIDTH = 720;
const HEIGHT = 280;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 24;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const PLOT_H = HEIGHT - PAD_T - PAD_B;

const THEMES: Readonly<Record<Theme, string>> = {
  dark: "--bg:#141414;--fg:#e6e6e6;--dim:#8b8b8b;--accent:#e2b714;--err:#ca4754;--panel:#1e1e1e;",
  light: "--bg:#ffffff;--fg:#1c1c1c;--dim:#6b6b6b;--accent:#c99a0a;--err:#c33a3a;--panel:#f1f1f1;",
};

function styleSheet(themeVars: string): string {
  return `
:root{${themeVars}}
*{box-sizing:border-box;}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 Consolas,"Courier New",monospace;}
h1,h2,h3{font-weight:600;margin:0 0 12px;}
main{display:flex;flex-direction:column;gap:28px;max-width:960px;margin:0 auto;}
section{background:var(--panel);border-radius:8px;padding:18px 20px;}
.hero{max-width:960px;margin:0 auto 28px;text-align:center;}
.hero-numbers{display:flex;justify-content:center;gap:48px;margin-bottom:14px;}
.hero-num{display:flex;flex-direction:column;align-items:center;}
.big{font-size:48px;color:var(--accent);font-weight:700;}
.unit{font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
.chip{background:var(--panel);border:1px solid var(--dim);border-radius:12px;padding:3px 10px;font-size:12px;color:var(--fg);}
svg{width:100%;height:auto;display:block;}
.axis{stroke:var(--dim);stroke-width:1;}
.grid{stroke:var(--dim);stroke-width:.5;opacity:.35;}
.axis-label{fill:var(--dim);font-size:9px;}
.err-mark{fill:var(--err);font-size:11px;}
.line-a{stroke:var(--accent);stroke-width:2;}
.line-b{stroke:var(--dim);stroke-width:2;}
.chart-empty,.empty{color:var(--dim);font-style:italic;}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.stat{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--dim);padding:4px 0;}
.stat-label{color:var(--dim);}
.stat-value{color:var(--fg);font-weight:600;}
.kb-block{margin-bottom:22px;}
.kb-block:last-child{margin-bottom:0;}
.kb{display:flex;flex-direction:column;gap:6px;align-items:center;background:var(--bg);border-radius:8px;padding:14px 10px;}
.kb-row{display:flex;gap:6px;justify-content:center;}
.kb-row-2{padding-left:16px;}
.kb-row-3{padding-left:40px;}
.kb-key{position:relative;width:46px;height:46px;border-radius:6px;border:1px solid var(--dim);background:var(--panel);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
.kb-key.kb-idle{opacity:.35;}
.kb-space{width:280px;}
.kb-cap{font-size:14px;line-height:1;}
.kb-val{font-size:10px;line-height:1;color:var(--fg);opacity:.85;}
.kb-note{color:var(--dim);font-size:11px;margin:8px 0 0;text-align:center;}
.word-tables{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--dim);font-size:12px;}
th{color:var(--dim);font-weight:600;}
.badge{background:var(--accent);color:#141414;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:700;}
.replay-controls{display:flex;gap:8px;align-items:center;margin-bottom:10px;}
button,select{background:var(--bg);color:var(--fg);border:1px solid var(--dim);border-radius:4px;padding:6px 12px;font:inherit;cursor:pointer;}
#replay-out{white-space:pre-wrap;word-break:break-word;background:var(--bg);border-radius:6px;padding:12px;min-height:60px;}
#replay-out .bad{color:var(--err);text-decoration:underline;}
.totals{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.cal-grid{display:flex;flex-direction:column;gap:3px;}
.cal-row{display:flex;gap:3px;}
.cal-cell{width:14px;height:14px;border-radius:3px;background:var(--bg);}
.cal-cell.level-0{background:var(--bg);}
.cal-cell.level-1{background:color-mix(in srgb, var(--accent) 25%, var(--bg));}
.cal-cell.level-2{background:color-mix(in srgb, var(--accent) 50%, var(--bg));}
.cal-cell.level-3{background:color-mix(in srgb, var(--accent) 75%, var(--bg));}
.cal-cell.level-4{background:var(--accent);}
footer{max-width:960px;margin:24px auto 0;color:var(--dim);font-size:12px;text-align:center;}
`;
}

function svgX(i: number, n: number): number {
  return PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W);
}

function svgY(v: number, maxVal: number): number {
  return PAD_T + PLOT_H - (v / maxVal) * PLOT_H;
}

function chartFrame(maxVal: number): string {
  const parts: string[] = [
    `<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${HEIGHT - PAD_B}" class="axis" />`,
    `<line x1="${PAD_L}" y1="${HEIGHT - PAD_B}" x2="${WIDTH - PAD_R}" y2="${HEIGHT - PAD_B}" class="axis" />`,
  ];
  for (let g = 0; g <= 5; g++) {
    const v = (maxVal / 5) * g;
    const gy = svgY(v, maxVal).toFixed(1);
    parts.push(
      `<line x1="${PAD_L}" y1="${gy}" x2="${WIDTH - PAD_R}" y2="${gy}" class="grid" />` +
        `<text x="${PAD_L - 6}" y="${(Number(gy) + 3).toFixed(1)}" class="axis-label" text-anchor="end">${Math.round(v)}</text>`,
    );
  }
  return parts.join("");
}

/** Saniye bazlı wpm/ham/hata serisinden `<svg>` grafik üretir. */
function renderSeriesChart(series: readonly SeriesPoint[]): string {
  if (series.length < 2) {
    return `<p class="chart-empty">At least two seconds of data are needed for the chart.</p>`;
  }
  const n = series.length;
  const maxVal = Math.max(10, ...series.map((p) => Math.max(p.wpm, p.raw))) * 1.1;
  const wpmPts = series.map((p, i) => `${svgX(i, n).toFixed(1)},${svgY(p.wpm, maxVal).toFixed(1)}`).join(" ");
  const rawPts = series.map((p, i) => `${svgX(i, n).toFixed(1)},${svgY(p.raw, maxVal).toFixed(1)}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(n / 10));
  const xLabels = series
    .map((p, i) =>
      i % labelStep === 0
        ? `<text x="${svgX(i, n).toFixed(1)}" y="${HEIGHT - 4}" class="axis-label" text-anchor="middle">${p.t}</text>`
        : "",
    )
    .join("");
  const errMarks = series
    .map((p, i) =>
      p.errors > 0
        ? `<text x="${svgX(i, n).toFixed(1)}" y="${(svgY(p.raw, maxVal) - 8).toFixed(1)}" class="err-mark" text-anchor="middle">\u00d7</text>`
        : "",
    )
    .join("");
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="WPM chart">${chartFrame(maxVal)}<polyline points="${rawPts}" class="line-b" fill="none" /><polyline points="${wpmPts}" class="line-a" fill="none" />${errMarks}${xLabels}</svg>`;
}

function testChips(r: Result, opts: Options): string[] {
  const meta = r.meta;
  const chips: string[] = [];
  switch (meta.mode) {
    case "words":
      chips.push(`${meta.words} words`);
      break;
    case "time":
      chips.push(`${meta.durationSec ?? opts.duration}s`);
      break;
    case "chars":
      chips.push(`${meta.chars} chars`);
      break;
    case "quote":
      chips.push("quote");
      break;
    case "custom":
      chips.push("custom text");
      break;
  }
  chips.push(meta.language === "tr" ? "tr" : "en");
  if (opts.numbers) chips.push("numbers");
  if (opts.punctuation) chips.push("punctuation");
  if (opts.quotes) chips.push("quotes");
  if (opts.symbols) chips.push("symbols");
  if (opts.capitalize) chips.push("capitalization");
  if (opts.blind) chips.push("blind");
  chips.push(`unique ${meta.uniqueWords}/${meta.words}`);
  chips.push(`seed ${meta.seed}`);
  if (meta.quoteAuthor) chips.push(meta.quoteAuthor);
  return chips;
}

function statGrid(r: Result): string {
  const afkPct = r.timeSec > 0 ? (r.afkSec / r.timeSec) * 100 : 0;
  const rows: readonly (readonly [string, string])[] = [
    ["Raw WPM", r.raw.toFixed(1)],
    ["Correct characters", String(r.chars.correct)],
    ["Incorrect characters", String(r.chars.incorrect)],
    ["Extra characters", String(r.chars.extra)],
    ["Missed characters", String(r.chars.missed)],
    ["Consistency", `${r.consistency.toFixed(1)}%`],
    ["Time", `${r.timeSec.toFixed(1)}s`],
    ["AFK", `${r.afkSec.toFixed(1)}s (${afkPct.toFixed(1)}%)`],
    ["Corrections", String(r.corrections)],
    ["Longest streak", String(r.bestStreak)],
    ["Completed", r.complete ? "Yes" : "No"],
    ["Test type", escapeHtml(r.meta.source)],
  ];
  return rows
    .map(([k, v]) => `<div class="stat"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${v}</span></div>`)
    .join("");
}

/**
 * Klavye ısı haritası.
 *
 * Düzen test diline göre seçilir: İngilizce testte US QWERTY, Türkçe testte
 * Türkçe-Q. Büyük harfler `metrics.foldKey` ile zaten temel tuşa katlanmış
 * olarak gelir; düzende yeri olmayan tuşlar (noktalama, sembol, shift'li
 * işaretler) ayrı bir "diğer" sırasına düşer — hangi fiziksel tuşun üstünde
 * oldukları klavye düzenine bağlı olduğu için tahmin edilmez.
 */
const KEY_ROWS_BY_LANG: Readonly<Record<Lang, readonly string[]>> = {
  en: ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"],
  tr: ["1234567890", "qwertyuıopğü", "asdfghjklşi", "zxcvbnmöç"],
};

interface KeyCell {
  key: string;
  stat: KeyStat | undefined;
}

function keyLabel(key: string): string {
  if (key === " ") return "space";
  return escapeHtml(key);
}

/**
 * 0 → hiç renk yok, 1 → tam renk.
 *
 * Sıfır için taban alfa BIRAKILMAZ: hatasız bir testte her tuşun kırmızıya
 * boyanması gerçeğin tam tersini söylerdi. Basılmamış tuş zaten `kb-idle`
 * saydamlığıyla ayrışıyor, bu yüzden renge "basıldı" işareti yüklemeye gerek yok.
 */
function heatStyle(ratio: number | null, rgb: string): string {
  if (ratio === null || ratio <= 0) return "";
  const alpha = (Math.min(1, ratio) * 0.88).toFixed(3);
  return ` style="background:rgba(${rgb},${alpha})"`;
}

function keyboardRows(
  keys: readonly KeyStat[],
  lang: Lang,
  value: (k: KeyStat) => number | null,
  rgb: string,
  format: (k: KeyStat) => string,
): string {
  const byKey = new Map<string, KeyStat>();
  for (const k of keys) byKey.set(k.key, k);

  const placed = new Set<string>();
  const rows: KeyCell[][] = KEY_ROWS_BY_LANG[lang].map((row) =>
    [...row].map((key) => {
      placed.add(key);
      return { key, stat: byKey.get(key) };
    }),
  );

  const extras: KeyCell[] = [];
  for (const k of keys) {
    if (k.key === " " || placed.has(k.key)) continue;
    extras.push({ key: k.key, stat: k });
  }
  extras.sort((a, b) => a.key.localeCompare(b.key));
  if (extras.length > 0) rows.push(extras);
  rows.push([{ key: " ", stat: byKey.get(" ") }]);

  // Ölçek yalnızca gerçekten denenmiş tuşlardan gelir ve gözlenen aralığa
  // gerilir: gecikmeler 96–134 ms gibi dar bir bantta toplandığında 0'dan
  // ölçeklemek her tuşu aynı tonda gösterirdi.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const k of keys) {
    const v = value(k);
    if (v === null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;

  return rows
    .map((row, i) => {
      const cells = row
        .map((cell) => {
          const stat = cell.stat;
          const raw = stat ? value(stat) : null;
          // span === 0: tüm tuşlar eşit. Hepsi sıfırsa (hatasız test) renk YOK;
          // hepsi aynı sıfır-dışı değerdeyse orta ton.
          const ratio =
            raw === null ? null : span > 0 ? (raw - min) / span : max > 0 ? 0.5 : 0;
          const wide = cell.key === " " ? " kb-space" : "";
          const title = stat
            ? `${keyLabel(cell.key)} — ${stat.attempts} hits · ${stat.errors} errors · ${stat.meanMs} ms`
            : `${keyLabel(cell.key)} — no data`;
          const badge = stat ? `<span class="kb-val">${format(stat)}</span>` : "";
          return `<div class="kb-key${wide}${stat ? "" : " kb-idle"}"${heatStyle(ratio, rgb)} title="${title}"><span class="kb-cap">${keyLabel(cell.key)}</span>${badge}</div>`;
        })
        .join("");
      return `<div class="kb-row kb-row-${i}">${cells}</div>`;
    })
    .join("");
}

function keyHeatmap(keys: readonly KeyStat[], lang: Lang): string {
  const eligible = keys.filter((k) => k.attempts >= 3);
  if (eligible.length === 0) return `<p class="empty">Not enough data.</p>`;

  const errBoard = keyboardRows(
    eligible,
    lang,
    (k) => (k.errors > 0 ? k.errors / k.attempts : 0),
    "202,71,84",
    (k) => `${Math.round((k.errors / k.attempts) * 100)}%`,
  );
  const msBoard = keyboardRows(
    eligible,
    lang,
    (k) => (k.meanMs > 0 ? k.meanMs : null),
    "226,183,20",
    (k) => `${k.meanMs}`,
  );

  return `<div class="kb-block"><h3>Error rate</h3><div class="kb">${errBoard}</div><p class="kb-note">Dark red = most error-prone key. Uncoloured keys were pressed fewer than 3 times. Capital letters fold onto their own key; punctuation and symbol keys sit in the bottom row.</p></div><div class="kb-block"><h3>Mean latency (ms)</h3><div class="kb">${msBoard}</div><p class="kb-note">Dark yellow = slowest key. Hover a key for hits, errors and latency.</p></div>`;
}

function wordRows(list: readonly WordStat[]): string {
  return list.length > 0
    ? list.map((w) => `<tr><td>${escapeHtml(w.word)}</td><td>${w.wpm.toFixed(1)}</td><td>${w.errors}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty">Not enough data.</td></tr>`;
}

function wordTables(words: readonly WordStat[]): string {
  const withDuration = words.filter((w) => w.ms > 0);
  const slowest = [...withDuration].sort((a, b) => a.wpm - b.wpm).slice(0, 10);
  const fastest = [...withDuration].sort((a, b) => b.wpm - a.wpm).slice(0, 5);
  return `<div class="word-tables"><div><h3>Slowest words</h3><table><thead><tr><th>Word</th><th>WPM</th><th>Errors</th></tr></thead><tbody>${wordRows(slowest)}</tbody></table></div><div><h3>Fastest words</h3><table><thead><tr><th>Word</th><th>WPM</th><th>Errors</th></tr></thead><tbody>${wordRows(fastest)}</tbody></table></div></div>`;
}

function personalBlock(r: Result, p: Personal): string {
  if (!p.best) {
    return `<h3>Personal record</h3><p>First test — no record yet.</p>`;
  }
  const isNewRecord = p.count > 0 && r.wpm >= p.best.wpm;
  const badge = isNewRecord ? ` <span class="badge">NEW RECORD</span>` : "";
  const prevText = p.prevBest
    ? `${p.prevBest.wpm.toFixed(1)} wpm (${escapeHtml(new Date(p.prevBest.at).toLocaleDateString("en-US"))})`
    : "—";
  return `<h3>Personal record${badge}</h3><div class="stat-grid"><div class="stat"><span class="stat-label">Best</span><span class="stat-value">${p.best.wpm.toFixed(1)} wpm</span></div><div class="stat"><span class="stat-label">Previous best</span><span class="stat-value">${prevText}</span></div><div class="stat"><span class="stat-label">Last 10 average</span><span class="stat-value">${p.avg10.toFixed(1)} wpm</span></div><div class="stat"><span class="stat-label">Tests in this bucket</span><span class="stat-value">${p.count}</span></div></div>`;
}

/** `<`/`>`/`&`/U+2028/U+2029` kaçışı: `<script>` içine gömülen JSON'un güvenli olması için. */
function jsonScriptEscape(json: string): string {
  return json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const REPLAY_SCRIPT = `(function () {
  var dataEl = document.getElementById("replay-data");
  if (!dataEl) return;
  var events = JSON.parse(dataEl.textContent || "[]");
  var out = document.getElementById("replay-out");
  var playBtn = document.getElementById("replay-play");
  var pauseBtn = document.getElementById("replay-pause");
  var restartBtn = document.getElementById("replay-restart");
  var speedSel = document.getElementById("replay-speed");
  var timer = null;
  var idx = 0;
  var playing = false;

  function escapeCh(ch) {
    return String(ch).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render() {
    var html = "";
    for (var i = 0; i < idx; i++) {
      var ev = events[i];
      var esc = escapeCh(ev[1]);
      html += ev[2] ? esc : '<span class="bad">' + esc + "</span>";
    }
    out.innerHTML = html;
  }

  function stop() {
    playing = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function step() {
    if (!playing) return;
    if (idx >= events.length) {
      playing = false;
      return;
    }
    idx++;
    render();
    if (idx >= events.length) {
      playing = false;
      return;
    }
    var speed = parseFloat(speedSel.value) || 1;
    var dt = Math.max(0, (events[idx][0] - events[idx - 1][0]) / speed);
    timer = setTimeout(step, Math.min(dt, 2000));
  }

  playBtn.addEventListener("click", function () {
    if (playing) return;
    playing = true;
    step();
  });
  pauseBtn.addEventListener("click", stop);
  restartBtn.addEventListener("click", function () {
    stop();
    idx = 0;
    render();
  });
})();`;

function replaySection(events: readonly Keystroke[], opts: Options): string {
  if (!opts.replay || events.length === 0 || events.length > 20000) return "";
  const data = jsonScriptEscape(JSON.stringify(events.map((e) => [e.t, e.ch, e.ok ? 1 : 0])));
  return `<section class="replay"><h2>Keystroke replay</h2><script id="replay-data" type="application/json">${data}</script><div class="replay-controls"><button id="replay-play" type="button">Play</button><button id="replay-pause" type="button">Pause</button><button id="replay-restart" type="button">Restart</button><select id="replay-speed"><option value="1">1x</option><option value="2">2x</option><option value="4">4x</option></select></div><pre id="replay-out"></pre><script>${REPLAY_SCRIPT}</script></section>`;
}

/** Bitiş sonucu için tek dosyalık HTML rapor. */
export function renderResult(r: Result, p: Personal, opts: Options, events: readonly Keystroke[]): string {
  const theme = THEMES[opts.reportTheme];
  const chips = testChips(r, opts)
    .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
    .join("");
  const generatedAt = new Date(r.at).toLocaleString("en-US");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Typing test result — ${r.wpm.toFixed(1)} wpm</title>
<style>${styleSheet(theme)}</style>
</head>
<body>
<header class="hero">
  <div class="hero-numbers">
    <div class="hero-num"><span class="big">${r.wpm.toFixed(1)}</span><span class="unit">wpm</span></div>
    <div class="hero-num"><span class="big">${r.accuracy.toFixed(1)}%</span><span class="unit">accuracy</span></div>
  </div>
  <div class="chips">${chips}</div>
</header>
<main>
  <section class="chart-section">
    <h2>WPM chart</h2>
    ${renderSeriesChart(r.series)}
  </section>
  <section class="stats-section">
    <h2>Statistics</h2>
    <div class="stat-grid">${statGrid(r)}</div>
  </section>
  <section class="heat-section">
    <h2>Key heatmap</h2>
    ${keyHeatmap(r.keys, r.meta.language)}
  </section>
  <section class="word-section">
    <h2>Word speed</h2>
    ${wordTables(r.words)}
  </section>
  <section class="personal-section">
    ${personalBlock(r, p)}
  </section>
  ${replaySection(events, opts)}
</main>
<footer>
  <p>Generated: ${escapeHtml(generatedAt)} · seed ${r.meta.seed}</p>
</footer>
</body>
</html>`;
}

function dashboardChart(rows: readonly HistoryRow[]): string {
  if (rows.length < 2) {
    return `<p class="chart-empty">At least two tests are needed for the chart.</p>`;
  }
  const n = rows.length;
  const maxWpm = Math.max(10, ...rows.map((r) => r.wpm)) * 1.1;
  const wpmPts = rows.map((r, i) => `${svgX(i, n).toFixed(1)},${svgY(r.wpm, maxWpm).toFixed(1)}`).join(" ");
  const accPts = rows.map((r, i) => `${svgX(i, n).toFixed(1)},${svgY(r.accuracy, 100).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Dashboard chart">${chartFrame(maxWpm)}<polyline points="${accPts}" class="line-b" fill="none" /><polyline points="${wpmPts}" class="line-a" fill="none" /></svg>`;
}

interface BucketAgg {
  bucket: string;
  best: number;
  avg: number;
  count: number;
}

function bucketAggregates(rows: readonly HistoryRow[]): BucketAgg[] {
  const map = new Map<string, { sum: number; best: number; count: number }>();
  for (const row of rows) {
    const agg = map.get(row.bucket) ?? { sum: 0, best: 0, count: 0 };
    agg.sum += row.wpm;
    agg.best = Math.max(agg.best, row.wpm);
    agg.count += 1;
    map.set(row.bucket, agg);
  }
  return [...map.entries()]
    .map(([bucket, agg]) => ({ bucket, best: agg.best, avg: agg.sum / agg.count, count: agg.count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 12 hafta x 7 gün ısı takvimi (son gün en sağda). */
function heatCalendar(rows: readonly HistoryRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(row.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = 12 * 7;
  const days: { count: number; label: string }[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    days.push({ count: counts.get(key) ?? 0, label: d.toLocaleDateString("en-US") });
  }
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const levelOf = (count: number): number => {
    if (count === 0) return 0;
    const ratio = count / maxCount;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };
  const rowsGrid: string[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const cells: string[] = [];
    for (let week = 0; week < 12; week++) {
      const day = days[week * 7 + dow];
      cells.push(`<div class="cal-cell level-${levelOf(day.count)}" title="${escapeHtml(day.label)}: ${day.count} test"></div>`);
    }
    rowsGrid.push(`<div class="cal-row">${cells.join("")}</div>`);
  }
  return `<div class="cal-grid">${rowsGrid.join("")}</div>`;
}

function totalsSummary(rows: readonly HistoryRow[]): string {
  const totalTests = rows.length;
  const totalTimeSec = rows.reduce((sum, r) => sum + r.timeSec, 0);
  const totalCorrectChars = rows.reduce((sum, r) => sum + r.chars.correct, 0);
  const bestWpm = rows.reduce((max, r) => Math.max(max, r.wpm), 0);
  const hours = Math.floor(totalTimeSec / 3600);
  const minutes = Math.floor((totalTimeSec % 3600) / 60);
  const entries: readonly (readonly [string, string])[] = [
    ["Total tests", String(totalTests)],
    ["Total time", `${hours}h ${minutes}m`],
    ["Total correct characters", String(totalCorrectChars)],
    ["Best wpm", bestWpm.toFixed(1)],
  ];
  return entries
    .map(([k, v]) => `<div class="stat"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${v}</span></div>`)
    .join("");
}

/** Tüm zamanlar istatistik panosu — tek dosyalık HTML. */
export function renderDashboard(rows: readonly HistoryRow[], opts: Options): string {
  const theme = THEMES[opts.reportTheme];
  const generatedAt = new Date().toLocaleString("en-US");

  if (rows.length === 0) {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Stats dashboard</title><style>${styleSheet(theme)}</style></head>
<body>
<header class="hero"><h1>Stats dashboard</h1></header>
<main><section><p class="empty">No tests recorded yet.</p></section></main>
<footer><p>Generated: ${escapeHtml(generatedAt)}</p></footer>
</body>
</html>`;
  }

  const newest = [...rows].sort((a, b) => a.at - b.at).slice(-100);
  const buckets = bucketAggregates(rows);
  const bucketRows = buckets
    .map(
      (b) =>
        `<tr><td>${escapeHtml(b.bucket)}</td><td>${b.best.toFixed(1)}</td><td>${b.avg.toFixed(1)}</td><td>${b.count}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Stats dashboard</title>
<style>${styleSheet(theme)}</style>
</head>
<body>
<header class="hero"><h1>Stats dashboard</h1></header>
<main>
  <section class="chart-section">
    <h2>Last ${newest.length} test${newest.length === 1 ? "" : "s"} — wpm / accuracy</h2>
    ${dashboardChart(newest)}
  </section>
  <section class="stats-section">
    <h2>Overall totals</h2>
    <div class="totals">${totalsSummary(rows)}</div>
  </section>
  <section class="bucket-section">
    <h2>Records by bucket</h2>
    <table><thead><tr><th>Bucket</th><th>Best wpm</th><th>Average wpm</th><th>Tests</th></tr></thead><tbody>${bucketRows}</tbody></table>
  </section>
  <section class="calendar-section">
    <h2>Last 12 weeks</h2>
    ${heatCalendar(rows)}
  </section>
</main>
<footer><p>Generated: ${escapeHtml(generatedAt)}</p></footer>
</body>
</html>`;
}

/** Raporu `reportsDir()/name` dosyasına yazar; başarılıysa mutlak yolu döner. */
export function writeReport(html: string, name: string): string | null {
  const file = path.join(reportsDir(), name);
  return writeFileSafe(file, html) ? file : null;
}
