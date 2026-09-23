/**
 * Doküman başına tek oturum nesnesi. Tüm sıcak yol burada:
 * her `didChange` yalnızca değişen dilimi işler (O(değişen)).
 */
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TestSpec } from "./generate";
import { PASTE_THRESHOLD, indentOf, splitLines } from "./text";

export type Phase = "idle" | "ready" | "running" | "finished";
export type FinishReason = "complete" | "timeout" | "abort";

export interface Keystroke {
  /** Test başlangıcına göre ms. */
  t: number;
  ch: string;
  expected: string | null;
  ok: boolean;
  line: number;
  col: number;
}

export interface SecondSample {
  correct: number;
  typed: number;
  errors: number;
}

/** Bellek tavanı: uzun seanslarda olay listesi sınırsız büyümesin. */
const MAX_EVENTS = 50_000;
/** AFK kuralı: bu süreden uzun duraklamalar süreden düşülür. */
const AFK_GAP_MS = 5_000;

export class Session {
  readonly uri: string;
  spec: TestSpec | null = null;
  phase: Phase = "idle";
  startedAt: number | null = null;
  finishedAt: number | null = null;
  finishReason: FinishReason | null = null;
  correctKeys = 0;
  wrongKeys = 0;
  extraKeys = 0;
  corrections = 0;
  streak = 0;
  bestStreak = 0;
  afkMs = 0;
  lastKeyAt: number | null = null;
  events: Keystroke[] = [];
  samples: SecondSample[] = [];
  prevText = "";
  dirtyFrom = 0;
  dirtyTo = 0;
  /** Son sonucun HTML rapor yolu (`typing.report` bunu açar). */
  lastReportPath: string | null = null;

  constructor(uri: string) {
    this.uri = uri;
  }

  start(spec: TestSpec): void {
    this.spec = spec;
    this.phase = "ready";
    this.startedAt = null;
    this.finishedAt = null;
    this.finishReason = null;
    this.correctKeys = 0;
    this.wrongKeys = 0;
    this.extraKeys = 0;
    this.corrections = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.afkMs = 0;
    this.lastKeyAt = null;
    this.events = [];
    this.samples = [];
    this.prevText = "";
    this.dirtyFrom = 0;
    this.dirtyTo = Math.max(0, spec.lines.length);
  }

  markDirty(from: number, to: number): void {
    this.dirtyFrom = Math.min(this.dirtyFrom, from);
    this.dirtyTo = Math.max(this.dirtyTo, to);
  }

  clearDirty(): void {
    this.dirtyFrom = Number.MAX_SAFE_INTEGER;
    this.dirtyTo = -1;
  }

  /** Diff + tuş kaydı + faz geçişleri. `doc` zaten `next` metnini taşır. */
  ingest(doc: TextDocument, next: string, now: number = Date.now()): void {
    const spec = this.spec;
    if (!spec || this.phase === "finished") {
      this.prevText = next;
      return;
    }
    const prev = this.prevText;

    let p = 0;
    const maxPrefix = Math.min(prev.length, next.length);
    while (p < maxPrefix && prev[p] === next[p]) p++;
    let s = 0;
    while (
      s < prev.length - p &&
      s < next.length - p &&
      prev[prev.length - 1 - s] === next[next.length - 1 - s]
    )
      s++;

    const inserted = next.slice(p, next.length - s);
    const removed = prev.length - s - p;

    const startPos = doc.positionAt(p);
    const endPos = doc.positionAt(Math.max(p, next.length - s));
    this.markDirty(startPos.line, Math.max(endPos.line, startPos.line));

    if (removed > 0) this.corrections++;

    if (inserted.length > 0 && inserted.length <= PASTE_THRESHOLD) {
      this.recordKeys(doc, spec, p, inserted, now);
    }

    this.prevText = next;
  }

