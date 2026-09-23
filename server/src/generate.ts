/**
 * Test metni üreteci.
 *
 * Tüm rastgelelik tek `mulberry32(seed)` akışından gelir: aynı seed → aynı metin.
 * Süsleme sırası sabittir (noktalama → büyük harf → sayı → sembol → tırnak → satırlama),
 * bu yüzden seçenek kombinasyonları birbirini bozmaz.
 */
import type { Lang, Mode, Options } from "./options";
import { chance, intBetween, mulberry32, pick, randomSeed, shuffled } from "./rng";
import type { Rng } from "./rng";
import { toTargetLines, wrapTokens } from "./text";
import { quotePool, wordPool } from "./words";

export interface TestMeta {
  mode: Mode;
  language: Lang;
  source: "generated" | "quote" | "custom";
  words: number;
  uniqueWords: number;
  repeats: number;
  chars: number;
  numericTokens: number;
  quotedRuns: number;
  punctuationMarks: number;
  symbolTokens: number;
  longestWord: number;
  avgWordLength: number;
  seed: number;
  quoteAuthor?: string;
  durationSec?: number;
}

export interface TestSpec {
  lines: string[];
  words: string[];
  meta: TestMeta;
}

/** Süsleme aşamaları arasında taşınan token. Son metin: prefix + core + suffix + postfix. */
interface Tok {
  root: string;
  core: string;
  prefix: string;
  suffix: string;
  postfix: string;
  isNumber: boolean;
  isSymbol: boolean;
}

const SYMBOL_PAIRS: readonly (readonly [string, string])[] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
];
const SYMBOL_CHARS = "/&%#@*+=_~^$";
const SENTENCE_END: readonly string[] = [".", "?", "!"];

function upperFirst(word: string, lang: Lang): string {
  if (word.length === 0) return word;
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  return word[0].toLocaleUpperCase(locale) + word.slice(1);
}

function render(t: Tok): string {
  return t.prefix + t.core + t.suffix + t.postfix;
}

/** Token metinleri; kesilme yüzünden açık kalan tırnaklar son token'da kapatılır. */
function balancedWords(toks: readonly Tok[]): string[] {
  const words = toks.map(render);
  let open = 0;
  for (const t of toks) {
    if (t.prefix.includes('"')) open++;
    if (t.postfix.includes('"')) open--;
  }
  if (open > 0 && words.length > 0) words[words.length - 1] += '"'.repeat(open);
  return words;
}

/** Tekrar politikasına göre kök kelime dizisi seçer. */
function pickRoots(
  rng: Rng,
  pool: readonly string[],
  count: number,
  opts: Options,
): string[] {
  const roots: string[] = [];
  const bag = opts.repeat === "unique" ? shuffled(rng, pool) : [];
  let bagIdx = 0;
  const window = Math.max(1, opts.repeatWindow);

  for (let i = 0; i < count; i++) {
    if (opts.repeat === "unique" && bagIdx < bag.length) {
      roots.push(bag[bagIdx++]);
      continue;
    }

    // "allow": yalnızca ardışık tekrar engellenir.
    // "window" (ve havuzu tükenmiş "unique"): son `repeatWindow` token içinde tekrar yok.
    const span = opts.repeat === "allow" ? 1 : window;
    let word = pick(rng, pool);
    for (let tries = 0; tries < 20; tries++) {
      let clash = false;
      for (let k = roots.length - 1; k >= 0 && k >= roots.length - span; k--) {
        if (roots[k] === word) {
          clash = true;
          break;
        }
      }
      if (!clash) break;
      word = pick(rng, pool);
    }
    roots.push(word);
  }
  return roots;
}

