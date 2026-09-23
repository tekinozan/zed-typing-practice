import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Session } = require("../dist/session.js");
const { finalize, charBreakdown, liveSnapshot, foldKey } = require("../dist/metrics.js");
const { generate } = require("../dist/generate.js");
const { DEFAULTS } = require("../dist/options.js");

function specOf(lines) {
  const words = lines.join(" ").split(" ").filter(Boolean);
  return {
    lines,
    words,
    meta: {
      mode: "words",
      language: "tr",
      source: "generated",
      words: words.length,
      uniqueWords: new Set(words).size,
      repeats: 0,
      chars: lines.join("\n").length,
      numericTokens: 0,
      quotedRuns: 0,
      punctuationMarks: 0,
      symbolTokens: 0,
      longestWord: Math.max(...words.map((w) => w.length), 0),
      avgWordLength: 0,
      seed: 1,
    },
  };
}

test("60 saniyede 300 doğru karakter → 60 wpm", () => {
  const line = "ab cd ".repeat(50).trim().padEnd(300, "x");
  const s = new Session("mem://a");
  s.start(specOf([line]));
  s.startedAt = 1_000_000;
  s.finishedAt = s.startedAt + 60_000;
  s.phase = "finished";
  s.correctKeys = 300;
  s.wrongKeys = 0;
  const r = finalize(s, line, s.finishedAt);
  assert.equal(r.chars.correct, 300);
  assert.equal(r.wpm, 60);
  assert.equal(r.raw, 60);
  assert.equal(r.timeSec, 60);
});

test("5 doğru 5 yanlış → %50 doğruluk", () => {
  const s = new Session("mem://b");
  s.start(specOf(["abcde"]));
  s.startedAt = 0;
  s.finishedAt = 60_000;
  s.phase = "finished";
  s.correctKeys = 5;
  s.wrongKeys = 5;
  const r = finalize(s, "abcde", 60_000);
  assert.equal(r.accuracy, 50);
});

test("sabit hızlı örnekler → %100 tutarlılık", () => {
  const s = new Session("mem://c");
  s.start(specOf(["abcde"]));
  s.startedAt = 0;
  s.finishedAt = 5_000;
  s.phase = "finished";
  s.correctKeys = 25;
  s.samples = Array.from({ length: 5 }, () => ({ correct: 5, typed: 5, errors: 0 }));
  const r = finalize(s, "abcde", 5_000);
  assert.equal(r.consistency, 100);

  s.samples = [
    { correct: 1, typed: 1, errors: 0 },
    { correct: 9, typed: 9, errors: 0 },
    { correct: 1, typed: 1, errors: 0 },
    { correct: 9, typed: 9, errors: 0 },
  ];
  const uneven = finalize(s, "abcde", 5_000);
  assert.ok(uneven.consistency < 80, `tutarlılık ${uneven.consistency}`);
});

test("karakter kırılımı: doğru / yanlış / fazla / eksik", () => {
  const spec = specOf(["abc def"]);
  assert.deepEqual(charBreakdown(spec, "abd de"), {
    correct: 5,
    incorrect: 1,
    extra: 0,
    missed: 1,
  });
  assert.deepEqual(charBreakdown(spec, "abc defxx"), {
    correct: 7,
    incorrect: 0,
    extra: 2,
    missed: 0,
  });
  assert.deepEqual(charBreakdown(spec, ""), {
    correct: 0,
    incorrect: 0,
    extra: 0,
    missed: 7,
  });
  // Tamamlanan satırın Enter'ı da bir doğru karakter sayılır.
  const two = specOf(["ab", "cd"]);
  assert.equal(charBreakdown(two, "ab\ncd").correct, 5);
  // Hedefin ötesindeki dolu satırlar fazla karakter sayılır.
  assert.equal(charBreakdown(two, "ab\ncd\nxyz").extra, 3);
});

test("ingest: tuş sayımı, seri, düzeltme, afk", () => {
  const { TextDocument } = require("vscode-languageserver-textdocument");
  const spec = specOf(["abc"]);
  const s = new Session("mem://d");
  s.start(spec);
  s.prevText = "\n\n";

  let doc = TextDocument.create("mem://d", "typing", 1, "\n\n");
  const type = (text, at) => {
    doc = TextDocument.create("mem://d", "typing", 1, text);
    s.ingest(doc, text, at);
  };

  type("a\n\n", 1000);
  type("ab\n\n", 1100);
  type("abX\n\n", 1200);
  assert.equal(s.correctKeys, 2);
  assert.equal(s.wrongKeys, 1);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.streak, 0);

  type("ab\n\n", 1300); // silme
  assert.equal(s.corrections, 1);

  type("abc\n\n", 10_000); // 8.7 sn duraklama → afk
  assert.ok(s.afkMs >= 8000, `afkMs ${s.afkMs}`);
  assert.equal(s.correctKeys, 3);
  assert.ok(s.complete("abc\n\n"));

  // Yapıştırma (8 karakterden uzun) doğruluğa katılmaz.
  const before = s.correctKeys + s.wrongKeys;
  type("abcdefghijkl\n\n", 11_000);
  assert.equal(s.correctKeys + s.wrongKeys, before);
});

