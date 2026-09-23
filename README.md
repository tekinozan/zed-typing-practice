# Typing Practice — a Monkeytype-style typing test for Zed

Open a `.typing` file and the test starts. The unwritten target text appears as
multi-line faint ghost text, errors are underlined in red, and the line under
the cursor shows a live `wpm · acc · progress` readout. When the test ends, an
ASCII result card is printed into the buffer and a single-file HTML report
(SVG chart, keyboard-shaped key heatmap, keystroke replay) opens in the browser.
The heatmap is drawn in a US QWERTY or Turkish-Q layout depending on the test
language; capital letters fold onto their own physical key (`Ş`→`ş`, and in
Turkish `I`→`ı`, `İ`→`i`), and punctuation/symbol keys sit in a separate bottom
row because their physical position is layout-dependent.

## Install (developer mode)

Requirements: Node.js and Rust installed via rustup (needed to build the Zed dev extension).

```bash
# 1) Build the language server and add it to PATH
cd server
npm install
npm run build
npm link            # → the `typing-lsp` command is now on PATH

# 2) In Zed: command palette → "zed: install dev extension" → select this folder (zed-typing-practice)
```

## Required Zed settings (settings.json)

The default display mode is **inlay hint**; if `inlay_hints.enabled` is off, the target text won't show up.

```json
{
  "languages": {
    "Typing": {
      "soft_wrap": "editor_width",
      "use_autoclose": false,
      "show_completions_on_input": false,
      "show_edit_predictions": false,
      "format_on_save": "off",
      "remove_trailing_whitespace_on_save": false,
      "inlay_hints": {
        "enabled": true,
        "edit_debounce_ms": 0,
        "scroll_debounce_ms": 0
      }
    }
  },
  "lsp": {
    "typing-lsp": {
      "initialization_options": {
        "language": "tr",
        "mode": "words",
        "wordCount": 25
      }
    }
  }
}
```

- `inlay_hints.enabled: true` — **mandatory**. The ghost text is drawn with this.
  If it's off, or your Zed build doesn't render hints on blank lines, none of
  the target text will show up; switch to `display: "diagnostic"` (or
  `"both"`) instead — the same ghosts are then published as `Hint`-level
  inline diagnostics. `previewLines: 0` does **not** fix this: the status
  line and the active-line hint still land on blank lines.
- `edit_debounce_ms: 0` — without this, the grey text updates late after each keystroke.
- `use_autoclose: false` — auto-closing brackets/quotes would break the test.

The default language is **English**; the example above switches it to Turkish.

### Using diagnostic mode

With `display: "diagnostic"` or `"both"` the ghost text is also published as an
inline diagnostic. Zed disables inline diagnostics by default, so one setting is
required:

```json
{
  "diagnostics": {
    "inline": { "enabled": true }
  }
}
```

`diagnostics.inline.max_severity` defaults to `null`, which inherits
`editor.diagnostics_max_severity` (default `"all"`), so `Hint`-severity ghosts
render once inline diagnostics are on. Set it explicitly only if you have
narrowed the severity elsewhere:

```json
{ "diagnostics": { "inline": { "enabled": true, "max_severity": "hint" } } }
```

Inline diagnostic text is clipped by the viewport rather than by a fixed
character limit, so labels are clamped to 78 characters to stay readable.

## Usage

- Open an empty `practice.typing` file → the test starts automatically.
- A clickable toolbar is rendered above the first line (`⌨ New test`, `↺ Restart`,
  language and flag toggles, `▦ Dashboard`). It switches to `■ Finish now` /
  `↺ Restart` once you start typing. Turn it off with `codeLens: false`.
- Type. The blank lines under the cursor show the upcoming target lines and the
  live status. Before the first keystroke that line reads
  `Start typing · 25 words · en · Ctrl+. → options`; afterwards it becomes
  `wpm 62 · acc 97% · ███████░░░ 17/25 · 18s`, where the bar tracks words,
  characters or remaining time depending on the mode.
- Hover → WPM, raw speed, accuracy, time, progress, streak, corrections, errors, remaining time.
- `Ctrl+.` / `Cmd+.` → code actions (menu is in English):

| Action | Description |
|---|---|
| `⌨ New test` | Generates new text with the current settings |
| `↺ Restart same test` | Retypes the same text from the start |
| `⌘ Language` | English ⇄ Türkçe |
| `◎ Mode` | words → time → chars → quote |
| `▤ Size: …` | Size per mode: 10/25/50/100 words · 15/30/60/120 seconds · 100/200/400/800 characters · short/medium/long quote |
| `# Numbers` · `❝ Quotes` · `· Punctuation` · `✳ Symbols` · `Aa Capitalization` | Toggles generation add-ons |
| `♻ Repeat` | unique → window → allow |
| `◍ Blind mode` | Errors stay unmarked until the test ends |
| `■ Finish now` | Cuts a running test short (not written to history) |
| `▣ Use this text as the test` | Uses the buffer's current text as the target |
| `▶ Open last report` · `▦ Open stats dashboard` | Opens the HTML reports in the browser |
| `⟲ Reset preferences` | Deletes `prefs.json`, falling back to `settings.json` |

