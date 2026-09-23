/**
 * Tek seçenek kaynağı.
 *
 * Öncelik: DEFAULTS < settings.json (initializationOptions) < prefs.json.
 * Kod eylemiyle değiştirilen her anahtar `prefs.json`'a yazılır; Zed
 * `lsp.typing-lsp.settings` değişince sunucuyu yeniden başlattığı için
 * editör içi tercihlerin diskte durması şart.
 */
import { prefsFile, readFileSafe, removeFileSafe, writeFileSafe } from "./paths";
import type { Lang, QuoteLength } from "./words";

export type { Lang, QuoteLength };
export type Mode = "words" | "time" | "chars" | "quote" | "custom";
export type Repeat = "unique" | "window" | "allow";
export type Display = "inlay" | "diagnostic" | "both";
export type Theme = "dark" | "light";

export interface Options {
  language: Lang;
  mode: Mode;
  wordCount: number;
  duration: number;
  charCount: number;
  quoteLength: QuoteLength;
  punctuation: boolean;
  numbers: boolean;
  quotes: boolean;
  symbols: boolean;
  capitalize: boolean;
  repeat: Repeat;
  repeatWindow: number;
  minWordLength: number;
  maxWordLength: number;
  lineWidth: number;
  previewLines: number;
  display: Display;
  blind: boolean;
  liveStats: boolean;
  liveIntervalMs: number;
  resultCard: boolean;
  htmlReport: boolean;
  openReport: boolean;
  reportTheme: Theme;
  replay: boolean;
  /** İlk satırın üstünde tıklanabilir kod merceği araç çubuğu. */
  codeLens: boolean;
  history: boolean;
  seed: number | null;
  customText: string | null;
}

export const DEFAULTS: Options = {
  language: "en",
  mode: "words",
  wordCount: 25,
  duration: 30,
  charCount: 200,
  quoteLength: "medium",
  punctuation: false,
  numbers: false,
  quotes: false,
  symbols: false,
  capitalize: false,
  repeat: "window",
  repeatWindow: 4,
  minWordLength: 1,
  maxWordLength: 20,
  lineWidth: 52,
  previewLines: 2,
  display: "inlay",
  blind: false,
  liveStats: true,
  liveIntervalMs: 500,
  resultCard: true,
  htmlReport: true,
  openReport: true,
  reportTheme: "dark",
  replay: true,
  codeLens: true,
  history: true,
  seed: null,
  customText: null,
};

const LANGS: readonly Lang[] = ["tr", "en"];
const MODES: readonly Mode[] = ["words", "time", "chars", "quote", "custom"];
const REPEATS: readonly Repeat[] = ["unique", "window", "allow"];
const DISPLAYS: readonly Display[] = ["inlay", "diagnostic", "both"];
const THEMES: readonly Theme[] = ["dark", "light"];
const QUOTE_LENGTHS: readonly QuoteLength[] = ["short", "medium", "long", "any"];

interface NumRange {
  min: number;
  max: number;
}

const RANGES: Readonly<Record<string, NumRange>> = {
  wordCount: { min: 5, max: 500 },
  duration: { min: 5, max: 600 },
  charCount: { min: 20, max: 5000 },
  repeatWindow: { min: 1, max: 50 },
  minWordLength: { min: 1, max: 20 },
  maxWordLength: { min: 1, max: 40 },
  lineWidth: { min: 24, max: 80 },
  previewLines: { min: 0, max: 6 },
  liveIntervalMs: { min: 100, max: 2000 },
};

const BOOL_KEYS = [
  "punctuation",
  "numbers",
  "quotes",
  "symbols",
  "capitalize",
  "blind",
  "liveStats",
  "resultCard",
  "htmlReport",
  "openReport",
  "replay",
  "codeLens",
  "history",
] as const;

/** Kod eylemlerinden değiştirilebilen anahtarlar (rastgele anahtar yazılmasın). */
export const SETTABLE_KEYS: Readonly<Partial<Record<keyof Options, true>>> = {
  language: true,
  mode: true,
  wordCount: true,
  duration: true,
  charCount: true,
  quoteLength: true,
  punctuation: true,
  numbers: true,
  quotes: true,
  symbols: true,
  capitalize: true,
  repeat: true,
  repeatWindow: true,
  minWordLength: true,
  maxWordLength: true,
  lineWidth: true,
  previewLines: true,
  display: true,
  blind: true,
  liveStats: true,
  liveIntervalMs: true,
  resultCard: true,
  htmlReport: true,
  openReport: true,
  reportTheme: true,
  replay: true,
  codeLens: true,
  history: true,
  seed: true,
};

