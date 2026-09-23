/**
 * Görselleştirme: hayalet metin (inlay hint / Hint diagnostic), hata diagnostic'i,
 * canlı durum satırı ve bitiş kartı.
 *
 * Yerleşim: test başlarken tampon `previewLines + 3` boş satırla doldurulur.
 * Hedef satır `i` doğrudan tampon satır `i` üzerine yazılır; imlecin altındaki
 * boş satırlar gelecek hedef satırların hayaletini ve durum satırını taşır.
 */
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Options } from "./options";
import type { LiveSnapshot, Result } from "./metrics";
import { liveSnapshot } from "./metrics";
import type { Personal } from "./history";
import type { Session } from "./session";
import { clampLabel, currentLine, indentOf, splitLines } from "./text";

export interface Ghost {
  line: number;
  character: number;
  label: string;
}

export interface Frame {
  ghosts: Ghost[];
  diagnostics: Diagnostic[];
  status: string;
}

/**
 * Uzun etiket sınırı. Zed'in satır içi diagnostic metni viewport'a göre
 * kırpılıyor (sabit bir protokol sınırı yok), bu yüzden kendimiz kısa tutuyoruz.
 */
const MAX_LABEL = 78;
const CARD_WIDTH = 64;
const SPARK = "▁▂▃▄▅▆▇█";
const BAR_WIDTH = 10;
const BAR_FULL = "█";
const BAR_EMPTY = "░";

interface CachedLine {
  text: string;
  diags: Diagnostic[];
  ghost: string;
}

/** Satır metni değişmediyse diagnostic ve hayalet etiketi yeniden üretilmez. */
export class RenderCache {
  lines: CachedLine[] = [];

  reset(): void {
    this.lines = [];
  }
}

function lineDiagnostics(
  typedLine: string,
  goal: string | undefined,
  index: number,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const indent = indentOf(typedLine);
  const core = typedLine.slice(indent);

  if (goal === undefined) {
    if (core.length > 0) {
      out.push({
        range: Range.create(index, indent, index, typedLine.length),
        severity: DiagnosticSeverity.Error,
        source: "typing",
        message: "Extra line",
      });
    }
    return out;
  }

  let runStart = -1;
  for (let j = 0; j <= core.length; j++) {
    const bad = j < core.length && (j >= goal.length || core[j] !== goal[j]);
    if (bad && runStart < 0) runStart = j;
    if (!bad && runStart >= 0) {
      const expected = goal.slice(runStart, j);
      out.push({
        range: Range.create(index, indent + runStart, index, indent + j),
        severity: DiagnosticSeverity.Error,
        source: "typing",
        message: expected.length > 0 ? `Expected: "${expected}"` : "Extra characters",
      });
      runStart = -1;
    }
  }
  return out;
}

/** Test başlamadan önce gösterilen yönlendirme (canlı sayaçlar henüz anlamsız). */
function readyHint(opts: Options): string {
  const size =
    opts.mode === "time"
      ? `${opts.duration}s`
      : opts.mode === "chars"
        ? `${opts.charCount} chars`
        : opts.mode === "quote"
          ? `${opts.quoteLength} quote`
          : `${opts.wordCount} words`;
  return `Start typing · ${size} · ${opts.language} · Ctrl+. → options`;
}

/** `0..1` oranını blok karakterli çubuğa çevirir. */
function progressBar(ratio: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * BAR_WIDTH);
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled);
}

export function statusLine(s: Session, text: string, opts: Options): string {
  // Henüz tek tuşa basılmadıysa wpm/acc sıfır gösterir; onun yerine yol göster.
  if (s.phase !== "running") return clampLabel(readyHint(opts), MAX_LABEL);

  const live: LiveSnapshot = liveSnapshot(s, text);
  const parts = [`wpm ${live.wpm}`, `acc ${live.accuracy}%`];

  // Çubuk moda göre doldurulur: zamanda geçen süre, aksi halde ilerleme.
  if (opts.mode === "time" && live.remainingSec !== null) {
    const total = Math.max(1, live.remainingSec + live.elapsedSec);
    parts.push(`${progressBar(live.elapsedSec / total)} ${Math.ceil(live.remainingSec)}s left`);
  } else if (opts.mode === "chars") {
    parts.push(
      `${progressBar(live.totalChars > 0 ? live.chars / live.totalChars : 0)} ${live.chars}/${live.totalChars}`,
    );
    parts.push(`${live.elapsedSec.toFixed(0)}s`);
  } else {
    parts.push(
      `${progressBar(live.totalWords > 0 ? live.progress / live.totalWords : 0)} ${live.progress}/${live.totalWords}`,
    );
    parts.push(`${live.elapsedSec.toFixed(0)}s`);
  }

  if (live.streak >= 10) parts.push(`streak ${live.streak}`);
  return clampLabel(parts.join(" · "), MAX_LABEL);
}

