/**
 * Veri dizini, rapor yolları ve tarayıcıda açma yardımcıları.
 *
 * Yazma hataları asla test akışını kesmez: sorun yalnızca bir kez loglanır
 * (salt okunur profil, kısıtlı ortam vb.).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DIR = "zed-typing-practice";

let warned = false;

/** Yazma hatalarını tek seferlik uyarıya indirger. */
export function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(`[typing] ${message}`);
}

function platformDataDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), APP_DIR);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR);
  }
  const xdg =
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdg, APP_DIR);
}

export function dataDir(): string {
  const override = process.env.TYPING_LSP_DATA_DIR;
  return override && override.trim() !== "" ? override : platformDataDir();
}

export function reportsDir(): string {
  return path.join(dataDir(), "reports");
}

export function prefsFile(): string {
  return path.join(dataDir(), "prefs.json");
}

export function historyFile(): string {
  return path.join(dataDir(), "history.jsonl");
}

/** Dizini oluşturur; başarısız olursa `false` döner (çağıran yazmayı atlar). */
export function ensureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (err) {
    warnOnce(`could not create data directory (${dir}): ${String(err)}`);
    return false;
  }
}

/** Dizini hazırlayıp dosyayı yazar. Hata yutulur, sonuç `boolean`. */
export function writeFileSafe(file: string, content: string): boolean {
  if (!ensureDir(path.dirname(file))) return false;
  try {
    fs.writeFileSync(file, content, "utf8");
    return true;
  } catch (err) {
    warnOnce(`could not write file (${file}): ${String(err)}`);
    return false;
  }
}

export function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function removeFileSafe(file: string): boolean {
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (err) {
    warnOnce(`could not delete file (${file}): ${String(err)}`);
    return false;
  }
}

/**
 * Raporu sistemin varsayılan tarayıcısında açar.
 * `showDocument` kullanılmaz: Zed `file:` URI'sini editörde açar, HTML kaynağı görünür.
 */
export function openInBrowser(file: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", file], {
            detached: true,
            stdio: "ignore",
            windowsVerbatimArguments: false,
          })
        : process.platform === "darwin"
          ? spawn("open", [file], { detached: true, stdio: "ignore" })
          : spawn("xdg-open", [file], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    warnOnce(`could not open browser: ${String(err)}`);
  }
}
