// Alıntı havuzu: telif riski olmayan atasözü/deyiş (tr) ve kamuya açık
// İngilizce atasözleri (en). Uzunluk kovaları (index.ts:quotePool içinde
// kullanılır): short <= 120, medium 121..300, long > 300 karakter.

import type { Quote } from "./types";

export const QUOTES: readonly Quote[] = [
  { text: "Damlaya damlaya göl olur.", author: "Türk atasözü", lang: "tr" },
  { text: "Ağaç yaşken eğilir.", author: "Türk atasözü", lang: "tr" },
  { text: "Az tamahkarı, çok zarar getirir.", author: "Türk atasözü", lang: "tr" },
  { text: "Sabreden derviş muradına ermiş.", author: "Türk atasözü", lang: "tr" },
  { text: "Bir elin nesi var, iki elin sesi var.", author: "Türk atasözü", lang: "tr" },
  { text: "Gülü seven dikenine katlanır.", author: "Türk atasözü", lang: "tr" },
  { text: "Komşu komşunun külüne muhtaçtır.", author: "Türk atasözü", lang: "tr" },
  { text: "Üzüm üzüme baka baka kararır.", author: "Türk atasözü", lang: "tr" },
  { text: "İşleyen demir ışıldar.", author: "Türk atasözü", lang: "tr" },
  { text: "Yalancının mumu yatsıya kadar yanar.", author: "Türk atasözü", lang: "tr" },
  { text: "Ne ekersen onu biçersin.", author: "Türk atasözü", lang: "tr" },
  { text: "Acele işe şeytan karışır.", author: "Türk atasözü", lang: "tr" },
  { text: "Aç tavuk kendini buğday ambarında sanır.", author: "Türk atasözü", lang: "tr" },
  { text: "Balık baştan kokar.", author: "Türk atasözü", lang: "tr" },
  {
    text: "Damlaya damlaya göl olur; taşa taşa dağ olur, sabırla her iş kolaylaşır ve emek asla boşa gitmez.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Bugünün işini yarına bırakma, çünkü zaman geri gelmez, fırsat kapıyı bir kez çalar ve tembellik pişmanlık doğurur.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Ak akçe kara gün içindir, dostluk zor günde belli olur ve gerçek dost kara günde yanında durandır, iyi günün dostu boldur.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Söz gümüşse sükût altındır; çok konuşan çok yanılır, az söz öz olur, bilgelik dinlemekle başlar ve sabırla olgunlaşır.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Öfkeyle kalkan zararla oturur; acele ile alınan karar çoğu zaman pişmanlıkla sonuçlanır, bu yüzden bilge insan önce düşünür sonra konuşur.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Dost kara günde belli olur, ekmeğini paylaşan değil derdini paylaşan gerçek dosttur; zor zamanda yanında duran, iyi günde de hep yanındadır.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Bugün git yarın gel sözü, sabrı ve azmi sınayan bir bekleyiştir; sabreden derviş muradına erer denir, çünkü emek her zaman bir gün karşılığını bulur ve boşa gitmez, sabırla beklemek kazandırır. Damlaya damlaya göl olur, taşa taşa dağ olur; küçük adımlar zamanla büyük sonuçlara dönüşür ve azim asla boşa gitmez, sabırlı olan sonunda muradına erer.",
    author: "Türk atasözü",
    lang: "tr",
  },
  {
    text: "Ağaç yaşken eğilir sözü, insan terbiyesinin küçük yaşta verilmesi gerektiğini anlatır; büyüdükten sonra alışkanlıkları değiştirmek çok daha zordur, bu yüzden eğitim erken başlamalı ve sabırla sürdürülmelidir, çünkü kökü sağlam olan ağaç fırtınaya dayanır. Balık baştan kokar derler; bir topluluğun ya da ailenin düzeni, başındaki kişinin tutumuyla şekillenir, üstteki bozulursa alttakiler de bundan etkilenir ve düzeni yeniden kurmak zaman alır.",
    author: "Türk atasözü",
    lang: "tr",
  },
  { text: "A journey of a thousand miles begins with a single step.", author: "Proverb", lang: "en" },
  { text: "Actions speak louder than words.", author: "Proverb", lang: "en" },
  { text: "A stitch in time saves nine.", author: "Proverb", lang: "en" },
  { text: "Better late than never.", author: "Proverb", lang: "en" },
  { text: "Birds of a feather flock together.", author: "Proverb", lang: "en" },
  { text: "Don't count your chickens before they hatch.", author: "Proverb", lang: "en" },
  { text: "Every cloud has a silver lining.", author: "Proverb", lang: "en" },
  { text: "Honesty is the best policy.", author: "Proverb", lang: "en" },
  { text: "Practice makes perfect.", author: "Proverb", lang: "en" },
  { text: "The early bird catches the worm.", author: "Proverb", lang: "en" },
  { text: "When in Rome, do as the Romans do.", author: "Proverb", lang: "en" },
  { text: "Where there is a will, there is a way.", author: "Proverb", lang: "en" },
  {
    text: "A penny saved is a penny earned, and small savings gathered patiently over many years can grow into a fortune that a careless spender never manages to build.",
    author: "Proverb",
    lang: "en",
  },
  {
    text: "Rome was not built in a day, and neither is any great achievement; patience and steady effort accomplish what haste and impatience never could.",
    author: "Proverb",
    lang: "en",
  },
  {
    text: "Too many cooks spoil the broth, for when everyone tries to lead at once, confusion follows and the simplest tasks become needlessly difficult to finish.",
    author: "Proverb",
    lang: "en",
  },
  {
    text: "The pen is mightier than the sword, for ideas carried by words can change the minds of nations long after the clash of arms has been forgotten.",
    author: "Proverb",
    lang: "en",
  },
  {
    text: "A journey of a thousand miles begins with a single step, and no traveler ever reaches a distant destination without first setting out from where they stand; patience, courage, and steady effort carry the walker further than speed ever could, and those who persist through hardship arrive long after the hasty have given up and turned back.",
    author: "Proverb",
    lang: "en",
  },
  {
    text: "Rome was not built in a day, and every great work of history was raised stone by stone through the patient labor of many hands; those who expect instant results forget that lasting achievements are built slowly, tested by time, and strengthened by the failures that teach builders how to build again, stronger than before.",
    author: "Proverb",
    lang: "en",
  },
];