Menu icons are single-code-point (BMP) characters: Zed's action list does not
render keycap sequences such as `#️⃣` (U+FE0F U+20E3).

Any option changed through a code action is written to `prefs.json` and
survives a Zed restart. Precedence: defaults < `settings.json` < `prefs.json`.

Indentation is not compared in code mode (so Zed's auto-indent doesn't
penalize you). One-off insertions longer than 8 characters count as a paste
and are excluded from accuracy. Pauses longer than 5 seconds are reported as "afk".

**The test ends when the character target is reached — you are never asked to
fix a mistake.** Even if you leave a wrong letter in place, the test closes
once the last word is typed; the result card and report show "Completed: No",
and accuracy and the wrong-character count reflect it. The measure is **total
characters**, not per-line: accidentally pressing Enter mid-line and shifting
the lines, or never pressing Enter at all, will not lock up the test. Extra
whitespace beyond the indentation counts as "extra characters" but does not
lock the test either.

## Options

All of these are set under `lsp.typing-lsp.initialization_options`, or via code actions.

| Key | Default | Range / values |
|---|---|---|
| `language` | `"en"` | `tr`, `en` |
| `mode` | `"words"` | `words`, `time`, `chars`, `quote`, `custom` |
| `wordCount` | `25` | 5–500 |
| `duration` | `30` | 5–600 s (`mode: "time"`) |
| `charCount` | `200` | 20–5000 (`mode: "chars"`) |
| `quoteLength` | `"medium"` | `short` ≤120, `medium` ≤300, `long` >300, `any` |
| `punctuation` | `false` | splits into sentences, adds `. ? ! , ; :` |
| `numbers` | `false` | 15% chance of a 1–4 digit number |
| `quotes` | `false` | wraps 1–3 tokens in `"…"` |
| `symbols` | `false` | wraps with `() [] {} <>` or appends `/ & % # @ * + = _ ~ ^ $` |
| `capitalize` | `false` | 15% chance the first letter is capitalized (locale-aware) |
| `repeat` | `"window"` | `unique`, `window`, `allow` |
| `repeatWindow` | `4` | 1–50 |
| `minWordLength` / `maxWordLength` | `1` / `20` | 1–20 / 1–40 |
| `lineWidth` | `52` | 24–80 |
| `previewLines` | `2` | 0–6 preview lines |
| `display` | `"inlay"` | `inlay`, `diagnostic`, `both` |
| `blind` | `false` | errors hidden until the test ends |
| `liveStats` | `true` | live status line |
| `liveIntervalMs` | `500` | 100–2000 |
| `resultCard` | `true` | ASCII card printed into the buffer at the end |
| `htmlReport` | `true` | generate the HTML report |
| `openReport` | `true` | open the report in the browser |
| `reportTheme` | `"dark"` | `dark`, `light` |
| `replay` | `true` | keystroke replay in the report |
| `codeLens` | `true` | clickable toolbar rendered above the first line |
| `history` | `true` | write to `history.jsonl` |
| `seed` | `null` | a number makes the test reproducible |
| `customText` | `null` | target text for `mode: "custom"` |

## Data and report directory

| Platform | Directory |
|---|---|
| Windows | `%APPDATA%\zed-typing-practice` |
| macOS | `~/Library/Application Support/zed-typing-practice` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/zed-typing-practice` |

Contents: `prefs.json` (in-editor preferences), `history.jsonl` (test history),
`reports/result-<date>.html` and `reports/dashboard.html`.

The `TYPING_LSP_DATA_DIR` environment variable overrides this directory (the
test suite uses it). If the directory is not writable, writing preferences,
history, and reports is silently skipped; the test and live stats are unaffected.

## Development

```bash
cd server
npm run build     # tsc
npm test          # build + node --test test/
```

The test suite covers: word pool rules, generator determinism, metric
formulas, HTML escaping, per-keystroke render cost (< 2 ms), and the
end-to-end LSP flow via `node dist/server.js --stdio` (empty file → test →
typing → result card → report → history line).

## Layout

```
extension.toml            extension manifest + language server registration
Cargo.toml, src/lib.rs    Zed extension (Rust → WASM): locates and starts the server
languages/typing/         language definition for .typing files
server/src/
  server.ts               LSP wiring (initialize, events, commands, timers)
  options.ts              option schema, validation, prefs.json persistence
  words/                  tr/en word pools and quotes
  generate.ts             test text generator (deterministic)
  session.ts              keystroke engine (diff, counters, second buckets)
  metrics.ts              wpm/raw/accuracy/consistency, word and key stats
  history.ts              history.jsonl and personal records
  report.ts               single-file HTML report and dashboard
  render.ts               ghost text, diagnostics, status line, result card
  paths.ts, rng.ts, text.ts  data directory, deterministic RNG, text helpers
```

The server is looked up in this order: the `lsp.typing-lsp.binary.path`
setting → `typing-lsp` on PATH → the `zed-typing-lsp` npm package (installed
automatically if you publish it).