/**
 * Tek geçişte hayalet + hata diagnostic'i üretir.
 * Yalnızca kirli satır aralığı ve aktif satır yeniden hesaplanır.
 */
export function renderFrame(
  s: Session,
  doc: TextDocument,
  opts: Options,
  cache: RenderCache,
): Frame {
  const text = doc.getText();
  const typed = splitLines(text);
  const spec = s.spec;
  const ghosts: Ghost[] = [];
  const diagnostics: Diagnostic[] = [];

  if (!spec) {
    const last = currentLine(typed);
    return {
      ghosts: [
        {
          line: last,
          character: typed[last]?.length ?? 0,
          label: '⌨ Code actions (Ctrl+.) → "New test"',
        },
      ],
      diagnostics: [],
      status: "",
    };
  }

  const active = currentLine(typed);

  for (let i = 0; i < typed.length; i++) {
    const goal = spec.lines[i];
    if (goal === undefined && typed[i].trim() === "") continue;

    const cached = cache.lines[i];
    let diags: Diagnostic[];
    let ghost: string;
    if (cached && cached.text === typed[i]) {
      diags = cached.diags;
      ghost = cached.ghost;
    } else {
      diags = s.phase === "finished" ? [] : lineDiagnostics(typed[i], goal, i);
      const core = typed[i].slice(indentOf(typed[i]));
      ghost =
        goal !== undefined && goal.length > core.length ? goal.slice(core.length) : "";
      cache.lines[i] = { text: typed[i], diags, ghost };
    }

    if (!opts.blind && s.phase !== "finished") diagnostics.push(...diags);

    if (s.phase !== "finished") {
      if (i === active && ghost.length > 0) {
        ghosts.push({ line: i, character: typed[i].length, label: ghost });
      } else if (i > active && typed[i].trim() === "" && goal !== undefined) {
        // Önizleme: imlecin altındaki boş satırlarda tam hedef satır.
        if (i - active <= opts.previewLines) {
          ghosts.push({ line: i, character: 0, label: goal });
        }
      }
    }
  }

  // Hedef, yazılan satır sayısını aşıyorsa kalan önizleme satırları tamponda yok:
  // aktif satırın hemen altındaki boş satırlar zaten yukarıdaki döngüde işlendi.

  let status = "";
  if (s.phase !== "finished" && opts.liveStats && spec) {
    status = statusLine(s, text, opts);
    const statusLineIndex = active + opts.previewLines + 1;
    if (statusLineIndex < typed.length && typed[statusLineIndex].trim() === "") {
      ghosts.push({ line: statusLineIndex, character: 0, label: status });
    } else if (active + 1 < typed.length && typed[active + 1].trim() === "") {
      ghosts.push({ line: active + 1, character: 0, label: status });
    }
  }

  return { ghosts, diagnostics, status };
}

/** Hayaletleri `Hint` diagnostic'ine çevirir (display = "diagnostic" | "both"). */
export function ghostDiagnostics(ghosts: readonly Ghost[]): Diagnostic[] {
  return ghosts.map((g) => ({
    range: Range.create(g.line, g.character, g.line, g.character),
    severity: DiagnosticSeverity.Hint,
    source: "typing",
    message: clampLabel(g.label, MAX_LABEL),
  }));
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function row(left: string, right: string): string {
  const inner = CARD_WIDTH - 2;
  const gap = Math.max(1, inner - 2 - left.length - right.length);
  return `│ ${left}${" ".repeat(gap)}${right} │`;
}

function centered(text: string): string {
  const inner = CARD_WIDTH - 2;
  const left = Math.max(0, Math.floor((inner - text.length) / 2));
  return `│${" ".repeat(left)}${pad(text, inner - left)}│`;
}

function sparkline(values: readonly number[], width: number): string {
  if (values.length === 0) return "";
  const step = Math.max(1, Math.ceil(values.length / width));
  const buckets: number[] = [];
  for (let i = 0; i < values.length; i += step) {
    let sum = 0;
    let n = 0;
    for (let k = i; k < Math.min(values.length, i + step); k++) {
      sum += values[k];
      n++;
    }
    buckets.push(n > 0 ? sum / n : 0);
  }
  const max = Math.max(...buckets, 1);
  return buckets
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))])
    .join("");
}

