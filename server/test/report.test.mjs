import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderResult, renderDashboard } = require("../dist/report.js");
const { DEFAULTS } = require("../dist/options.js");

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const INJECT = '<script>alert(1)</script>';

function fakeResult(over = {}) {
  return {
    wpm: 62.4,
    raw: 68.1,
    accuracy: 96.2,
    consistency: 88.4,
    timeSec: 24.5,
    afkSec: 1.2,
    chars: { correct: 128, incorrect: 5, extra: 2, missed: 0 },
    corrections: 3,
    bestStreak: 41,
    complete: true,
    series: [
      { t: 1, wpm: 40, raw: 44, errors: 0 },
      { t: 2, wpm: 58, raw: 61, errors: 1 },
      { t: 3, wpm: 64, raw: 66, errors: 0 },
      { t: 4, wpm: 70, raw: 72, errors: 2 },
    ],
    words: [
      { word: INJECT, wpm: 22.1, errors: 2, ms: 900 },
      { word: "kelime", wpm: 71.5, errors: 0, ms: 300 },
      { word: "test", wpm: 55.0, errors: 1, ms: 420 },
    ],
    keys: [
      { key: "a", attempts: 12, errors: 3, meanMs: 180 },
      { key: " ", attempts: 20, errors: 1, meanMs: 140 },
      { key: "<", attempts: 5, errors: 2, meanMs: 260 },
      { key: "ç", attempts: 6, errors: 0, meanMs: 210 },
      { key: "z", attempts: 2, errors: 2, meanMs: 400 },
    ],
    meta: {
      mode: "words",
      language: "tr",
      source: "quote",
      words: 25,
      uniqueWords: 25,
      repeats: 0,
      chars: 135,
      numericTokens: 0,
      quotedRuns: 0,
      punctuationMarks: 0,
      symbolTokens: 0,
      longestWord: 9,
      avgWordLength: 5.4,
      seed: 12345,
      quoteAuthor: INJECT,
    },
    at: 1_700_000_000_000,
    ...over,
  };
}

const personal = {
  best: null,
  prevBest: null,
  avg10: 0,
  count: 0,
};

const events = [
  { t: 0, ch: "a", expected: "a", ok: true, line: 0, col: 0 },
  { t: 120, ch: "<", expected: "b", ok: false, line: 0, col: 1 },
  { t: 260, ch: "c", expected: "c", ok: true, line: 0, col: 2 },
];

test("renderResult: tek dosyalık, SVG'li, </html> ile biten belge", () => {
  const html = renderResult(fakeResult(), personal, DEFAULTS, events);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes("<svg"), "svg grafik yok");
  assert.ok(html.trimEnd().endsWith("</html>"));
  assert.ok(!html.includes("http://"), "harici kaynak");
  assert.ok(!html.includes("https://"), "harici kaynak");
  assert.match(html, /62(\.4)?/);
});

test("renderResult: kullanıcı metni kaçırılır", () => {
  const html = renderResult(fakeResult(), personal, DEFAULTS, events);
  assert.ok(html.includes("&lt;script&gt;"), "enjekte metin kaçırılmamış");
  assert.ok(!html.includes("<script>alert"), "ham script enjeksiyonu");
});

