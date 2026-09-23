import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { LspClient } from "./lsp-client.mjs";

const require = createRequire(import.meta.url);
const { generate } = require("../dist/generate.js");
// `sanitize` kullanılır, `loadOptions` DEĞİL: `loadOptions` çalıştıran makinenin
// gerçek `prefs.json`'unu okur ve testi ortama bağımlı hale getirirdi. Sunucu
// çocuğu her testte boş bir TYPING_LSP_DATA_DIR aldığı için prefs katmanı boştur,
// yani `sanitize(initializationOptions)` sunucunun gördüğü seçeneklerin aynısıdır.
const { sanitize } = require("../dist/options.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "..", "dist", "server.js");

const INIT_OPTIONS = {
  language: "tr",
  mode: "words",
  wordCount: 8,
  repeat: "unique",
  previewLines: 1,
  display: "inlay",
  liveStats: false,
  resultCard: true,
  htmlReport: true,
  openReport: false,
  history: true,
  seed: 987654,
};

test("uçtan uca: boş dosya → test → yazma → sonuç kartı → rapor → geçmiş", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const init = await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: { workspace: { inlayHint: { refreshSupport: true } } },
    initializationOptions: INIT_OPTIONS,
  });
  assert.equal(init.result.serverInfo.name, "typing-lsp");
  assert.ok(init.result.capabilities.executeCommandProvider.commands.includes("typing.newTest"));
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "pratik.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };

  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  // 1) Sunucu tamponu boş satırlarla dolduran applyEdit gönderir.
  const edit = await client.takeRequest("workspace/applyEdit");
  const change = edit.params.edit.changes[uri][0];
  assert.equal(change.newText, "\n".repeat(INIT_OPTIONS.previewLines + 2));
  text = change.newText;
  client.respond(edit.id, { applied: true });
  sync();

  // Hedef metin: sunucuyla aynı seçenek ve seed → aynı üretim.
  const spec = generate(sanitize(INIT_OPTIONS));
  assert.equal(spec.meta.words, 8);

  // 2) Hedefi karakter karakter yaz: hiç hata diagnostic'i yayınlanmaz.
  // Tuşlar 2 saniyeden uzun bir aralığa yayılır: saniye kovaları dolsun,
  // rapor gerçek SVG grafiğini üretsin (afk eşiği 5 sn, tetiklenmez).
  const buffer = text.split("\n");
  const totalChars = spec.lines.reduce((n, l) => n + l.length, 0);
  const perKeyMs = Math.ceil(2400 / totalChars);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cursor = 0;
  for (let i = 0; i < spec.lines.length; i++) {
    for (const ch of spec.lines[i]) {
      buffer[cursor] += ch;
      text = buffer.join("\n");
      sync();
      await sleep(perKeyMs);
    }
    if (i < spec.lines.length - 1) {
      buffer.splice(cursor + 1, 0, "");
      cursor++;
      text = buffer.join("\n");
      sync();
      await sleep(perKeyMs);
    }
  }

  await client.until(
    () => client.lastDiagnostics(uri) !== undefined,
    "ilk publishDiagnostics",
  );
  const errorsWhileClean = (client.lastDiagnostics(uri) ?? []).filter((d) => d.severity === 1);
  assert.deepEqual(errorsWhileClean, [], "doğru yazarken hata diagnostic'i yayınlandı");

  // 4) Test tamamlandı: sonuç kartını yazan applyEdit gelir.
  const cardEdit = await client.takeRequest("workspace/applyEdit", 10000);
  const card = cardEdit.params.edit.changes[uri][0].newText;
  assert.match(card, /WPM/);
  assert.match(card, /TYPING PRACTICE — RESULT/);
  // Kart iskeleti tamamen İngilizce; hedef kelimeler kullanıcı verisi olduğu
  // için Türkçe kalabilir, o yüzden etiketler tek tek kontrol edilir.
  for (const label of [
    "Accuracy",
    "Consistency",
    "Time",
    "AFK",
    "Chars",
    "ok/bad/extra/missed",
    "Corrections",
    "Longest streak",
    "Record",
    "Report",
    "Ctrl+. -> new test · restart · report · dashboard",
  ]) {
    assert.ok(card.includes(label), `kartta "${label}" yok:\n${card}`);
  }
  for (const old of ["Dogruluk", "Sure", "Karakter", "Duzeltme", "Rekor", "Rapor", "SONUC"]) {
    assert.ok(!card.includes(old), `kartta Türkçe etiket kaldı: ${old}`);
  }
  client.respond(cardEdit.id, { applied: true });
  text = card;
  sync();

  // 5) HTML raporu diske yazıldı (tarayıcı açılmadı).
  const reports = fs.readdirSync(path.join(dataDir, "reports"));
  const result = reports.find((f) => /^result-.*\.html$/.test(f));
  assert.ok(result, `rapor bulunamadı: ${reports.join(", ")}`);
  const html = fs.readFileSync(path.join(dataDir, "reports", result), "utf8");
  assert.match(html, /<svg/);
  assert.ok(html.trimEnd().endsWith("</html>"));

  // 6) history.jsonl tek satır ve wpm sayısal.
  const jsonl = fs.readFileSync(path.join(dataDir, "history.jsonl"), "utf8").trim();
  assert.equal(jsonl.split("\n").length, 1);
  const row = JSON.parse(jsonl);
  assert.equal(typeof row.wpm, "number");
  assert.equal(row.v, 1);
  assert.equal(row.complete, true);
  assert.equal(row.mode, "words");
});

