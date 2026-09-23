import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TextDocument } = require("vscode-languageserver-textdocument");
const { Session } = require("../dist/session.js");
const { RenderCache, renderFrame } = require("../dist/render.js");
const { fromText } = require("../dist/generate.js");
const { DEFAULTS } = require("../dist/options.js");

/** 100 satırlık hedef metinde tuş başına maliyet regresyon koruması. */
test("5.000 tuş vuruşunda ingest + renderFrame < 2 ms/tuş", () => {
  const source = Array.from(
    { length: 100 },
    (_, i) => `satir ${i} kelime kelime kelime kelime kelime kelime`,
  ).join("\n");
  const opts = { ...DEFAULTS, previewLines: 2, lineWidth: 52 };
  const spec = fromText(source, opts);
  assert.ok(spec.lines.length >= 100, `satır sayısı ${spec.lines.length}`);

  const uri = "mem://perf.typing";
  const session = new Session(uri);
  const cache = new RenderCache();
  const blank = "\n".repeat(opts.previewLines + 2);
  session.start(spec);
  session.prevText = blank;

  let doc = TextDocument.create(uri, "typing", 1, blank);
  let version = 1;
  let line = 0;
  let col = 0;
  let elapsed = 0;
  let strokes = 0;
  const now = () => 1_000_000 + strokes * 60;

  while (strokes < 5000 && line < spec.lines.length) {
    const goal = spec.lines[line];
    const ch = col < goal.length ? goal[col] : "\n";
    const pos = { line, character: col };
    TextDocument.update(doc, [{ range: { start: pos, end: pos }, text: ch }], ++version);

    const text = doc.getText();
    const t0 = process.hrtime.bigint();
    session.ingest(doc, text, now());
    renderFrame(session, doc, opts, cache);
    elapsed += Number(process.hrtime.bigint() - t0);
    strokes++;

    if (ch === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }

  const msPerKey = elapsed / 1e6 / strokes;
  assert.ok(strokes >= 5000, `yalnızca ${strokes} tuş simüle edildi`);
  assert.ok(msPerKey < 2, `tuş başına ${msPerKey.toFixed(3)} ms (sınır 2 ms)`);
});