/** Testi yeniden üretmeyi gerektirmeyen, yalnızca görüntüyü etkileyen anahtarlar. */
export const VIEW_ONLY_KEYS: Readonly<Record<string, true>> = {
  display: true,
  blind: true,
  liveStats: true,
  liveIntervalMs: true,
  resultCard: true,
  htmlReport: true,
  openReport: true,
  reportTheme: true,
  replay: true,
  codeLens: true,
  history: true,
  previewLines: true,
};

function clampInt(value: unknown, range: NumRange, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Bilinmeyen anahtarları atar, tipleri ve aralıkları zorlar; geçersiz değerde `base`'e düşer. */
export function sanitize(raw: unknown, base: Options = DEFAULTS): Options {
  const out: Options = { ...base };
  if (typeof raw !== "object" || raw === null) return out;
  const src = raw as Record<string, unknown>;

  if (LANGS.includes(src.language as Lang)) out.language = src.language as Lang;
  if (MODES.includes(src.mode as Mode)) out.mode = src.mode as Mode;
  if (REPEATS.includes(src.repeat as Repeat)) out.repeat = src.repeat as Repeat;
  if (DISPLAYS.includes(src.display as Display))
    out.display = src.display as Display;
  if (THEMES.includes(src.reportTheme as Theme))
    out.reportTheme = src.reportTheme as Theme;
  if (QUOTE_LENGTHS.includes(src.quoteLength as QuoteLength))
    out.quoteLength = src.quoteLength as QuoteLength;

  for (const key of BOOL_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }

  for (const key of Object.keys(RANGES)) {
    if (key in src) {
      const typed = key as keyof Options & string;
      (out as unknown as Record<string, number>)[typed] = clampInt(
        src[key],
        RANGES[key],
        (base as unknown as Record<string, number>)[typed],
      );
    }
  }

  if (src.seed === null) out.seed = null;
  else if (typeof src.seed === "number" && Number.isFinite(src.seed))
    out.seed = Math.abs(Math.round(src.seed)) >>> 0;

  if (src.customText === null) out.customText = null;
  else if (typeof src.customText === "string" && src.customText.trim() !== "")
    out.customText = src.customText;

  if (out.maxWordLength < out.minWordLength) out.maxWordLength = out.minWordLength;
  return out;
}

export function readPrefs(): Partial<Options> {
  const raw = readFileSafe(prefsFile());
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Partial<Options>)
      : {};
  } catch {
    return {};
  }
}

/** DEFAULTS < settings.json < prefs.json sırasıyla birleşir. */
export function loadOptions(fromSettings: unknown): Options {
  const withSettings = sanitize(fromSettings, DEFAULTS);
  return sanitize(readPrefs(), withSettings);
}

export function savePref<K extends keyof Options>(key: K, value: Options[K]): void {
  const prefs = readPrefs();
  (prefs as Record<string, unknown>)[key as string] = value;
  writeFileSafe(prefsFile(), `${JSON.stringify(prefs, null, 2)}\n`);
}

export function clearPrefs(): void {
  removeFileSafe(prefsFile());
}

/** Etkin bayrakların kararlı (alfabetik) kimliği; geçmiş kovası ve rapor künyesi kullanır. */
export function flagsOf(opts: Options): string {
  const flags: string[] = [];
  if (opts.numbers) flags.push("numbers");
  if (opts.punctuation) flags.push("punctuation");
  if (opts.quotes) flags.push("quotes");
  if (opts.symbols) flags.push("symbols");
  if (opts.capitalize) flags.push("capitalize");
  if (opts.blind) flags.push("blind");
  flags.sort();
  return flags.length > 0 ? flags.join("+") : "plain";
}

/** Kova boyutu: moda göre kelime/saniye/karakter/alıntı uzunluğu. */
export function sizeOf(opts: Options): string {
  switch (opts.mode) {
    case "words":
      return String(opts.wordCount);
    case "time":
      return String(opts.duration);
    case "chars":
      return String(opts.charCount);
    case "quote":
      return opts.quoteLength;
    default:
      return "custom";
  }
}
