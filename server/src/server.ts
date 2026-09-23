#!/usr/bin/env node
/**
 * Typing LSP — Zed içinde Monkeytype tarzı yazma testi.
 *
 * Bu dosya yalnızca LSP kablolamasıdır: initialize, belge olayları, inlay hint,
 * hover, kod eylemleri, komutlar ve zamanlayıcılar. İş mantığı modüllerdedir:
 * options / generate / session / metrics / history / report / render.
 */
import {
  CodeAction,
  CodeActionKind,
  CodeLens,
  CodeLensRefreshRequest,
  Diagnostic,
  Hover,
  InitializeParams,
  InitializeResult,
  InlayHint,
  MarkupKind,
  ProposedFeatures,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
  createConnection,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { generate, fromText } from "./generate";
import type { TestSpec } from "./generate";
import * as history from "./history";
import type { Personal } from "./history";
import { finalize, liveSnapshot } from "./metrics";
import type { Result } from "./metrics";
import {
  DEFAULTS,
  SETTABLE_KEYS,
  VIEW_ONLY_KEYS,
  clearPrefs,
  loadOptions,
  sanitize,
  savePref,
} from "./options";
import type { Lang, Options } from "./options";
import { openInBrowser } from "./paths";
import {
  RenderCache,
  ghostDiagnostics,
  renderFrame,
  resultCard,
  statusLine,
} from "./render";
import { renderDashboard, renderResult, writeReport } from "./report";
import { Session } from "./session";
import type { FinishReason } from "./session";
import { toTargetLines } from "./text";

const CMD_NEW = "typing.newTest";
const CMD_REPEAT = "typing.repeat";
const CMD_USE_TEXT = "typing.useText";
const CMD_SET_OPTION = "typing.setOption";
const CMD_ABORT = "typing.abort";
const CMD_REPORT = "typing.report";
const CMD_DASHBOARD = "typing.dashboard";
const CMD_RESET_PREFS = "typing.resetPrefs";

const COMMANDS = [
  CMD_NEW,
  CMD_REPEAT,
  CMD_USE_TEXT,
  CMD_SET_OPTION,
  CMD_ABORT,
  CMD_REPORT,
  CMD_DASHBOARD,
  CMD_RESET_PREFS,
];

/** Yayınlar bu aralıkta birleştirilir (tuş başına iş yapmamak için). */
const PUBLISH_MS = 16;

interface DocState {
  session: Session;
  cache: RenderCache;
  lastResult: Result | null;
  publishTimer: NodeJS.Timeout | null;
  lastPublish: number;
  liveTimer: NodeJS.Timeout | null;
  endTimer: NodeJS.Timeout | null;
  /** Canlı zamanlayıcı yalnızca durum etiketi değiştiğinde yayın tetikler. */
  lastStatus: string;
}

let options: Options = DEFAULTS;
/** settings.json'dan gelen son yük; `⟲ Tercihleri sıfırla` buna geri döner. */
let settingsPayload: unknown = null;
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const states = new Map<string, DocState>();
let canRefreshInlayHints = false;
let canRefreshCodeLens = false;

function stateOf(uri: string): DocState {
  let st = states.get(uri);
  if (!st) {
    st = {
      session: new Session(uri),
      cache: new RenderCache(),
      lastResult: null,
      publishTimer: null,
      lastPublish: 0,
      liveTimer: null,
      endTimer: null,
      lastStatus: "",
    };
    states.set(uri, st);
  }
  return st;
}

function clearTimers(st: DocState): void {
  if (st.liveTimer) {
    clearInterval(st.liveTimer);
    st.liveTimer = null;
  }
  if (st.endTimer) {
    clearTimeout(st.endTimer);
    st.endTimer = null;
  }
  if (st.publishTimer) {
    clearTimeout(st.publishTimer);
    st.publishTimer = null;
  }
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------
connection.onInitialize((params: InitializeParams): InitializeResult => {
  settingsPayload = params.initializationOptions ?? null;
  options = loadOptions(settingsPayload);
  canRefreshInlayHints = !!params.capabilities.workspace?.inlayHint?.refreshSupport;
  canRefreshCodeLens = !!params.capabilities.workspace?.codeLens?.refreshSupport;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      inlayHintProvider: true,
      hoverProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      // Zed kod mercelerini satırın ÜSTÜNDE bir blok olarak çiziyor:
      // tampona gömülü, tıklanabilir bir araç çubuğu.
      codeLensProvider: { resolveProvider: false },
      executeCommandProvider: { commands: COMMANDS },
    },
    serverInfo: { name: "typing-lsp", version: "0.2.0" },
  };
});

