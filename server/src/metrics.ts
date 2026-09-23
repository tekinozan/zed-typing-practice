/**
 * Metrikler. Canlı durum satırı `liveSnapshot`, bitiş kartı/raporu `finalize` kullanır.
 *
 * Formüller Monkeytype ile aynı: wpm = doğru karakter / 5 / dakika,
 * raw = tüm tuşlar / 5 / dakika, tutarlılık = kogasa (cv → tanh) dönüşümü.
 */
import type { TestMeta, TestSpec } from "./generate";
import type { Lang } from "./options";
import type { Keystroke, Session } from "./session";
import { indentOf, splitLines } from "./text";

export interface CharBreakdown {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
}

export interface WordStat {
  word: string;
  wpm: number;
  errors: number;
  ms: number;
}

export interface KeyStat {
  key: string;
  attempts: number;
  errors: number;
  meanMs: number;
}

export interface SeriesPoint {
  t: number;
  wpm: number;
  raw: number;
  errors: number;
}

export interface Result {
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  timeSec: number;
  afkSec: number;
  chars: CharBreakdown;
  corrections: number;
  bestStreak: number;
  complete: boolean;
  series: SeriesPoint[];
  words: WordStat[];
  keys: KeyStat[];
  meta: TestMeta;
  at: number;
}

export interface LiveSnapshot {
  wpm: number;
  accuracy: number;
  progress: number;
  totalWords: number;
  elapsedSec: number;
  remainingSec: number | null;
  streak: number;
  chars: number;
  totalChars: number;
}

