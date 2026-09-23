// Kelime havuzu paketinin giriş noktası: dil/uzunluğa göre kelime ve alıntı
// havuzu sağlar, sonuçları önbelleğe alır. Diğer modüller yalnızca bu dosyayı
// (ve `types.ts` üzerinden yeniden dışa aktarılan tipleri) kullanmalıdır.

import type { Lang, Quote, QuoteLength } from "./types";
import { WORDS as TR_WORDS } from "./tr";
import { WORDS as EN_WORDS } from "./en";
import { QUOTES } from "./quotes";

export type { Lang, QuoteLength, Quote };

const WORD_LISTS: Record<Lang, readonly string[]> = {
  tr: TR_WORDS,
  en: EN_WORDS,
};

const POOL_CACHE = new Map<string, readonly string[]>();

/** `lang` diline ait, uzunluğu [min, max] aralığında olan kelimeleri döndürür. */
export function wordPool(lang: Lang, min: number, max: number): readonly string[] {
  const key = `${lang}:${min}:${max}`;
  const cached = POOL_CACHE.get(key);
  if (cached) return cached;

  const list = WORD_LISTS[lang];
  const filtered = list.filter((w) => w.length >= min && w.length <= max);
  // Filtre hiçbir şey döndürmezse boş havuz yerine tüm listeye düş.
  const pool = filtered.length > 0 ? filtered : list;
  POOL_CACHE.set(key, pool);
  return pool;
}

function bucketOf(textLength: number): "short" | "medium" | "long" {
  if (textLength <= 120) return "short";
  if (textLength <= 300) return "medium";
  return "long";
}

/** `lang` diline ve `length` kovasına ait alıntıları döndürür. */
export function quotePool(lang: Lang, length: QuoteLength): readonly Quote[] {
  const forLang = QUOTES.filter((q) => q.lang === lang);
  if (length === "any") return forLang;

  const bucketed = forLang.filter((q) => bucketOf(q.text.length) === length);
  // Kova boşsa dilin tüm alıntılarına düş.
  return bucketed.length > 0 ? bucketed : forLang;
}
