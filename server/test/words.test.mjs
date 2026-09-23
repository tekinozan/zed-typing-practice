import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tr = require("../dist/words/tr.js");
const en = require("../dist/words/en.js");
const { QUOTES } = require("../dist/words/quotes.js");
const { wordPool, quotePool } = require("../dist/words/index.js");

test("tr havuzu: benzersiz, küçük harf, 2-12 karakter", () => {
  assert.ok(tr.WORDS.length >= 300, `tr kelime sayısı ${tr.WORDS.length}`);
  assert.equal(new Set(tr.WORDS).size, tr.WORDS.length);
  for (const w of tr.WORDS) {
    assert.match(w, /^[a-zçğıöşü]+$/, `geçersiz karakter: ${w}`);
    assert.ok(w.length >= 2 && w.length <= 12, `uzunluk dışı: ${w}`);
  }
});

test("en havuzu: benzersiz, küçük harf, 2-12 karakter", () => {
  assert.ok(en.WORDS.length >= 300, `en kelime sayısı ${en.WORDS.length}`);
  assert.equal(new Set(en.WORDS).size, en.WORDS.length);
  for (const w of en.WORDS) {
    assert.match(w, /^[a-z']+$/, `geçersiz karakter: ${w}`);
    assert.ok(w.length >= 2 && w.length <= 12, `uzunluk dışı: ${w}`);
  }
});

test("wordPool uzunluk filtreler ve boş havuz döndürmez", () => {
  const short = wordPool("tr", 2, 4);
  assert.ok(short.length > 0);
  assert.ok(short.every((w) => w.length >= 2 && w.length <= 4));
  // Filtre hiçbir şeyle eşleşmezse tüm listeye düşer.
  assert.equal(wordPool("tr", 100, 200).length, tr.WORDS.length);
  // Aynı anahtar önbellekten döner (referans eşitliği).
  assert.equal(wordPool("tr", 2, 4), short);
});

test("alıntılar: her dil için 12+ giriş ve dolu kovalar", () => {
  for (const lang of ["tr", "en"]) {
    const all = QUOTES.filter((q) => q.lang === lang);
    assert.ok(all.length >= 12, `${lang} alıntı sayısı ${all.length}`);
    for (const q of all) {
      assert.ok(!q.text.includes("\n"), "alıntıda satır sonu olmamalı");
      assert.ok(!q.text.includes('"'), "alıntıda tırnak olmamalı");
      assert.ok(q.author.length > 0);
    }
    assert.ok(quotePool(lang, "short").every((q) => q.text.length <= 120));
    assert.ok(
      quotePool(lang, "medium").every((q) => q.text.length > 120 && q.text.length <= 300),
    );
    assert.ok(quotePool(lang, "long").every((q) => q.text.length > 300));
    assert.equal(quotePool(lang, "any").length, all.length);
  }
});