test("uçtan uca: yanlış karakter hata diagnostic'i üretir, düzeltilince kaybolur", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-err-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: { ...INIT_OPTIONS, htmlReport: false, history: false },
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "hata.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const edit = await client.takeRequest("workspace/applyEdit");
  text = edit.params.edit.changes[uri][0].newText;
  client.respond(edit.id, { applied: true });
  sync();

  const spec = generate(sanitize({ ...INIT_OPTIONS, htmlReport: false, history: false }));
  const goal = spec.lines[0];
  const wrong = goal[0] === "z" ? "q" : "z";

  client.clearNotifications();
  text = wrong + text;
  sync();
  const diags = await client.until(
    () => {
      const d = client.lastDiagnostics(uri);
      return d && d.some((x) => x.severity === 1) ? d : false;
    },
    "hata diagnostic'i",
  );
  const err = diags.find((d) => d.severity === 1);
  assert.equal(err.source, "typing");
  assert.match(err.message, /^Expected: "/);

  client.clearNotifications();
  text = goal[0] + text.slice(1);
  sync();
  await client.until(
    () => {
      const d = client.lastDiagnostics(uri);
      return d !== undefined && d.every((x) => x.severity !== 1);
    },
    "hata diagnostic'inin kaybolması",
  );
});

test("uçtan uca: kod eylemleri, setOption kalıcılığı ve abort", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-cmd-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: { ...INIT_OPTIONS, htmlReport: false, openReport: false },
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "komut.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const first = await client.takeRequest("workspace/applyEdit");
  text = first.params.edit.changes[uri][0].newText;
  client.respond(first.id, { applied: true });
  sync();

  const titlesOf = async () => {
    const res = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: { diagnostics: [] },
    });
    return res.result.map((a) => a.title);
  };

  const before = await titlesOf();
  assert.ok(before.some((x) => x.startsWith("⌨ New test")), before.join(" | "));
  assert.ok(before.includes("# Numbers: off → on"), before.join(" | "));
  assert.ok(before.includes("▦ Open stats dashboard"));
  assert.ok(before.includes("▤ Size: 10 words"), before.join(" | "));
  // Menüde keycap dizisi (U+FE0F U+20E3) bulunmamalı: Zed listesinde çizilmiyor.
  assert.ok(
    before.every((x) => !/[\uFE0F\u20E3]/.test(x)),
    `keycap/variation selector sızdı: ${before.join(" | ")}`,
  );
  // Menü tamamen İngilizce: Türkçe'ye özgü harf yalnızca dil adında olabilir.
  assert.ok(
    before.every((x) => !/[çğıöşÇĞİÖŞÜ]/.test(x.replace("Türkçe", ""))),
    `menüde Türkçe metin: ${before.join(" | ")}`,
  );

  // Tampon boşken yeni test üretimi no-op edit olur; önce bir karakter yaz ki
  // sunucunun tamponu gerçekten sıfırladığını applyEdit ile görelim.
  const typeOne = () => {
    text = `x${text}`;
    sync();
  };

  // setOption → prefs.json'a yazılır ve yeni test üretilir.
  typeOne();
  const pending = client.request("workspace/executeCommand", {
    command: "typing.setOption",
    arguments: [uri, "numbers", true],
  });
  const regen = await client.takeRequest("workspace/applyEdit");
  text = regen.params.edit.changes[uri][0].newText;
  assert.equal(text, "\n".repeat(INIT_OPTIONS.previewLines + 2));
  client.respond(regen.id, { applied: true });
  sync();
  await pending;

  const prefs = JSON.parse(fs.readFileSync(path.join(dataDir, "prefs.json"), "utf8"));
  assert.equal(prefs.numbers, true);
  const after = await titlesOf();
  assert.ok(after.includes("# Numbers: on → off"), after.join(" | "));

  // Öncelik kuralı: yeni settings.json yükü gelse bile prefs.json kazanır.
  client.notify("workspace/didChangeConfiguration", {
    settings: { "typing-lsp": { ...INIT_OPTIONS, numbers: false, wordCount: 30 } },
  });
  const merged = await titlesOf();
  assert.ok(merged.includes("# Numbers: on → off"), merged.join(" | "));
  assert.ok(
    merged.some((x) => x.startsWith("⌨ New test (30 words")),
    merged.join(" | "),
  );

  // ⟲ Tercihleri sıfırla → prefs.json silinir, settings.json değerine dönülür.
  typeOne();
  const resetting = client.request("workspace/executeCommand", {
    command: "typing.resetPrefs",
    arguments: [uri],
  });
  const resetEdit = await client.takeRequest("workspace/applyEdit");
  text = resetEdit.params.edit.changes[uri][0].newText;
  client.respond(resetEdit.id, { applied: true });
  sync();
  await resetting;
  assert.equal(fs.existsSync(path.join(dataDir, "prefs.json")), false);
  const reset = await titlesOf();
  assert.ok(reset.includes("# Numbers: off → on"), reset.join(" | "));

  // Yazmaya başla, sonra abort: geçmişe yazılmaz.
  typeOne();
  await client.until(() => client.lastDiagnostics(uri) !== undefined, "ilk yayın");

  const aborting = client.request("workspace/executeCommand", {
    command: "typing.abort",
    arguments: [uri],
  });
  const cardEdit = await client.takeRequest("workspace/applyEdit");
  assert.match(cardEdit.params.edit.changes[uri][0].newText, /TYPING PRACTICE/);
  client.respond(cardEdit.id, { applied: true });
  await aborting;

  assert.equal(
    fs.existsSync(path.join(dataDir, "history.jsonl")),
    false,
    "abort edilen test geçmişe yazıldı",
  );
});

