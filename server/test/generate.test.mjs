import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generate, fromText } = require("../dist/generate.js");
const { DEFAULTS } = require("../dist/options.js");

const SEED = 20240613;
const opts = (over) => ({ ...DEFAULTS, ...over });

test("words modu: sabit seed, benzersiz tekrar politikası", () => {
  const spec = generate(opts({ wordCount: 25, repeat: "unique" }), SEED);
  assert.equal(spec.words.length, 25);
  assert.equal(spec.meta.words, 25);
  assert.equal(spec.meta.uniqueWords, 25);
  assert.equal(spec.meta.repeats, 0);
  assert.equal(new Set(spec.words).size, 25);
  assert.equal(spec.meta.seed, SEED);
});

test("aynı seed birebir aynı metni üretir", () => {
  const a = generate(opts({ wordCount: 40, numbers: true, punctuation: true }), SEED);
  const b = generate(opts({ wordCount: 40, numbers: true, punctuation: true }), SEED);
  assert.deepEqual(a.lines, b.lines);
  assert.notDeepEqual(
    a.lines,
    generate(opts({ wordCount: 40, numbers: true, punctuation: true }), SEED + 1).lines,
  );
});

test("satırlar lineWidth'i aşmaz", () => {
  for (const width of [24, 40, 52, 80]) {
    const spec = generate(opts({ wordCount: 120, lineWidth: width, symbols: true }), SEED);
    for (const line of spec.lines) {
      const longestToken = Math.max(...line.split(" ").map((t) => t.length));
      assert.ok(
        line.length <= width || longestToken === line.length,
        `satır ${line.length} > ${width}: ${line}`,
      );
    }
  }
});

test("numbers: en az bir sayı, yan yana iki sayı yok", () => {
  const spec = generate(opts({ wordCount: 60, numbers: true }), SEED);
  const isNum = spec.words.map((w) => /^\d+$/.test(w));
  assert.ok(isNum.some(Boolean), "hiç sayı üretilmedi");
  assert.ok(spec.meta.numericTokens >= 1);
  for (let i = 1; i < isNum.length; i++) {
    assert.ok(!(isNum[i] && isNum[i - 1]), `yan yana sayı: ${i}`);
  }
});

test("quotes: tırnak sayısı çift", () => {
  for (const seed of [SEED, SEED + 7, SEED + 99]) {
    const spec = generate(opts({ wordCount: 80, quotes: true }), seed);
    const count = spec.lines.join(" ").split('"').length - 1;
    assert.equal(count % 2, 0, `tek sayıda tırnak: ${count}`);
    assert.ok(spec.meta.quotedRuns >= 0);
  }
});

test("punctuation: cümle başı büyük harf, Türkçe i → İ", () => {
  const spec = generate(opts({ wordCount: 300, punctuation: true, language: "tr" }), SEED);
  const text = spec.lines.join(" ");
  assert.ok(spec.meta.punctuationMarks > 0);
  // Türkçe locale kullanılmazsa "i" → "I" olurdu; havuzda büyük I yoktur.
  assert.ok(!text.includes("I"), "noktasız büyük I üretildi (locale hatası)");
  assert.ok(text.includes("İ"), "büyük İ hiç üretilmedi");
  assert.match(spec.words[0], /^[A-ZÇĞİÖŞÜ]/);
  const last = spec.words[spec.words.length - 1];
  assert.match(last, /[.?!]$/);
});

test("chars modu: toplam uzunluk sınırı aşmaz", () => {
  for (const seed of [SEED, SEED + 3, SEED + 11]) {
    const spec = generate(opts({ mode: "chars", charCount: 200 }), seed);
    assert.ok(spec.meta.chars <= 200, `chars ${spec.meta.chars}`);
    assert.ok(spec.meta.chars > 180, `chars ${spec.meta.chars}`);
  }
});

test("time modu meta.durationSec taşır", () => {
  const spec = generate(opts({ mode: "time", duration: 30 }), SEED);
  assert.equal(spec.meta.durationSec, 30);
  assert.ok(spec.meta.words >= 55);
});

test("quote modu: yazar bilgisi ve kova uzunluğu", () => {
  const spec = generate(opts({ mode: "quote", quoteLength: "short" }), SEED);
  assert.equal(spec.meta.source, "quote");
  assert.ok(typeof spec.meta.quoteAuthor === "string" && spec.meta.quoteAuthor.length > 0);
  assert.ok(spec.lines.join(" ").length <= 120);
});

test("fromText: tab/girinti temizlenir, satırlar yeniden sarılır", () => {
  const spec = fromText("\tconst a = 1;\n\n    const b = 2;\n", opts({ lineWidth: 24 }));
  assert.equal(spec.meta.source, "custom");
  assert.deepEqual(spec.words, ["const", "a", "=", "1;", "const", "b", "=", "2;"]);
  for (const line of spec.lines) assert.ok(line.length <= 24);
});

test("repeat: window politikası pencere içinde tekrar üretmez", () => {
  const spec = generate(opts({ wordCount: 200, repeat: "window", repeatWindow: 5 }), SEED);
  for (let i = 1; i < spec.words.length; i++) {
    for (let k = Math.max(0, i - 5); k < i; k++) {
      assert.notEqual(spec.words[k], spec.words[i], `pencere içinde tekrar: ${i}`);
    }
  }
});