function applyPunctuation(rng: Rng, toks: Tok[], lang: Lang): void {
  let i = 0;
  while (i < toks.length) {
    const len = Math.min(intBetween(rng, 4, 10), toks.length - i);
    const end = i + len - 1;
    toks[i].core = upperFirst(toks[i].core, lang);
    for (let j = i; j < end; j++) {
      if (chance(rng, 0.1)) {
        toks[j].suffix = chance(rng, 0.15) ? (chance(rng, 0.5) ? ";" : ":") : ",";
      }
    }
    const r = rng();
    toks[end].suffix = r < 0.7 ? SENTENCE_END[0] : r < 0.85 ? SENTENCE_END[1] : SENTENCE_END[2];
    i = end + 1;
  }
}

function applyNumbers(rng: Rng, toks: Tok[]): void {
  for (let i = 0; i < toks.length; i++) {
    if (i > 0 && toks[i - 1].isNumber) continue;
    if (!chance(rng, 0.15)) continue;
    const digits = intBetween(rng, 1, 4);
    let value = "";
    for (let d = 0; d < digits; d++) value += String(intBetween(rng, d === 0 && digits > 1 ? 1 : 0, 9));
    toks[i].core = value;
    toks[i].isNumber = true;
  }
  // Sayılar açıkken en az bir sayı garantilidir (aksi halde seçenek görünmez kalırdı).
  if (toks.length > 0 && !toks.some((t) => t.isNumber)) {
    const idx = intBetween(rng, 0, toks.length - 1);
    toks[idx].core = String(intBetween(rng, 1, 9999));
    toks[idx].isNumber = true;
  }
}

function applySymbols(rng: Rng, toks: Tok[]): void {
  for (const t of toks) {
    if (!chance(rng, 0.08)) continue;
    if (chance(rng, 0.5)) {
      const [open, close] = pick(rng, SYMBOL_PAIRS);
      t.prefix = open + t.prefix;
      t.postfix += close;
    } else {
      t.postfix += SYMBOL_CHARS[intBetween(rng, 0, SYMBOL_CHARS.length - 1)];
    }
    t.isSymbol = true;
  }
}

function applyQuotes(rng: Rng, toks: Tok[]): number {
  let runs = 0;
  let i = 0;
  while (i < toks.length) {
    if (!chance(rng, 0.1)) {
      i++;
      continue;
    }
    const len = Math.min(intBetween(rng, 1, 3), toks.length - i);
    const end = i + len - 1;
    toks[i].prefix = `"${toks[i].prefix}`;
    toks[end].postfix += '"';
    runs++;
    i = end + 1; // sarılmış aralıklar çakışmaz
  }
  return runs;
}

function summarize(
  toks: readonly Tok[],
  lines: readonly string[],
  base: Omit<
    TestMeta,
    | "words"
    | "uniqueWords"
    | "repeats"
    | "chars"
    | "numericTokens"
    | "symbolTokens"
    | "punctuationMarks"
    | "longestWord"
    | "avgWordLength"
  > & { quotedRuns: number },
): TestMeta {
  const seen = new Set<string>();
  let repeats = 0;
  let numericTokens = 0;
  let symbolTokens = 0;
  let punctuationMarks = 0;
  let longestWord = 0;
  let totalLen = 0;

  for (const t of toks) {
    if (seen.has(t.root)) repeats++;
    else seen.add(t.root);
    if (t.isNumber) numericTokens++;
    if (t.isSymbol) symbolTokens++;
    punctuationMarks += t.suffix.length;
    const text = render(t);
    totalLen += text.length;
    if (text.length > longestWord) longestWord = text.length;
  }

  return {
    ...base,
    words: toks.length,
    uniqueWords: seen.size,
    repeats,
    chars: lines.join("\n").length,
    numericTokens,
    symbolTokens,
    punctuationMarks,
    longestWord,
    avgWordLength:
      toks.length > 0 ? Math.round((totalLen / toks.length) * 10) / 10 : 0,
  };
}