test("uçtan uca: zaman modu süre dolunca kendiliğinden biter", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-time-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const timeOptions = {
    ...INIT_OPTIONS,
    mode: "time",
    duration: 5,
    htmlReport: false,
    liveStats: false,
  };
  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: timeOptions,
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "zaman.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const first = await client.takeRequest("workspace/applyEdit");
  text = first.params.edit.changes[uri][0].newText;
  client.respond(first.id, { applied: true });
  sync();

  const spec = generate(sanitize(timeOptions));
  assert.equal(spec.meta.durationSec, 5);

  // Birkaç karakter yaz: geri sayım ilk tuşla başlar.
  const lines = text.split("\n");
  for (const ch of spec.lines[0].slice(0, 5)) {
    lines[0] += ch;
    text = lines.join("\n");
    sync();
    await new Promise((r) => setTimeout(r, 60));
  }

  // 5 saniye sonra sunucu testi kendiliğinden bitirir.
  const cardEdit = await client.takeRequest("workspace/applyEdit", 15000);
  assert.match(cardEdit.params.edit.changes[uri][0].newText, /TYPING PRACTICE/);
  client.respond(cardEdit.id, { applied: true });
  text = cardEdit.params.edit.changes[uri][0].newText;
  sync();

  const row = JSON.parse(
    fs.readFileSync(path.join(dataDir, "history.jsonl"), "utf8").trim(),
  );
  assert.equal(row.mode, "time");
  assert.equal(row.size, "5");
  assert.equal(row.complete, false, "süre dolmadan tamamlanmış görünüyor");
  assert.ok(row.timeSec >= 4.5 && row.timeSec <= 8, `timeSec ${row.timeSec}`);
});