/**
 * Öncelik korunur: DEFAULTS < settings.json < prefs.json.
 * Yeni ayar yükü gelse bile editör içi tercihler (prefs.json) kazanır.
 */
connection.onDidChangeConfiguration((params) => {
  const raw = (params.settings ?? {}) as Record<string, unknown>;
  settingsPayload = (raw["typing-lsp"] ?? raw.typing ?? raw) as unknown;
  options = loadOptions(settingsPayload);
});

function refreshHints(): void {
  if (!canRefreshInlayHints) return;
  connection.languages.inlayHint.refresh().catch(() => {});
}

/** Araç çubuğu yalnızca faz değiştiğinde yenilenir; her tuşta değil. */
function refreshLenses(): void {
  if (!canRefreshCodeLens) return;
  connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
}

// ---------------------------------------------------------------------------
// Yayın (16 ms'de bir birleştirilir)
// ---------------------------------------------------------------------------
function publish(uri: string): void {
  const doc = documents.get(uri);
  if (!doc) return;
  const st = stateOf(uri);
  st.lastPublish = Date.now();

  const frame = renderFrame(st.session, doc, options, st.cache);
  let ghosts = frame.ghosts;

  if (st.session.phase === "finished" && st.lastResult && !options.resultCard) {
    const r = st.lastResult;
    ghosts = [
      {
        line: 0,
        character: doc.getText().split("\n")[0]?.length ?? 0,
        label: `✔ ${r.wpm} wpm · ${r.accuracy}% · ${r.timeSec}s`,
      },
    ];
  }
  st.lastStatus = frame.status;

  const diagnostics: Diagnostic[] = frame.diagnostics.slice();
  if (options.display !== "inlay") diagnostics.push(...ghostDiagnostics(ghosts));

  connection.sendDiagnostics({ uri, diagnostics });
  if (options.display !== "diagnostic") refreshHints();
}

function schedulePublish(uri: string): void {
  const st = stateOf(uri);
  if (st.publishTimer) return;
  const wait = Math.max(0, PUBLISH_MS - (Date.now() - st.lastPublish));
  st.publishTimer = setTimeout(() => {
    st.publishTimer = null;
    publish(uri);
  }, wait);
}

// ---------------------------------------------------------------------------
// Test başlatma
// ---------------------------------------------------------------------------
async function applyFullText(doc: TextDocument, text: string): Promise<void> {
  const current = doc.getText();
  if (current === text) return;
  const edit = TextEdit.replace(
    Range.create(doc.positionAt(0), doc.positionAt(current.length)),
    text,
  );
  await connection.workspace.applyEdit({ changes: { [doc.uri]: [edit] } });
}

async function startTest(doc: TextDocument, spec: TestSpec): Promise<void> {
  const st = stateOf(doc.uri);
  clearTimers(st);
  const blank = "\n".repeat(options.previewLines + 2);

  st.session.start(spec);
  st.session.prevText = blank;
  st.cache.reset();
  st.lastResult = null;
  st.lastStatus = "";

  await applyFullText(doc, blank);
  publish(doc.uri);
  refreshLenses();
}

function armTimers(uri: string): void {
  const st = stateOf(uri);
  if (st.session.phase !== "running") return;

  if (!st.liveTimer && options.liveStats) {
    // Kullanıcı yazmayı bıraksa bile süre/wpm akar; yalnızca etiket değişince yayınla.
    st.liveTimer = setInterval(() => {
      const doc = documents.get(uri);
      if (!doc || st.session.phase !== "running") return;
      if (statusLine(st.session, doc.getText(), options) === st.lastStatus) return;
      publish(uri);
    }, options.liveIntervalMs);
  }

  const duration = st.session.spec?.meta.durationSec;
  if (!st.endTimer && duration !== undefined && st.session.startedAt !== null) {
    const remaining = duration * 1000 - (Date.now() - st.session.startedAt);
    st.endTimer = setTimeout(
      () => {
        void finishTest(uri, "timeout");
      },
      Math.max(0, remaining),
    );
  }
}

// ---------------------------------------------------------------------------
// Belge olayları
// ---------------------------------------------------------------------------
documents.onDidOpen(({ document }) => {
  const st = stateOf(document.uri);
  st.session.prevText = document.getText();
  if (document.getText().trim() === "") {
    void startTest(document, generate(options));
  } else {
    publish(document.uri);
  }
});