interface WordRange {
  word: string;
  line: number;
  start: number;
  end: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Hedef metindeki kelime aralıkları (satır, başlangıç, bitiş sütunu). */
export function wordRanges(spec: TestSpec): WordRange[] {
  const out: WordRange[] = [];
  spec.lines.forEach((line, i) => {
    let col = 0;
    while (col < line.length) {
      if (line[col] === " ") {
        col++;
        continue;
      }
      let end = col;
      while (end < line.length && line[end] !== " ") end++;
      out.push({ word: line.slice(col, end), line: i, start: col, end });
      col = end;
    }
  });
  return out;
}

/** Son tampon metni ile hedefin karakter karşılaştırması. */
export function charBreakdown(spec: TestSpec, text: string): CharBreakdown {
  const typed = splitLines(text);
  const out: CharBreakdown = { correct: 0, incorrect: 0, extra: 0, missed: 0 };

  spec.lines.forEach((goal, i) => {
    const raw = typed[i] ?? "";
    const core = raw.slice(indentOf(raw));
    const shared = Math.min(core.length, goal.length);
    for (let j = 0; j < shared; j++) {
      if (core[j] === goal[j]) out.correct++;
      else out.incorrect++;
    }
    if (core.length > goal.length) out.extra += core.length - goal.length;
    else out.missed += goal.length - core.length;
    // Tamamlanan satırın sonundaki Enter da bir doğru karakter sayılır.
    if (core === goal && i < spec.lines.length - 1 && typed.length > i + 1)
      out.correct++;
  });

  for (let i = spec.lines.length; i < typed.length; i++) {
    const raw = typed[i];
    const core = raw.slice(indentOf(raw));
    out.extra += core.length;
  }
  return out;
}

/** Baştan itibaren tamamı doğru yazılmış hedef kelime sayısı. */
function progressWords(spec: TestSpec, text: string, ranges: WordRange[]): number {
  const typed = splitLines(text);
  let done = 0;
  for (const r of ranges) {
    const raw = typed[r.line] ?? "";
    const core = raw.slice(indentOf(raw));
    if (core.length < r.end) return done;
    if (core.slice(r.start, r.end) !== spec.lines[r.line].slice(r.start, r.end))
      return done;
    done++;
  }
  return done;
}

function elapsedMsOf(s: Session, now: number): number {
  if (s.startedAt === null) return 0;
  return Math.max((s.finishedAt ?? now) - s.startedAt, 1);
}

export function liveSnapshot(
  s: Session,
  text: string,
  now: number = Date.now(),
): LiveSnapshot {
  const spec = s.spec;
  if (!spec) {
    return {
      wpm: 0,
      accuracy: 100,
      progress: 0,
      totalWords: 0,
      elapsedSec: 0,
      remainingSec: null,
      streak: 0,
      chars: 0,
      totalChars: 0,
    };
  }

  const chars = charBreakdown(spec, text);
  const elapsedMs = elapsedMsOf(s, now);
  const minutes = elapsedMs / 60000;
  const keys = s.correctKeys + s.wrongKeys;
  const duration = spec.meta.durationSec;

  return {
    wpm: minutes > 0 && s.startedAt !== null ? Math.round(chars.correct / 5 / minutes) : 0,
    accuracy: keys > 0 ? Math.round((s.correctKeys / keys) * 100) : 100,
    progress: progressWords(spec, text, wordRanges(spec)),
    totalWords: spec.meta.words,
    elapsedSec: elapsedMs / 1000,
    remainingSec:
      duration === undefined
        ? null
        : Math.max(0, duration - (s.startedAt === null ? 0 : elapsedMs / 1000)),
    streak: s.streak,
    chars: chars.correct + chars.incorrect,
    totalChars: spec.meta.chars,
  };
}

/** Kogasa dönüşümü: varyasyon katsayısını 0–100 tutarlılığa çevirir. */
function consistencyOf(samples: readonly { typed: number }[]): number {
  if (samples.length < 2) return 100;
  const raws = samples.map((s) => s.typed * 12);
  const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
  if (mean === 0) return 0;
  const variance =
    raws.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / raws.length;
  const cv = Math.sqrt(variance) / mean;
  const value = 100 * (1 - Math.tanh(cv + cv ** 3 / 3 + cv ** 5 / 5));
  return round1(Math.max(0, value));
}

function buildSeries(samples: readonly { correct: number; typed: number; errors: number }[]): SeriesPoint[] {
  const points: SeriesPoint[] = samples.map((s, i) => ({
    t: i + 1,
    wpm: s.correct * 12,
    raw: s.typed * 12,
    errors: s.errors,
  }));
  if (points.length < 3) return points;
  // Grafik okunur kalsın diye 3 noktalı hareketli ortalama (tutarlılık ham değerlerden gelir).
  return points.map((p, i) => {
    const from = Math.max(0, i - 1);
    const to = Math.min(points.length - 1, i + 1);
    let wpm = 0;
    let raw = 0;
    for (let k = from; k <= to; k++) {
      wpm += points[k].wpm;
      raw += points[k].raw;
    }
    const n = to - from + 1;
    return { t: p.t, wpm: round1(wpm / n), raw: round1(raw / n), errors: p.errors };
  });
}

function buildWordStats(spec: TestSpec, events: readonly Keystroke[]): WordStat[] {
  const ranges = wordRanges(spec);
  if (ranges.length === 0) return [];

  const byLine = new Map<number, WordRange[]>();
  ranges.forEach((r, idx) => {
    const list = byLine.get(r.line);
    const tagged = { ...r, idx } as WordRange & { idx: number };
    if (list) list.push(tagged);
    else byLine.set(r.line, [tagged]);
  });

  const firstT = new Array<number>(ranges.length).fill(-1);
  const lastT = new Array<number>(ranges.length).fill(-1);
  const errors = new Array<number>(ranges.length).fill(0);

  for (const ev of events) {
    const list = byLine.get(ev.line);
    if (!list) continue;
    // Satır içi ikili arama: sütunu kapsayan (ya da hemen öncesindeki) kelime.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ev.col < list[mid].start) hi = mid - 1;
      else if (ev.col >= list[mid].end) {
        found = mid;
        lo = mid + 1;
      } else {
        found = mid;
        break;
      }
    }
    if (found < 0) continue;
    const idx = (list[found] as WordRange & { idx: number }).idx;
    if (firstT[idx] < 0) firstT[idx] = ev.t;
    lastT[idx] = ev.t;
    if (!ev.ok) errors[idx]++;
  }