test("complete: yalnızca baştaki girinti bağışlanır", () => {
  const s = new Session("mem://g");
  s.start(specOf(["abc", "de"]));

  assert.ok(s.complete("abc\nde\n"), "birebir yazım tamamlanmalı");
  // Zed'in otomatik girintisi cezalandırılmaz.
  assert.ok(s.complete("    abc\n  de\n"), "baştaki girinti bağışlanmalı");
  // Sondaki fazla boşluk metrikte "fazla karakter"; tamamlanmış sayılmamalı.
  assert.equal(s.complete("abc \nde\n"), false, "satır sonu boşluğu tamamlamamalı");
  assert.equal(s.complete("abc\nde \n"), false, "son satır boşluğu tamamlamamalı");
  assert.equal(s.complete("abc\nde\nx"), false, "fazla dolu satır tamamlamamalı");
  assert.ok(s.complete("abc\nde\n   \n"), "boş fazla satırlar sorun değil");
  assert.equal(s.complete("ab\nde\n"), false, "eksik karakter tamamlamamalı");

  // charBreakdown ile tutarlı: sondaki boşluk fazla karakter sayılır.
  assert.equal(charBreakdown(s.spec, "abc \nde\n").extra, 1);
});

test("reachedEnd: hedefin sonu, hata düzeltilmese de bitiştir", () => {
  const s = new Session("mem://h");
  s.start(specOf(["abc", "de"]));

  // Yarıda: daha bitmedi.
  assert.equal(s.reachedEnd("ab\n\n"), false);
  assert.equal(s.reachedEnd("abc\n\n"), false, "son satır yazılmadan bitmemeli");
  assert.equal(s.reachedEnd("abc\nd\n"), false, "son satır eksikken bitmemeli");

  // Birebir doğru: biter ve tamamlanmış sayılır.
  assert.ok(s.reachedEnd("abc\nde\n"));
  assert.ok(s.complete("abc\nde\n"));

  // Düzeltilmemiş hata: yine biter, ama "tamamlandı" değildir.
  assert.ok(s.reachedEnd("abX\nde\n"), "hata düzeltilmesi beklenmemeli");
  assert.equal(s.complete("abX\nde\n"), false);

  // Görünmez satır sonu boşluğu da testi kilitlemez.
  assert.ok(s.reachedEnd("abc \nde\n"));
  assert.equal(s.complete("abc \nde\n"), false);

  // Baştaki girinti bağışlanır, uzunluk çekirdek üzerinden ölçülür.
  assert.equal(s.reachedEnd("    ab\n    de\n"), false);
  assert.ok(s.reachedEnd("    abc\n    de\n"));


  // Erken basılmış Enter satırları kaydırır; satır bazlı ölçü burada kilitlenirdi.
  assert.equal(s.reachedEnd("ab\nc\nd\n"), false, "hâlâ 4 karakter yazıldı");
  assert.ok(s.reachedEnd("ab\nc\nde\n"), "kayan satırlarla da bitmeli");
  // Araya boş satır sokulması da kilitlemez.
  assert.ok(s.reachedEnd("abc\n\nde\n"), "aradaki boş satır kilitlememeli");
  // Enter'a hiç basılmazsa bile karakter hedefi dolunca biter.
  assert.ok(s.reachedEnd("abcde\n"), "tek satırda yazım da bitmeli");
  assert.equal(s.reachedEnd("abcd\n"), false);
  // Hedef yoksa bitiş yok.
  const idle = new Session("mem://i");
  assert.equal(idle.reachedEnd("abc"), false);
});

test("liveSnapshot: ilerleme tamamı doğru yazılmış kelimeleri sayar", () => {
  const spec = generate({ ...DEFAULTS, wordCount: 10, repeat: "unique" }, 4242);
  const s = new Session("mem://e");
  s.start(spec);
  s.startedAt = 0;

  const full = spec.lines.join("\n");
  assert.equal(liveSnapshot(s, "", 1000).progress, 0);
  assert.equal(liveSnapshot(s, full, 1000).progress, spec.meta.words);
  assert.equal(liveSnapshot(s, full, 1000).totalWords, 10);

  const firstWord = spec.words[0];
  assert.equal(liveSnapshot(s, firstWord, 1000).progress, 1);
  assert.equal(liveSnapshot(s, `${firstWord.slice(0, -1)}`, 1000).progress, 0);
});