  private recordKeys(
    doc: TextDocument,
    spec: TestSpec,
    offset: number,
    inserted: string,
    now: number,
  ): void {
    const lines = splitLines(doc.getText());
    for (let k = 0; k < inserted.length; k++) {
      const ch = inserted[k];
      if (ch === "\n" || ch === "\r") continue;

      const pos = doc.positionAt(offset + k);
      const line = lines[pos.line] ?? "";
      const indent = indentOf(line);
      if (pos.character < indent) continue; // girinti (otomatik ya da elle) sayılmaz

      if (this.startedAt === null) {
        this.startedAt = now;
        this.phase = "running";
      }
      if (this.lastKeyAt !== null && now - this.lastKeyAt > AFK_GAP_MS) {
        this.afkMs += now - this.lastKeyAt;
      }
      this.lastKeyAt = now;

      const goal = spec.lines[pos.line];
      const col = pos.character - indent;
      const expected = goal !== undefined && col < goal.length ? goal[col] : null;
      const ok = expected !== null && expected === ch;

      if (ok) {
        this.correctKeys++;
        this.streak++;
        if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      } else {
        this.wrongKeys++;
        this.streak = 0;
        if (goal === undefined || col >= goal.length) this.extraKeys++;
      }

      const t = now - this.startedAt;
      this.bucket(t, ok);
      if (this.events.length < MAX_EVENTS) {
        this.events.push({ t, ch, expected, ok, line: pos.line, col });
      }
    }
  }

  /** Saniye kovaları tembel büyür (O(1) amortize). */
  private bucket(t: number, ok: boolean): void {
    const idx = Math.max(0, Math.floor(t / 1000));
    while (this.samples.length <= idx) {
      this.samples.push({ correct: 0, typed: 0, errors: 0 });
    }
    const slot = this.samples[idx];
    slot.typed++;
    if (ok) slot.correct++;
    else slot.errors++;
  }

  /**
   * Hedef satırların tamamı birebir yazıldı mı.
   * Yalnızca baştaki girinti bağışlanır (Zed'in otomatik girintisi); sondaki
   * fazla boşluk `metrics.charBreakdown` içinde "fazla karakter" sayıldığı için
   * burada da testi tamamlamaz.
   */
  complete(text?: string): boolean {
    const spec = this.spec;
    if (!spec) return false;
    const typed = splitLines(text ?? this.prevText);
    for (let i = 0; i < spec.lines.length; i++) {
      const line = typed[i];
      if (line === undefined) return false;
      if (line.slice(indentOf(line)) !== spec.lines[i]) return false;
    }
    return typed
      .slice(spec.lines.length)
      .every((l) => l.slice(indentOf(l)) === "");
  }

  /**
   * Hedefin sonuna varıldı mı — hatalar düzeltilmiş olmasa bile.
   *
   * Bitiş koşulu budur: karakter hedefi dolunca test biter.
   * `complete()` yalnızca sonuçtaki "tamamlandı" bayrağını belirler; bitişi ona
   * bağlamak, düzeltilmemiş tek bir harfin testi sonsuza dek açık bırakmasına
   * yol açardı.
   *
   * Ölçü **satır bazlı değil, toplam karakter bazlıdır**: erken basılmış bir
   * Enter satırları kaydırır ve hiçbir tampon satırı kendi hedefiyle bir daha
   * hizalanmaz. Toplam üzerinden bakınca böyle bir kayma testi kilitleyemez.
   * Doğru yazımda iki ölçü aynı anda dolar (her satır hedefine ulaştığında
   * toplam da dolmuş olur), bu yüzden normal akışta erken bitiş olmaz.
   */
  reachedEnd(text?: string): boolean {
    const spec = this.spec;
    if (!spec || spec.lines.length === 0) return false;

    let goalChars = 0;
    for (const line of spec.lines) goalChars += line.length;

    let typedChars = 0;
    for (const line of splitLines(text ?? this.prevText)) {
      typedChars += line.length - indentOf(line); // baştaki girinti sayılmaz
      if (typedChars >= goalChars) return true;
    }
    return false;
  }

  finish(reason: FinishReason, now: number = Date.now()): void {
    if (this.phase === "finished") return;
    this.finishedAt = now;
    this.finishReason = reason;
    this.phase = "finished";
    if (this.startedAt === null) this.startedAt = now;
  }
}