  const stats: WordStat[] = [];
  let prevLast = -1;
  for (let i = 0; i < ranges.length; i++) {
    if (lastT[i] < 0) {
      continue;
    }
    const base = prevLast >= 0 ? prevLast : firstT[i];
    const ms = lastT[i] - base;
    prevLast = lastT[i];
    if (ms <= 0) continue;
    stats.push({
      word: ranges[i].word,
      ms,
      errors: errors[i],
      wpm: round1(((ranges[i].word.length + 1) / 5 / (ms / 60000))),
    });
  }
  return stats;
}

/**
 * Büyük harfi fiziksel tuşuna katlar: `A`→`a`, `Ş`→`ş`.
 *
 * `toLowerCase()` tek başına yetmez — `"İ".toLowerCase()` iki kod noktası
 * üretir (`i` + U+0307) ve hiçbir tuşla eşleşmez; `"I".toLowerCase()` ise
 * Türkçe'de `ı` olması gerekirken `i` verir. Bu yüzden Türkçe çiftler açıkça
 * eşlenir. Shift'li noktalama (`"`, `%`, `(`) katlanmaz: hangi tuşun üstünde
 * olduğu klavye düzenine bağlı, bilemeyiz.
 */
const TR_FOLD: Record<string, string> = {
  İ: "i",
  I: "ı",
  Ş: "ş",
  Ğ: "ğ",
  Ü: "ü",
  Ö: "ö",
  Ç: "ç",
};

export function foldKey(ch: string, lang: Lang): string {
  if (lang === "tr") {
    const mapped = TR_FOLD[ch];
    if (mapped !== undefined) return mapped;
  }
  const lower = ch.toLowerCase();
  // Tek kod noktası kalmıyorsa katlama (beklenmedik genişlemelere karşı).
  return [...lower].length === 1 ? lower : ch;
}

function buildKeyStats(events: readonly Keystroke[], lang: Lang): KeyStat[] {
  const acc = new Map<string, { attempts: number; errors: number; sum: number; n: number }>();
  let prevT = 0;
  for (const ev of events) {
    const key = foldKey(ev.expected ?? ev.ch, lang);
    let slot = acc.get(key);
    if (!slot) {
      slot = { attempts: 0, errors: 0, sum: 0, n: 0 };
      acc.set(key, slot);
    }
    slot.attempts++;
    if (!ev.ok) slot.errors++;
    else {
      const gap = ev.t - prevT;
      if (gap > 0 && gap < 3000) {
        slot.sum += gap;
        slot.n++;
      }
    }
    prevT = ev.t;
  }
  const out: KeyStat[] = [];
  acc.forEach((v, key) => {
    out.push({
      key,
      attempts: v.attempts,
      errors: v.errors,
      meanMs: v.n > 0 ? Math.round(v.sum / v.n) : 0,
    });
  });
  return out;
}

export function finalize(s: Session, text: string, now: number = Date.now()): Result {
  const spec = s.spec;
  const meta: TestMeta = spec?.meta ?? {
    mode: "words",
    language: "tr",
    source: "generated",
    words: 0,
    uniqueWords: 0,
    repeats: 0,
    chars: 0,
    numericTokens: 0,
    quotedRuns: 0,
    punctuationMarks: 0,
    symbolTokens: 0,
    longestWord: 0,
    avgWordLength: 0,
    seed: 0,
  };

  const chars = spec
    ? charBreakdown(spec, text)
    : { correct: 0, incorrect: 0, extra: 0, missed: 0 };
  const elapsedMs = elapsedMsOf(s, now);
  const minutes = elapsedMs / 60000;
  const keys = s.correctKeys + s.wrongKeys;

  return {
    wpm: minutes > 0 ? round1(chars.correct / 5 / minutes) : 0,
    raw: minutes > 0 ? round1(keys / 5 / minutes) : 0,
    accuracy: keys > 0 ? round1((s.correctKeys / keys) * 100) : 100,
    consistency: consistencyOf(s.samples),
    timeSec: round1(elapsedMs / 1000),
    afkSec: round1(s.afkMs / 1000),
    chars,
    corrections: s.corrections,
    bestStreak: s.bestStreak,
    complete: spec ? s.complete(text) : false,
    series: buildSeries(s.samples),
    words: spec ? buildWordStats(spec, s.events) : [],
    keys: buildKeyStats(s.events, meta.language),
    meta,
    at: s.finishedAt ?? now,
  };
}