test("uçtan uca: inlay hint yerleşimi — kalan metin, önizleme ve durum satırı", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-hint-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const hintOptions = {
    ...INIT_OPTIONS,
    wordCount: 30,
    lineWidth: 24,
    previewLines: 1,
    liveStats: true,
    display: "inlay",
    htmlReport: false,
    history: false,
  };
  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: hintOptions,
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "hint.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const edit = await client.takeRequest("workspace/applyEdit");
  text = edit.params.edit.changes[uri][0].newText;
  assert.equal(text, "\n\n\n", "previewLines=1 → 4 boş satır");
  client.respond(edit.id, { applied: true });
  sync();

  const spec = generate(sanitize(hintOptions));
  assert.ok(spec.lines.length >= 3, `satır sayısı ${spec.lines.length}`);

  // Test başlamadan: satır 0'da tam hedef, satır 1'de önizleme.
  const idle = await client.request("textDocument/inlayHint", {
    textDocument: { uri },
    range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
  });
  const idleHints = idle.result.map((h) => [h.position.line, h.position.character, h.label]);
  assert.deepEqual(idleHints[0], [0, 0, spec.lines[0]], JSON.stringify(idleHints));
  assert.deepEqual(idleHints[1], [1, 0, spec.lines[1]], JSON.stringify(idleHints));
  // Test başlamadan durum satırı canlı sayaç yerine yönlendirme gösterir.
  const idleStatus = idleHints.find((h) => h[0] === 2);
  assert.ok(idleStatus, `yönlendirme satırı yok: ${JSON.stringify(idleHints)}`);
  assert.equal(idleStatus[1], 0);
  assert.equal(idleStatus[2], "Start typing · 30 words · tr · Ctrl+. → options");
  assert.ok(idleStatus[2].length <= 78);

  // İlk satırın 3 karakterini yaz.
  const typedPart = spec.lines[0].slice(0, 3);
  text = `${typedPart}\n\n\n`;
  sync();
  await client.until(() => client.lastDiagnostics(uri) !== undefined, "ilk yayın");

  const res = await client.request("textDocument/inlayHint", {
    textDocument: { uri },
    range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
  });
  const hints = res.result.map((h) => [h.position.line, h.position.character, h.label]);

  // 1) Aktif satırın sonunda hedefin yazılmamış kalanı — araya boşluk konmadan.
  const remainder = hints.find((h) => h[0] === 0);
  assert.deepEqual(
    remainder,
    [0, 3, spec.lines[0].slice(3)],
    `aktif satır ipucu yanlış: ${JSON.stringify(hints)}`,
  );

  // 2) Altındaki boş satırda bir sonraki hedef satırın önizlemesi.
  const preview = hints.find((h) => h[0] === 1);
  assert.deepEqual(preview, [1, 0, spec.lines[1]], JSON.stringify(hints));

  // 3) previewLines+1 aşağıda canlı durum satırı: ilerleme çubuğu + sayaçlar.
  const status = hints.find((h) => h[0] === 2);
  assert.ok(status, `durum satırı yok: ${JSON.stringify(hints)}`);
  assert.equal(status[1], 0);
  assert.match(status[2], /^wpm \d+ · acc \d+% · [█░]{10} \d+\/30 · \d+s$/, status[2]);
  // Çubuk 10 hücre; henüz 3 karakter yazıldı, yani hiç dolmamalı.
  const bar = /[█░]{10}/.exec(status[2])[0];
  assert.equal(bar.length, 10);
  assert.equal(bar, "░".repeat(10), `çubuk erken doldu: ${bar}`);
  assert.ok(status[2].length <= 78, "durum etiketi 78 karakteri aşıyor");

  // 4) previewLines sınırının ötesinde önizleme yok.
  assert.equal(hints.filter((h) => h[0] >= 3).length, 0, JSON.stringify(hints));

  // display="inlay" iken hayaletler diagnostic olarak yayınlanmaz.
  const diags = client.lastDiagnostics(uri) ?? [];
  assert.equal(diags.filter((d) => d.severity === 4).length, 0, "hayalet diagnostic sızdı");
});