function targetTokenCount(opts: Options): number {
  switch (opts.mode) {
    case "time":
      // ≈110 wpm üstü kullanıcı listeyi bitirirse test erken biter; beklenen davranış.
      return Math.ceil((opts.duration / 60) * 110) + 10;
    case "chars":
      // Süslemeden sonra sondan kırpılacak; bol üret.
      return Math.ceil(opts.charCount / 3) + 10;
    default:
      return opts.wordCount;
  }
}

function fromTokens(
  tokens: readonly string[],
  opts: Options,
  seed: number,
  source: TestMeta["source"],
  quoteAuthor?: string,
): TestSpec {
  const toks: Tok[] = tokens.map((w) => ({
    root: w,
    core: w,
    prefix: "",
    suffix: "",
    postfix: "",
    isNumber: false,
    isSymbol: false,
  }));
  const words = toks.map(render);
  const lines = wrapTokens(words, opts.lineWidth);
  return {
    lines,
    words,
    meta: summarize(toks, lines, {
      mode: opts.mode,
      language: opts.language,
      source,
      quotedRuns: 0,
      seed,
      ...(quoteAuthor !== undefined ? { quoteAuthor } : {}),
      ...(opts.mode === "time" ? { durationSec: opts.duration } : {}),
    }),
  };
}

/** Serbest metinden test: tab→boşluk, girinti/boş satır atılır, `lineWidth`'e göre yeniden sarılır. */
export function fromText(text: string, opts: Options): TestSpec {
  const tokens = toTargetLines(text)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  return fromTokens(tokens, opts, opts.seed ?? 0, "custom");
}

export function generate(opts: Options, seedOverride?: number): TestSpec {
  const seed = seedOverride ?? opts.seed ?? randomSeed();

  if (opts.mode === "custom") {
    const text = opts.customText ?? "";
    if (text.trim() !== "") return fromText(text, opts);
  }

  const rng = mulberry32(seed);

  if (opts.mode === "quote") {
    const pool = quotePool(opts.language, opts.quoteLength);
    const quote = pick(rng, pool);
    const tokens = quote.text.split(/\s+/).filter(Boolean);
    return fromTokens(tokens, opts, seed, "quote", quote.author);
  }

  const pool = wordPool(opts.language, opts.minWordLength, opts.maxWordLength);
  const roots = pickRoots(rng, pool, targetTokenCount(opts), opts);
  const toks: Tok[] = roots.map((w) => ({
    root: w,
    core: w,
    prefix: "",
    suffix: "",
    postfix: "",
    isNumber: false,
    isSymbol: false,
  }));

  if (opts.punctuation) applyPunctuation(rng, toks, opts.language);
  if (opts.capitalize) {
    for (const t of toks) {
      if (chance(rng, 0.15)) t.core = upperFirst(t.core, opts.language);
    }
  }
  if (opts.numbers) applyNumbers(rng, toks);
  if (opts.symbols) applySymbols(rng, toks);
  const quotedRuns = opts.quotes ? applyQuotes(rng, toks) : 0;

  let kept = toks;
  let words = balancedWords(kept);
  if (opts.mode === "chars") {
    let total = 0;
    let cut = toks.length;
    for (let i = 0; i < toks.length; i++) {
      const next = total + render(toks[i]).length + (i > 0 ? 1 : 0);
      if (next > opts.charCount) {
        cut = i;
        break;
      }
      total = next;
    }
    kept = toks.slice(0, Math.max(1, cut));
    words = balancedWords(kept);
    // Kapanış tırnağı eklemek sınırı aşabilir: sığana kadar sondan kırp.
    while (kept.length > 1 && words.join(" ").length > opts.charCount) {
      kept = kept.slice(0, -1);
      words = balancedWords(kept);
    }
  }

  const lines = wrapTokens(words, opts.lineWidth);
  return {
    lines,
    words,
    meta: summarize(kept, lines, {
      mode: opts.mode,
      language: opts.language,
      source: "generated",
      quotedRuns,
      seed,
      ...(opts.mode === "time" ? { durationSec: opts.duration } : {}),
    }),
  };
}