documents.onDidChangeContent(({ document }) => {
  const st = stateOf(document.uri);
  const text = document.getText();
  const wasRunning = st.session.phase === "running";

  st.session.ingest(document, text);

  if (st.session.phase === "running") {
    if (!wasRunning) {
      armTimers(document.uri);
      refreshLenses(); // araç çubuğu "Finish now / Restart"a döner
    }
    // Hedefin sonuna varınca biter; hatanın düzeltilmesi beklenmez.
    // `Result.complete` birebir yazım olup olmadığını ayrıca bildirir.
    if (st.session.reachedEnd(text)) {
      void finishTest(document.uri, "complete");
      return;
    }
  }
  schedulePublish(document.uri);
});

documents.onDidClose(({ document }) => {
  const st = states.get(document.uri);
  if (st) clearTimers(st);
  states.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------
// Bitiş akışı
// ---------------------------------------------------------------------------
function reportName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `result-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.html`;
}

async function finishTest(uri: string, reason: FinishReason): Promise<void> {
  const st = stateOf(uri);
  const doc = documents.get(uri);
  if (!doc || st.session.phase === "finished" || !st.session.spec) return;

  const text = doc.getText();
  st.session.finish(reason);
  clearTimers(st);

  const result = finalize(st.session, text);
  const bucket = history.bucketOf(options, result.meta);
  const record = reason !== "abort";
  // Rekor karşılaştırması append'ten ÖNCE okunmalı.
  const personal: Personal = record
    ? history.personal(bucket)
    : { best: null, prevBest: null, avg10: 0, count: 0 };
  if (record) history.append(result, options);

  st.lastResult = result;

  let reportPath: string | null = null;
  if (options.htmlReport) {
    const html = renderResult(result, personal, options, st.session.events);
    reportPath = writeReport(html, reportName(result.at));
    st.session.lastReportPath = reportPath;
    if (reportPath && options.openReport) openInBrowser(reportPath);
  }

  connection.sendDiagnostics({ uri, diagnostics: [] });

  if (options.resultCard) {
    await applyFullText(doc, `${resultCard(result, personal, reportPath)}\n`);
    st.session.prevText = documents.get(uri)?.getText() ?? "";
  }

  const shown: unknown = connection.window.showInformationMessage(
    `⌨ ${result.wpm} wpm · ${result.accuracy}% accuracy · ${result.timeSec}s${reportPath ? ` · ${reportPath}` : ""}`,
  );
  Promise.resolve(shown).catch(() => {});

  publish(uri);
  refreshLenses();
}

// ---------------------------------------------------------------------------
// Inlay hints
// ---------------------------------------------------------------------------
connection.languages.inlayHint.on((params): InlayHint[] => {
  if (options.display === "diagnostic") return [];
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const st = stateOf(doc.uri);
  const frame = renderFrame(st.session, doc, options, st.cache);
  return frame.ghosts.map((g) => ({
    position: { line: g.line, character: g.character },
    // Hayalet, yazılan kelimenin devamıdır: araya boşluk konmaz.
    label: g.label,
    paddingLeft: false,
    paddingRight: false,
  }));
});

// ---------------------------------------------------------------------------
// Kod mercekleri: ilk satırın üstünde tıklanabilir araç çubuğu.
// Zed bunları `BlockPlacement::Above` ile gerçek bir satır bloğu olarak çiziyor.
// ---------------------------------------------------------------------------
connection.onCodeLens((params): CodeLens[] => {
  if (!options.codeLens) return [];
  const uri = params.textDocument.uri;
  const doc = documents.get(uri);
  if (!doc) return [];
  const st = stateOf(uri);
  if (!st.session.spec) return [];

  const at = Range.create(0, 0, 0, 0);
  const lens = (title: string, command: string, args: unknown[] = []): CodeLens => ({
    range: at,
    command: { title, command, arguments: [uri, ...args] },
  });

  if (st.session.phase === "running") {
    return [lens("■ Finish now", CMD_ABORT), lens("↺ Restart", CMD_REPEAT)];
  }

  const out = [
    lens(`⌨ New test (${sizeLabel()})`, CMD_NEW),
    lens("↺ Restart", CMD_REPEAT),
    lens(`⌘ ${options.language === "tr" ? "English" : "Türkçe"}`, CMD_SET_OPTION, [
      "language",
      options.language === "tr" ? "en" : "tr",
    ]),
    lens(`# Numbers ${options.numbers ? "on" : "off"}`, CMD_SET_OPTION, [
      "numbers",
      !options.numbers,
    ]),
    lens(`· Punctuation ${options.punctuation ? "on" : "off"}`, CMD_SET_OPTION, [
      "punctuation",
      !options.punctuation,
    ]),
  ];
  if (st.session.lastReportPath) out.push(lens("▶ Report", CMD_REPORT));
  out.push(lens("▦ Dashboard", CMD_DASHBOARD));
  return out;
});

// ---------------------------------------------------------------------------
// Hover: canlı istatistik
// ---------------------------------------------------------------------------
connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const st = stateOf(doc.uri);

  if (!st.session.spec) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: ["**Typing Practice**", "", "`Ctrl+.` → New test"].join("\n"),
      },
    };
  }

  if (st.session.phase === "finished" && st.lastResult) {
    const r = st.lastResult;
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          "**✔ Test finished**",
          "",
          "| WPM | Raw | Accuracy | Consistency | Time |",
          "|---|---|---|---|---|",
          `| ${r.wpm} | ${r.raw} | ${r.accuracy}% | ${r.consistency}% | ${r.timeSec}s |`,
          "",
          `Characters: ${r.chars.correct} correct · ${r.chars.incorrect} incorrect · ${r.chars.extra} extra · ${r.chars.missed} missed`,
          st.session.lastReportPath ? `\nReport: \`${st.session.lastReportPath}\`` : "",
        ].join("\n"),
      },
    };
  }

  const live = liveSnapshot(st.session, doc.getText());
  const status =
    st.session.phase === "running" ? "⏱ In progress" : "Ready — start typing";
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [
        `**${status}**`,
        "",
        "| WPM | Accuracy | Time | Progress |",
        "|---|---|---|---|",
        `| ${live.wpm} | ${live.accuracy}% | ${live.elapsedSec.toFixed(1)}s | ${live.progress}/${live.totalWords} |`,
        "",
        `Streak ${live.streak} · Corrections ${st.session.corrections} · Errors ${st.session.wrongKeys}${
          live.remainingSec !== null ? ` · ${Math.ceil(live.remainingSec)}s left` : ""
        }`,
      ].join("\n"),
    },
  };
});