test("renderResult: tuş ısı haritası klavye düzeninde çizilir", () => {
  const html = renderResult(fakeResult(), personal, DEFAULTS, events);

  // İki klavye: hata oranı ve ortalama gecikme.
  assert.equal(html.split('<div class="kb">').length - 1, 2, "iki klavye bekleniyordu");
  assert.ok(html.includes("Error rate"));
  assert.ok(html.includes("Mean latency"));

  // Temel QWERTY sıraları her zaman çizilir (basılmamış tuşlar dahil).
  for (const cap of ["q", "w", "e", "r", "t", "y", "1", "0", "m"]) {
    assert.ok(
      html.includes(`<span class="kb-cap">${cap}</span>`),
      `klavyede ${cap} yok`,
    );
  }
  // Boşluk geniş tuş olarak ve "space" etiketiyle.
  assert.ok(html.includes("kb-key kb-space"), "boşluk tuşu yok");
  assert.ok(html.includes('<span class="kb-cap">space</span>'));
  // Türkçe testte Türkçe-Q düzeni: ç/ğ/ı/ö/ş/ü temel tuş olarak yer alır.
  for (const cap of ["ç", "ğ", "ı", "ö", "ş", "ü"]) {
    assert.ok(html.includes(`<span class="kb-cap">${cap}</span>`), `tr düzeninde ${cap} yok`);
  }
  // Düzende yeri olmayan (shift'li) işaretler ek sıraya düşer, kaçırılmış olarak.
  assert.ok(html.includes("&lt;"), "< tuşu kaçırılmamış");
  assert.ok(!html.includes('<span class="kb-cap"><</span>'), "ham < enjeksiyonu");

  // Basılan tuşlar renklenir, basılmayanlar nötr kalır.
  assert.ok(/class="kb-key" style="background:rgba\(202,71,84,/.test(html), "hata rengi yok");
  assert.ok(/class="kb-key" style="background:rgba\(226,183,20,/.test(html), "gecikme rengi yok");
  assert.ok(html.includes("kb-idle"), "verisiz tuş nötr işaretlenmemiş");

  // 3'ten az denenen tuş (z: 2 vuruş) ısı haritasına girmez.
  assert.ok(!html.includes("z — 2 hits"), "eşik altındaki tuş renklendi");
  // Ayrıntı ipucu vuruş/hata/gecikme taşır.
  assert.ok(html.includes('title="a — 12 hits · 3 errors · 180 ms"'), "tuş ipucu yok");
});

test("renderResult: yetersiz tuş verisinde klavye yerine not", () => {
  const html = renderResult(
    fakeResult({ keys: [{ key: "a", attempts: 1, errors: 0, meanMs: 100 }] }),
    personal,
    DEFAULTS,
    events,
  );
  assert.ok(!html.includes('<div class="kb">'), "eşik altında klavye çizildi");
  assert.ok(html.includes("Not enough data."));
});

test("renderResult: klavye düzeni test diline göre seçilir", () => {
  const tr = renderResult(fakeResult(), personal, DEFAULTS, events);
  const en = renderResult(
    fakeResult({ meta: { ...fakeResult().meta, language: "en" } }),
    personal,
    DEFAULTS,
    events,
  );

  // tr-Q: ı ilk sırada, i harf sırasında; ğ/ü/ş/ö/ç temel tuş.
  assert.ok(tr.includes('<span class="kb-cap">ğ</span>'));
  assert.ok(tr.includes('<span class="kb-cap">ı</span>'));
  // US QWERTY: Türkçe harfler düzende yok (veride de yoksa hiç çizilmez).
  assert.ok(!en.includes('<span class="kb-cap">ğ</span>'), "en düzeninde ğ çizildi");
  assert.ok(!en.includes('<span class="kb-cap">ı</span>'), "en düzeninde ı çizildi");
  // Her iki düzende de ortak ASCII tuşları var.
  for (const cap of ["q", "a", "z", "m", "0"]) {
    assert.ok(tr.includes(`<span class="kb-cap">${cap}</span>`));
    assert.ok(en.includes(`<span class="kb-cap">${cap}</span>`));
  }
  // Büyük harf ısı haritasına girmemeli: metrics tarafında katlanıyor.
  assert.ok(!/<span class="kb-cap">[A-ZÇĞİÖŞÜ]<\/span>/.test(tr), "katlanmamış büyük harf");
  assert.ok(!/<span class="kb-cap">[A-ZÇĞİÖŞÜ]<\/span>/.test(en), "katlanmamış büyük harf");
});

test("renderResult: replay kapalıyken oynatıcı yok", () => {
  // Yalnızca CSS kuralları kalabilir; işaretleme (id="…") ve veri bloğu çıkmamalı.
  const off = renderResult(fakeResult(), { ...personal }, { ...DEFAULTS, replay: false }, events);
  assert.ok(!off.includes('id="replay-data"'), "replay verisi sızdı");
  assert.ok(!off.includes('id="replay-out"'), "oynatıcı işaretlemesi sızdı");
  assert.ok(!off.includes('id="replay-play"'), "oynat düğmesi sızdı");
  assert.ok(!off.includes("Keystroke replay"), "replay başlığı sızdı");

  const on = renderResult(fakeResult(), { ...personal }, { ...DEFAULTS, replay: true }, events);
  assert.ok(on.includes('id="replay-data"'));
  assert.ok(on.includes('id="replay-out"'));
  assert.ok(on.includes('id="replay-play"'));
  // Gömülü JSON'daki `<` kaçırılmalı: veri bloğu erken kapanmamalı.
  const json = /<script id="replay-data" type="application\/json">([\s\S]*?)<\/script>/.exec(on);
  assert.ok(json, "replay veri bloğu bulunamadı");
  assert.ok(!json[1].includes("<"), "gömülü JSON'da ham < karakteri");
  assert.ok(json[1].includes("\\u003c"), "ham < kaçırılmamış");
  assert.deepEqual(JSON.parse(json[1].replace(/\\u003c/g, "<")), [
    [0, "a", 1],
    [120, "<", 0],
    [260, "c", 1],
  ]);
});

test("renderResult: rekor rozeti yalnızca geçmiş varken", () => {
  const first = renderResult(fakeResult(), personal, DEFAULTS, events);
  assert.ok(first.includes("First test — no record yet."), "ilk test metni yok");
  assert.ok(!first.includes("NEW RECORD"));

  const best = {
    v: 1,
    at: 1,
    bucket: "words:25:tr:plain",
    wpm: 50,
    raw: 55,
    accuracy: 95,
    consistency: 80,
    timeSec: 30,
    chars: { correct: 100, incorrect: 2, extra: 0, missed: 0 },
    corrections: 1,
    bestStreak: 20,
    afkSec: 0,
    complete: true,
    mode: "words",
    language: "tr",
    size: "25",
    flags: "plain",
    seed: 1,
  };
  const withRecord = renderResult(
    fakeResult(),
    { best, prevBest: null, avg10: 48.5, count: 4 },
    DEFAULTS,
    events,
  );
  assert.ok(withRecord.includes("NEW RECORD"), "rekor rozeti yok");
});

test("renderResult: tek noktalı seride grafik yerine not", () => {
  const html = renderResult(
    fakeResult({ series: [{ t: 1, wpm: 40, raw: 44, errors: 0 }] }),
    personal,
    DEFAULTS,
    events,
  );
  assert.match(html, /At least two seconds of data are needed for the chart\./);
});

test("renderDashboard: boş geçmiş ve dolu geçmiş", () => {
  const empty = renderDashboard([], DEFAULTS);
  assert.match(empty, /No tests recorded yet\./);
  assert.ok(empty.trimEnd().endsWith("</html>"));

  const rows = Array.from({ length: 12 }, (_, i) => ({
    v: 1,
    at: Date.now() - i * 86_400_000,
    bucket: i % 2 ? "words:25:tr:plain" : "time:30:en:numbers",
    wpm: 40 + i,
    raw: 45 + i,
    accuracy: 90 + (i % 5),
    consistency: 70 + i,
    timeSec: 30,
    chars: { correct: 150, incorrect: 3, extra: 0, missed: 0 },
    corrections: 1,
    bestStreak: 15,
    afkSec: 0,
    complete: true,
    mode: i % 2 ? "words" : "time",
    language: i % 2 ? "tr" : "en",
    size: i % 2 ? "25" : "30",
    flags: i % 2 ? "plain" : "numbers",
    seed: i,
  }));
  const html = renderDashboard(rows, DEFAULTS);
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes("words:25:tr:plain"));
  assert.ok(html.trimEnd().endsWith("</html>"));
});

test("renderResult: hatasız testte hata klavyesi hiç kırmızıya boyanmaz", () => {
  // span === 0 durumu: tüm uygun tuşlarda hata oranı 0. Orta ton verilirse
  // kusursuz bir test tamamen kırmızı görünürdü — gerçeğin tam tersi.
  const flawless = renderResult(
    fakeResult({
      chars: { correct: 140, incorrect: 0, extra: 0, missed: 0 },
      accuracy: 100,
      keys: [
        { key: "a", attempts: 12, errors: 0, meanMs: 150 },
        { key: "s", attempts: 9, errors: 0, meanMs: 150 },
        { key: " ", attempts: 20, errors: 0, meanMs: 150 },
      ],
    }),
    personal,
    DEFAULTS,
    events,
  );
  assert.ok(!flawless.includes("rgba(202,71,84"), "hatasız testte kırmızı boyama");
  // Gecikmeler eşit (span 0) ama sıfır değil: hepsi aynı orta tonda boyanır.
  // Sıfır ile "hepsi eşit" farklı şeyler; yalnızca sıfır renksiz kalır.
  const yellows = [...flawless.matchAll(/rgba\(226,183,20,([\d.]+)\)/g)].map((m) => m[1]);
  assert.ok(yellows.length >= 3, "eşit gecikmeler boyanmadı");
  assert.equal(new Set(yellows).size, 1, `eşit gecikmede farklı tonlar: ${yellows.join(",")}`);
  // Klavye yine çizilir, hata tuşları yalnızca renksiz kalır.
  assert.equal(flawless.split('<div class="kb">').length - 1, 2);
  assert.ok(flawless.includes('title="a — 12 hits · 0 errors · 150 ms"'));

  // Tek bir hata girince renk geri gelir (ölçek gerçekten çalışıyor).
  const oneError = renderResult(
    fakeResult({
      keys: [
        { key: "a", attempts: 12, errors: 3, meanMs: 150 },
        { key: "s", attempts: 9, errors: 0, meanMs: 150 },
      ],
    }),
    personal,
    DEFAULTS,
    events,
  );
  assert.ok(oneError.includes("rgba(202,71,84"), "hata rengi kayboldu");
});

test("rapor çıktısı tamamen İngilizce", () => {
  // Kullanıcı verisi (kelime, yazar, kova adı) dışında Türkçe metin kalmamalı.
  const html = renderResult(
    fakeResult({
      words: [{ word: "test", wpm: 60, errors: 0, ms: 300 }],
      keys: [{ key: "a", attempts: 5, errors: 1, meanMs: 150 }],
      meta: { ...fakeResult().meta, language: "en", quoteAuthor: undefined },
    }),
    personal,
    DEFAULTS,
    events,
  );
  assert.ok(html.includes('<html lang="en">'), "lang niteliği güncellenmemiş");
  assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(html), html.match(/.{0,60}[çğıöşüÇĞİÖŞÜ].{0,60}/)?.[0]);

  const dash = renderDashboard([], DEFAULTS);
  assert.ok(dash.includes('<html lang="en">'));
  assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(dash), dash.match(/.{0,60}[çğıöşüÇĞİÖŞÜ].{0,60}/)?.[0]);
});