test("uçtan uca: kör modda düzeltilmemiş hatayla da test biter", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-blind-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Kör mod: hata diagnostic'i yayınlanmaz. Eski davranışta düzeltilmemiş tek
  // bir harf testi ekranda hiçbir iz bırakmadan sonsuza dek açık bırakırdı.
  const blindOptions = { ...INIT_OPTIONS, blind: true, htmlReport: false };
  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: blindOptions,
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "kor.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const edit = await client.takeRequest("workspace/applyEdit");
  text = edit.params.edit.changes[uri][0].newText;
  client.respond(edit.id, { applied: true });
  sync();

  const spec = generate(sanitize(blindOptions));
  const buffer = text.split("\n");
  let cursor = 0;
  let swapped = false;

  for (let i = 0; i < spec.lines.length; i++) {
    for (let c = 0; c < spec.lines[i].length; c++) {
      const goalCh = spec.lines[i][c];
      // İlk harfi kasten yanlış yaz ve ASLA düzeltme.
      let ch = goalCh;
      if (!swapped && /[a-zçğıöşü]/.test(goalCh)) {
        ch = goalCh === "z" ? "q" : "z";
        swapped = true;
      }
      buffer[cursor] += ch;
      text = buffer.join("\n");
      sync();
      await new Promise((r) => setTimeout(r, 12));
    }
    if (i < spec.lines.length - 1) {
      buffer.splice(cursor + 1, 0, "");
      cursor++;
      text = buffer.join("\n");
      sync();
    }
  }
  assert.ok(swapped, "kasıtlı hata yazılamadı");

  // Kör modda hiç hata diagnostic'i yayınlanmamalı.
  await client.until(() => client.lastDiagnostics(uri) !== undefined, "ilk yayın");
  assert.equal(
    (client.lastDiagnostics(uri) ?? []).filter((d) => d.severity === 1).length,
    0,
    "kör modda hata diagnostic'i yayınlandı",
  );

  // Yine de hedefin sonuna varınca test biter.
  const cardEdit = await client.takeRequest("workspace/applyEdit", 8000);
  const card = cardEdit.params.edit.changes[uri][0].newText;
  assert.match(card, /TYPING PRACTICE/);
  client.respond(cardEdit.id, { applied: true });
  text = card;
  sync();

  const row = JSON.parse(
    fs.readFileSync(path.join(dataDir, "history.jsonl"), "utf8").trim(),
  );
  assert.equal(row.complete, false, "hatalı yazım tamamlanmış sayıldı");
  assert.ok(row.chars.incorrect >= 1, `yanlış karakter ${row.chars.incorrect}`);
  assert.ok(row.accuracy < 100, `doğruluk ${row.accuracy}`);
  assert.ok(row.flags.includes("blind"), row.flags);
});

test("varsayılan dil İngilizce", () => {
  const { DEFAULTS } = require("../dist/options.js");
  assert.equal(DEFAULTS.language, "en");
  const spec = generate(DEFAULTS, 5150);
  assert.equal(spec.meta.language, "en");
  // İngilizce havuzda Türkçe'ye özgü harf bulunmaz.
  assert.ok(!/[çğıöşü]/.test(spec.lines.join(" ")), spec.lines.join(" "));
});