// ---------------------------------------------------------------------------
// Kod eylemleri — menü metinleri İngilizce (Zed'in eylem listesi böyle okunuyor).
// Simge olarak yalnızca tek kod noktalı (BMP) karakterler kullanılır: keycap
// dizileri (`#️⃣` = U+0023 U+FE0F U+20E3) Zed'in listesinde çizilmiyor.
// ---------------------------------------------------------------------------
const MODE_LABELS: Record<string, string> = {
  words: "words",
  time: "time",
  chars: "chars",
  quote: "quote",
  custom: "custom",
};
const REPEAT_LABELS: Record<string, string> = {
  unique: "unique",
  window: "window",
  allow: "allow",
};
const QUOTE_LABELS: Record<string, string> = {
  short: "short",
  medium: "medium",
  long: "long",
  any: "any",
};
const LANG_LABELS: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
};

function sizeLabel(): string {
  switch (options.mode) {
    case "time":
      return `${options.duration}s`;
    case "chars":
      return `${options.charCount} chars`;
    case "quote":
      return `${QUOTE_LABELS[options.quoteLength]} quote`;
    default:
      return `${options.wordCount} words`;
  }
}

function sizeChoices(): { label: string; key: keyof Options; value: number | string }[] {
  switch (options.mode) {
    case "time":
      return [15, 30, 60, 120].map((v) => ({
        label: `${v} seconds`,
        key: "duration" as const,
        value: v,
      }));
    case "chars":
      return [100, 200, 400, 800].map((v) => ({
        label: `${v} characters`,
        key: "charCount" as const,
        value: v,
      }));
    case "quote":
      return (["short", "medium", "long"] as const).map((v) => ({
        label: `${QUOTE_LABELS[v]} quote`,
        key: "quoteLength" as const,
        value: v,
      }));
    default:
      return [10, 25, 50, 100].map((v) => ({
        label: `${v} words`,
        key: "wordCount" as const,
        value: v,
      }));
  }
}

const NEXT_MODE: Record<string, string> = {
  words: "time",
  time: "chars",
  chars: "quote",
  quote: "words",
  custom: "words",
};
const NEXT_REPEAT: Record<string, string> = {
  unique: "window",
  window: "allow",
  allow: "unique",
};

