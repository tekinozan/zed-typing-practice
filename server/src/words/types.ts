// Kelime havuzu paketinin paylaşılan tip tanımları.
// Döngüsel bağımlılığı önlemek için Lang/Quote/QuoteLength burada tanımlanır,
// diğer modüller (index.ts dahil) bunları buradan yeniden dışa aktarır.

export type Lang = "tr" | "en";

export type QuoteLength = "short" | "medium" | "long" | "any";

export interface Quote {
  text: string;
  author: string;
  lang: Lang;
}