test("rapor çıktısı makinenin yerel ayarına bağlı değil", () => {
  // Rapor dosyası paylaşılabilir bir çıktı: tarih biçimi yazarın işletim sistemi
  // yerel ayarına göre değişmemeli. Node'un varsayılan locale'i Windows'ta env
  // ile zorlanamadığı için davranışsal kanca yok; bu yüzden değişmez kaynakta
  // kilitlenir. `toLocale*` çağrılarının hepsi açık bir "en-…" etiketi almalı.
  const report = fs.readFileSync(path.join(srcDir, "report.ts"), "utf8");

  const calls = [...report.matchAll(/toLocale(?:String|DateString|TimeString)\(([^)]*)\)/g)];
  assert.ok(calls.length >= 4, `beklenenden az toLocale çağrısı: ${calls.length}`);
  for (const [whole, args] of calls) {
    assert.match(args, /^"en-(US|GB)"$/, `açık İngilizce locale yok: ${whole}`);
  }
  assert.ok(!report.includes('lang="tr"'), "raporda lang=\"tr\" kaldı");
  assert.equal((report.match(/lang="en"/g) ?? []).length, 3, "üç HTML kökü de en olmalı");

  // generate.ts'teki locale UI değil: test dilinin büyük harf kuralı (i → İ).
  // Bir temizlik taraması bunu yanlışlıkla "düzeltmesin".
  const generate = fs.readFileSync(path.join(srcDir, "generate.ts"), "utf8");
  assert.ok(
    generate.includes('lang === "tr" ? "tr-TR" : "en-US"'),
    "üretecin dile duyarlı büyük harf locale'i kaybolmuş",
  );
});

test("rapor altbilgisi en-US biçiminde tarih yazar", () => {
  const at = Date.UTC(2023, 10, 15, 12, 34, 56);
  const html = renderResult(fakeResult({ at }), personal, DEFAULTS, events);
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html);
  assert.ok(footer, "altbilgi yok");
  // en-US: M/D/YYYY, h:mm:ss AM|PM — tr-TR olsaydı "15.11.2023 14:34:56" olurdu.
  assert.match(
    footer[1],
    /Generated: \d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s?(AM|PM) · seed \d+/,
    footer[1].trim(),
  );
});
