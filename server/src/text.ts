/** Metin yardımcıları — sunucu, oturum ve render ortak kullanır. */

/** Bundan uzun tek seferlik eklemeler yapıştırma sayılır, doğruluğa katılmaz. */
export const PASTE_THRESHOLD = 8;

export function splitLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

export function indentOf(s: string): number {
  return s.length - s.trimStart().length;
}

/**
 * Yazılan "son" satır. Dosyanın sonunda tuttuğumuz boş satırları saymaz:
 * Zed, dosyanın en sonundaki konuma konan inlay hint'i göstermiyor, o yüzden
 * her zaman altta boş satır bırakıyoruz.
 */
export function currentLine(typed: readonly string[]): number {
  let i = typed.length - 1;
  while (i > 0 && typed[i].trim() === "") i--;
  return i;
}

/** Herhangi bir metni hedef satırlara çevirir: tab→boşluk, girinti ve boş satırlar atılır. */
export function toTargetLines(text: string): string[] {
  return splitLines(text)
    .map((l) => l.replace(/\t/g, "    ").trim())
    .filter((l) => l.length > 0);
}

/** Token'ları `width`'i aşmayan satırlara böler; token asla bölünmez. */
export function wrapTokens(tokens: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (line === "") {
      line = token;
      continue;
    }
    if (line.length + 1 + token.length <= width) {
      line += ` ${token}`;
    } else {
      lines.push(line);
      line = token;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Etiketi `max` karaktere kırpar (Zed uzun hint/diagnostic metnini kesiyor). */
export function clampLabel(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, Math.max(0, max - 1))}…`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
