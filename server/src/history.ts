/**
 * Geçmiş depolama (history.jsonl) ve kişisel rekor hesaplama.
 *
 * Yazma/okuma hataları asla test akışını kesmez: her hata yolu `warnOnce`
 * ile bir kez loglanır, çağıran her zaman kullanılabilir bir değer alır.
 */
import fs from "node:fs";
import path from "node:path";

import type { TestMeta } from "./generate";
import type { CharBreakdown, Result } from "./metrics";
import type { Lang, Mode, Options } from "./options";
import { flagsOf, sizeOf } from "./options";
import { ensureDir, historyFile, readFileSafe, warnOnce } from "./paths";

export interface HistoryRow {
  v: 1;
  at: number;
  bucket: string;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  timeSec: number;
  chars: CharBreakdown;
  corrections: number;
  bestStreak: number;
  afkSec: number;
  complete: boolean;
  mode: Mode;
  language: Lang;
  size: string;
  flags: string;
  seed: number;
}

const MAX_LINES = 10000;
const KEEP_LINES = 8000;

/** Kova kimliği: `mod:boyut:dil:bayraklar` — geçmiş ve rapor künyesi bunu paylaşır. */
export function bucketOf(opts: Options, meta: TestMeta): string {
  return `${meta.mode}:${sizeOf(opts)}:${meta.language}:${flagsOf(opts)}`;
}

/** Satır sayısı sınırı aşılmışsa en eski satırları atarak dosyayı yeniden yazar. */
function trimIfNeeded(): void {
  const content = readFileSafe(historyFile());
  if (content === null) return;
  const lines = content.split("\n").filter((line) => line.length > 0);
  if (lines.length <= MAX_LINES) return;
  const kept = lines.slice(lines.length - KEEP_LINES);
  try {
    fs.writeFileSync(historyFile(), `${kept.join("\n")}\n`, "utf8");
  } catch (err) {
    warnOnce(`could not trim history file (${historyFile()}): ${String(err)}`);
  }
}

/**
 * Sonucu geçmişe ekler; `opts.history === false` ise hiçbir şey yazmadan
 * `null` döner. Yazma başarısız olsa bile bellekteki satır döner (sonuç
 * kartı hâlâ rekor karşılaştırması için kullanabilsin diye).
 */
export function append(r: Result, opts: Options): HistoryRow | null {
  if (!opts.history) return null;
  const row: HistoryRow = {
    v: 1,
    at: r.at,
    bucket: bucketOf(opts, r.meta),
    wpm: r.wpm,
    raw: r.raw,
    accuracy: r.accuracy,
    consistency: r.consistency,
    timeSec: r.timeSec,
    chars: r.chars,
    corrections: r.corrections,
    bestStreak: r.bestStreak,
    afkSec: r.afkSec,
    complete: r.complete,
    mode: r.meta.mode,
    language: r.meta.language,
    size: sizeOf(opts),
    flags: flagsOf(opts),
    seed: r.meta.seed,
  };
  try {
    trimIfNeeded();
    if (!ensureDir(path.dirname(historyFile()))) return row;
    fs.appendFileSync(historyFile(), `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    warnOnce(`could not append to history (${historyFile()}): ${String(err)}`);
  }
  return row;
}

function isHistoryRow(value: unknown): value is HistoryRow {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.v === 1 && typeof obj.wpm === "number" && Number.isFinite(obj.wpm);
}

/** Dosyayı eskiden yeniye satır satır ayrıştırır; bozuk satırlar sessizce atlanır. */
function readAll(): HistoryRow[] {
  const content = readFileSafe(historyFile());
  if (content === null) return [];
  const rows: HistoryRow[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isHistoryRow(parsed)) rows.push(parsed);
    } catch {
      // bozuk satır: atla
    }
  }
  return rows;
}

/** Geçmişi eskiden yeniye döner (en yeni sonda); `limit` verilirse en yeni `limit` satır. */
export function read(limit?: number): HistoryRow[] {
  const rows = readAll();
  if (limit === undefined) return rows;
  if (limit <= 0) return [];
  return rows.slice(Math.max(0, rows.length - limit));
}

export interface Personal {
  best: HistoryRow | null;
  prevBest: HistoryRow | null;
  avg10: number;
  count: number;
}

/**
 * Belirtilen kova için kişisel rekor bilgisi. `before` verilirse yalnızca o
 * zamandan önceki satırlar dikkate alınır (rekor kırıldıysa önceki rekoru
 * append'ten önce hesaplamak için kullanılır).
 */
export function personal(bucket: string, before?: number): Personal {
  const rows = readAll().filter(
    (row) => row.bucket === bucket && (before === undefined || row.at < before),
  );
  const count = rows.length;
  if (count === 0) {
    return { best: null, prevBest: null, avg10: 0, count: 0 };
  }

  let best = rows[0];
  for (const row of rows) {
    if (row.wpm > best.wpm || (row.wpm === best.wpm && row.at < best.at)) {
      best = row;
    }
  }

  let prevBest: HistoryRow | null = null;
  for (const row of rows) {
    if (row.at >= best.at) continue;
    if (
      prevBest === null ||
      row.wpm > prevBest.wpm ||
      (row.wpm === prevBest.wpm && row.at < prevBest.at)
    ) {
      prevBest = row;
    }
  }

  const newest10 = rows.slice(Math.max(0, rows.length - 10));
  const avg10 = Math.round((newest10.reduce((sum, row) => sum + row.wpm, 0) / newest10.length) * 10) / 10;

  return { best, prevBest, avg10, count };
}