test("kelime ve tuş istatistikleri olaylardan üretilir", () => {
  const spec = specOf(["ab cd"]);
  const s = new Session("mem://f");
  s.start(spec);
  s.startedAt = 0;
  s.finishedAt = 60_000;
  s.phase = "finished";
  s.correctKeys = 5;
  s.events = [
    { t: 0, ch: "a", expected: "a", ok: true, line: 0, col: 0 },
    { t: 100, ch: "b", expected: "b", ok: true, line: 0, col: 1 },
    { t: 200, ch: " ", expected: " ", ok: true, line: 0, col: 2 },
    { t: 500, ch: "c", expected: "c", ok: true, line: 0, col: 3 },
    { t: 900, ch: "x", expected: "d", ok: false, line: 0, col: 4 },
  ];
  const r = finalize(s, "ab cd", 60_000);
  assert.equal(r.words.length, 2);
  assert.equal(r.words[0].word, "ab");
  assert.equal(r.words[1].word, "cd");
  assert.equal(r.words[1].errors, 1);
  const keyD = r.keys.find((k) => k.key === "d");
  assert.equal(keyD.attempts, 1);
  assert.equal(keyD.errors, 1);
  const space = r.keys.find((k) => k.key === " ");
  assert.equal(space.attempts, 1);
});

test("foldKey: büyük harf fiziksel tuşuna katlanır, dile duyarlı", () => {
  // Türkçe: noktalı/noktasız I çifti doğru eşlenir.
  assert.equal(foldKey("İ", "tr"), "i");
  assert.equal(foldKey("I", "tr"), "ı");
  for (const [up, low] of [
    ["Ş", "ş"],
    ["Ğ", "ğ"],
    ["Ü", "ü"],
    ["Ö", "ö"],
    ["Ç", "ç"],
    ["A", "a"],
    ["Z", "z"],
  ]) {
    assert.equal(foldKey(up, "tr"), low, `${up} → ${low}`);
  }

  // İngilizce: I küçük i'dir (Türkçe kuralı sızmamalı).
  assert.equal(foldKey("I", "en"), "i");
  assert.equal(foldKey("A", "en"), "a");

  // Katlanan her sonuç TEK kod noktası olmalı: "İ".toLowerCase() iki kod
  // noktası üretir ve hiçbir tuşla eşleşmez.
  for (const lang of ["tr", "en"]) {
    for (const ch of "İIŞĞÜÖÇABZ") {
      assert.equal([...foldKey(ch, lang)].length, 1, `${ch} (${lang}) genişledi`);
    }
  }

  // Shift'li noktalama katlanmaz: hangi tuşun üstünde olduğu düzene bağlı.
  for (const ch of ['"', "%", "(", ")", "?", ":", " "]) {
    assert.equal(foldKey(ch, "tr"), ch);
  }
});

test("tuş istatistikleri büyük/küçük harfi tek tuşta toplar", () => {
  const spec = specOf(["Işık Ali"]);
  const s = new Session("mem://j");
  s.start(spec);
  s.startedAt = 0;
  s.finishedAt = 60_000;
  s.phase = "finished";
  s.events = [
    { t: 0, ch: "I", expected: "I", ok: true, line: 0, col: 0 },
    { t: 100, ch: "ş", expected: "ş", ok: true, line: 0, col: 1 },
    { t: 200, ch: "X", expected: "ı", ok: false, line: 0, col: 2 },
    { t: 300, ch: "k", expected: "k", ok: true, line: 0, col: 3 },
    { t: 400, ch: " ", expected: " ", ok: true, line: 0, col: 4 },
    { t: 500, ch: "A", expected: "A", ok: true, line: 0, col: 5 },
    { t: 600, ch: "l", expected: "l", ok: true, line: 0, col: 6 },
    { t: 700, ch: "İ", expected: "i", ok: false, line: 0, col: 7 },
  ];
  const r = finalize(s, "Işık Ali", 60_000);

  // Büyük harfler ayrı giriş açmamalı.
  assert.equal(r.keys.some((k) => /[A-ZİIŞĞÜÖÇ]/.test(k.key)), false, JSON.stringify(r.keys));
  // "I" ve "ı" aynı tuş: 1 doğru + 1 hata.
  const dotless = r.keys.find((k) => k.key === "ı");
  assert.equal(dotless.attempts, 2);
  assert.equal(dotless.errors, 1);
  // "A" → "a".
  assert.equal(r.keys.find((k) => k.key === "a").attempts, 1);
  // Beklenen "i" idi, yazılan "İ" yanlıştı: sayaç beklenen tuşa yazılır.
  const dotted = r.keys.find((k) => k.key === "i");
  assert.equal(dotted.attempts, 1);
  assert.equal(dotted.errors, 1);
});