connection.onCodeAction((params): CodeAction[] => {
  const uri = params.textDocument.uri;
  const doc = documents.get(uri);
  const st = stateOf(uri);
  const actions: CodeAction[] = [];
  const add = (title: string, command: string, args: unknown[] = []) =>
    actions.push({
      title,
      kind: CodeActionKind.QuickFix,
      command: { title, command, arguments: [uri, ...args] },
    });
  const toggle = (icon: string, name: string, key: keyof Options) => {
    const on = options[key] === true;
    add(`${icon} ${name}: ${on ? "on → off" : "off → on"}`, CMD_SET_OPTION, [key, !on]);
  };

  if (st.session.phase === "running") {
    add(`⌨ New test (${sizeLabel()} · ${options.language})`, CMD_NEW);
    add("↺ Restart same test", CMD_REPEAT);
    add("■ Finish now", CMD_ABORT);
    return actions;
  }

  add(`⌨ New test (${sizeLabel()} · ${options.language})`, CMD_NEW);
  if (st.session.spec) add("↺ Restart same test", CMD_REPEAT);
  add(
    `⌘ Language: ${LANG_LABELS[options.language]} → ${LANG_LABELS[options.language === "tr" ? "en" : "tr"]}`,
    CMD_SET_OPTION,
    ["language", options.language === "tr" ? "en" : "tr"],
  );
  add(
    `◎ Mode: ${MODE_LABELS[options.mode]} → ${MODE_LABELS[NEXT_MODE[options.mode]]}`,
    CMD_SET_OPTION,
    ["mode", NEXT_MODE[options.mode]],
  );
  for (const choice of sizeChoices()) {
    add(`▤ Size: ${choice.label}`, CMD_SET_OPTION, [choice.key, choice.value]);
  }
  toggle("#", "Numbers", "numbers");
  toggle("❝", "Quotes", "quotes");
  toggle("·", "Punctuation", "punctuation");
  toggle("✳", "Symbols", "symbols");
  toggle("Aa", "Capitalization", "capitalize");
  add(
    `♻ Repeat: ${REPEAT_LABELS[options.repeat]}(${options.repeatWindow}) → ${REPEAT_LABELS[NEXT_REPEAT[options.repeat]]}`,
    CMD_SET_OPTION,
    ["repeat", NEXT_REPEAT[options.repeat]],
  );
  toggle("◍", "Blind mode", "blind");

  if (doc && doc.getText().trim() !== "" && st.session.phase !== "finished") {
    add("▣ Use this text as the test", CMD_USE_TEXT);
  }
  if (st.session.lastReportPath) add("▶ Open last report", CMD_REPORT);
  add("▦ Open stats dashboard", CMD_DASHBOARD);
  add("⟲ Reset preferences (back to settings.json)", CMD_RESET_PREFS);
  return actions;
});

// ---------------------------------------------------------------------------
// Komutlar
// ---------------------------------------------------------------------------
connection.onExecuteCommand(async (params) => {
  const args = (params.arguments ?? []) as unknown[];
  const uri = typeof args[0] === "string" ? args[0] : "";
  const doc = uri ? documents.get(uri) : undefined;
  if (!doc) return;
  const st = stateOf(uri);

  switch (params.command) {
    case CMD_NEW: {
      const lang = args[1];
      if (lang === "tr" || lang === "en") options.language = lang as Lang;
      await startTest(doc, generate(options));
      return;
    }
    case CMD_REPEAT: {
      if (!st.session.spec) return;
      await startTest(doc, st.session.spec);
      return;
    }
    case CMD_USE_TEXT: {
      const lines = toTargetLines(doc.getText());
      if (lines.length === 0) return;
      const spec = fromText(doc.getText(), options);
      await startTest(doc, spec);
      return;
    }
    case CMD_SET_OPTION: {
      const key = args[1];
      const value = args[2];
      if (typeof key !== "string" || !(key in SETTABLE_KEYS)) return;
      const typedKey = key as keyof Options;
      const next = sanitize({ ...options, [typedKey]: value }, DEFAULTS);
      options = next;
      savePref(typedKey, next[typedKey]);
      if (VIEW_ONLY_KEYS[key]) {
        st.cache.reset();
        publish(uri);
        refreshLenses();
      } else {
        await startTest(doc, generate(options));
      }
      return;
    }
    case CMD_ABORT: {
      await finishTest(uri, "abort");
      return;
    }
    case CMD_REPORT: {
      if (st.session.lastReportPath) openInBrowser(st.session.lastReportPath);
      return;
    }
    case CMD_DASHBOARD: {
      const path = writeReport(
        renderDashboard(history.read(), options),
        "dashboard.html",
      );
      if (path) openInBrowser(path);
      return;
    }
    case CMD_RESET_PREFS: {
      clearPrefs();
      options = loadOptions(settingsPayload);
      await startTest(doc, generate(options));
      return;
    }
    default:
      return;
  }
});

documents.listen(connection);
connection.listen();