test("uçtan uca: satır ortasında Enter'a basılsa da test biter", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-enter-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Erken Enter tampon satırlarını kaydırır: hiçbir satır kendi hedefiyle bir
  // daha hizalanmaz. Satır bazlı bitiş ölçüsü burada testi sonsuza kilitlerdi.
  const opts = { ...INIT_OPTIONS, htmlReport: false };
  await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: opts,
  });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "enter.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const edit = await client.takeRequest("workspace/applyEdit");
  text = edit.params.edit.changes[uri][0].newText;
  client.respond(edit.id, { applied: true });
  sync();

  const spec = generate(sanitize(opts));
  const goalChars = spec.lines.reduce((n, l) => n + l.length, 0);
  const stream = spec.lines.join(" ");
  const strayAt = Math.floor(spec.lines[0].length / 2);
  assert.ok(strayAt > 2, `ilk satır çok kısa: ${spec.lines[0]}`);

  const buffer = text.split("\n");
  let cursor = 0;
  for (let i = 0; i < stream.length; i++) {
    if (i === strayAt) {
      // Kazara Enter: bundan sonra hiçbir satır hedefiyle hizalı değil.
      buffer.splice(cursor + 1, 0, "");
      cursor++;
      text = buffer.join("\n");
      sync();
    }
    buffer[cursor] += stream[i];
    text = buffer.join("\n");
    sync();
    await new Promise((r) => setTimeout(r, 8));
  }

  const typedCore = buffer.reduce((n, l) => n + l.trimStart().length, 0);
  assert.ok(typedCore >= goalChars, `yazılan ${typedCore} < hedef ${goalChars}`);

  const cardEdit = await client.takeRequest("workspace/applyEdit", 8000);
  assert.match(cardEdit.params.edit.changes[uri][0].newText, /TYPING PRACTICE/);
  client.respond(cardEdit.id, { applied: true });
  text = cardEdit.params.edit.changes[uri][0].newText;
  sync();

  const row = JSON.parse(
    fs.readFileSync(path.join(dataDir, "history.jsonl"), "utf8").trim(),
  );
  assert.equal(row.complete, false, "kayan satırlar tamamlanmış sayıldı");
  assert.ok(typeof row.wpm === "number");
});

test("uçtan uca: kod merceği araç çubuğu faza göre değişir", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-e2e-lens-"));
  const client = new LspClient(serverPath, { TYPING_LSP_DATA_DIR: dataDir });
  t.after(async () => {
    await client.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const opts = { ...INIT_OPTIONS, htmlReport: false, history: false };
  const init = await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: { workspace: { codeLens: { refreshSupport: true } } },
    initializationOptions: opts,
  });
  // Zed mercekleri satırın üstünde blok olarak çiziyor; sağlayıcı ilan edilmeli.
  assert.deepEqual(init.result.capabilities.codeLensProvider, { resolveProvider: false });
  client.notify("initialized", {});

  const uri = pathToFileURL(path.join(dataDir, "lens.typing")).href;
  let version = 1;
  let text = "";
  const sync = () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: ++version },
      contentChanges: [{ text }],
    });
  };
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typing", version, text },
  });

  const edit = await client.takeRequest("workspace/applyEdit");
  text = edit.params.edit.changes[uri][0].newText;
  client.respond(edit.id, { applied: true });
  sync();

  const lensesOf = async () => {
    const res = await client.request("textDocument/codeLens", { textDocument: { uri } });
    return res.result;
  };

  const ready = await lensesOf();
  const readyTitles = ready.map((l) => l.command.title);
  assert.ok(readyTitles.some((x) => x.startsWith("⌨ New test")), readyTitles.join(" | "));
  assert.ok(readyTitles.includes("▦ Dashboard"), readyTitles.join(" | "));
  assert.ok(readyTitles.includes("# Numbers off"), readyTitles.join(" | "));
  // Hepsi ilk satırın üstüne çapalanır ve çalıştırılabilir bir komut taşır.
  for (const lens of ready) {
    assert.deepEqual(lens.range, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
    assert.ok(init.result.capabilities.executeCommandProvider.commands.includes(lens.command.command));
    assert.equal(lens.command.arguments[0], uri);
  }

  // Yazmaya başlayınca araç çubuğu test kontrollerine döner.
  const spec = generate(sanitize(opts));
  text = spec.lines[0][0] + text;
  sync();
  await client.until(() => client.lastDiagnostics(uri) !== undefined, "ilk yayın");

  const running = (await lensesOf()).map((l) => l.command.title);
  assert.deepEqual(running, ["■ Finish now", "↺ Restart"], running.join(" | "));

  // codeLens: false ile araç çubuğu tamamen kapanır.
  const off = client.request("workspace/executeCommand", {
    command: "typing.setOption",
    arguments: [uri, "codeLens", false],
  });
  await off;
  assert.deepEqual(await lensesOf(), []);
});