function modeLabel(meta: Result["meta"]): string {
  switch (meta.mode) {
    case "time":
      return `${meta.durationSec ?? 0}s`;
    case "chars":
      return `${meta.chars} chars`;
    case "quote":
      return `quote${meta.quoteAuthor ? ` · ${meta.quoteAuthor}` : ""}`;
    case "custom":
      return "custom text";
    default:
      return `${meta.words} words`;
  }
}

/** Bitişte tampona basılan ASCII sonuç kartı (emojisiz: hizalama bozulmasın). */
export function resultCard(
  r: Result,
  p: Personal,
  reportPath: string | null,
): string {
  const inner = CARD_WIDTH - 2;
  const lines: string[] = [];
  lines.push(`┌${"─".repeat(inner)}┐`);
  lines.push(centered("TYPING PRACTICE — RESULT"));
  lines.push(`├${"─".repeat(inner)}┤`);
  lines.push(row(`WPM   ${r.wpm}`, `Raw    ${r.raw}`));
  lines.push(row(`Accuracy  ${r.accuracy}%`, `Consistency  ${r.consistency}%`));
  lines.push(row(`Time  ${r.timeSec}s`, `AFK  ${r.afkSec}s`));
  lines.push(
    row(
      `Chars  ${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`,
      "ok/bad/extra/missed",
    ),
  );
  lines.push(row(`Corrections  ${r.corrections}`, `Longest streak  ${r.bestStreak}`));
  lines.push(`├${"─".repeat(inner)}┤`);

  const spark = sparkline(
    r.series.map((pt) => pt.wpm),
    inner - 8,
  );
  if (spark) lines.push(row("wpm/s", spark));

  const chips = [
    modeLabel(r.meta),
    r.meta.language,
    `unique ${r.meta.uniqueWords}/${r.meta.words}`,
  ];
  if (r.meta.numericTokens > 0) chips.push("numbers");
  if (r.meta.punctuationMarks > 0) chips.push("punctuation");
  if (r.meta.quotedRuns > 0) chips.push("quotes");
  if (r.meta.symbolTokens > 0) chips.push("symbols");
  lines.push(row("Test", clampLabel(chips.join(" · "), inner - 8)));

  const slowest = r.words.slice().sort((a, b) => a.wpm - b.wpm)[0];
  const fastest = r.words.slice().sort((a, b) => b.wpm - a.wpm)[0];
  if (slowest && fastest) {
    lines.push(
      row(`Slowest  ${slowest.word} (${slowest.wpm})`, `Fastest  ${fastest.word} (${fastest.wpm})`),
    );
  }

  const worstKeys = r.keys
    .filter((k) => k.attempts >= 3 && k.errors > 0)
    .sort((a, b) => b.errors / b.attempts - a.errors / a.attempts)
    .slice(0, 3)
    .map((k) => `${k.key === " " ? "space" : k.key}(${k.errors}/${k.attempts})`);
  if (worstKeys.length > 0) lines.push(row("Worst keys", worstKeys.join(" ")));

  lines.push(`├${"─".repeat(inner)}┤`);
  if (p.count === 0) {
    lines.push(row("Record", "first test"));
  } else {
    const best = p.best ? p.best.wpm : 0;
    const flag = r.wpm >= best ? "NEW RECORD" : `best ${best}`;
    lines.push(row(`Record  ${flag}`, `Last 10 avg  ${p.avg10}`));
  }
  if (reportPath) lines.push(row("Report", clampLabel(reportPath, inner - 10)));
  lines.push(`├${"─".repeat(inner)}┤`);
  lines.push(centered("Ctrl+. -> new test · restart · report · dashboard"));
  lines.push(`└${"─".repeat(inner)}┘`);
  return lines.join("\n");
}
