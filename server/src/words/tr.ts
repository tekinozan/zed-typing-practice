// Türkçe kelime havuzu.
// Çekirdek liste eski `words.ts` dosyasından korunmuştur; üzerine günlük dilde sık
// kullanılan isim, fiil (mastar), sıfat ve zarflar eklenerek genişletilmiştir.
// Kurallar: yalnızca küçük harf, yalnızca [a-zçğıöşü], uzunluk 2..12, benzersiz.

const raw = `
ben sen biz siz onlar bir iki üç ve ama çünkü gibi için ile daha çok az en her hiç şey
zaman gün yıl insan el göz yol ev su iş kadar sonra önce şimdi bugün yarın dün burada
orada nasıl neden ne kim hangi büyük küçük yeni eski güzel iyi kötü uzun kısa doğru
yanlış açık kapalı sıcak soğuk hızlı yavaş gelmek gitmek yapmak etmek olmak bilmek
görmek almak vermek demek söylemek istemek bakmak çalışmak düşünmek anlamak başlamak
bitirmek okumak yazmak konuşmak dinlemek sormak bulmak kalmak çıkmak girmek oturmak
kalkmak yaşamak sevmek beklemek dönmek kullanmak açmak kapatmak tutmak göstermek
getirmek kod dosya satır hata test sunucu klavye ekran dünya şehir ülke dil kelime
cümle soru cevap sayı renk ses müzik kitap masa kapı pencere araba deniz dağ orman
hava güneş ay yıldız kış yaz bahar sabah akşam gece öğle hafta saat dakika arkadaş
aile anne baba çocuk okul öğrenci öğretmen para fiyat çay kahve ekmek yemek
kalem defter silgi çanta sınıf tahta sıra bilgisayar telefon internet program yazılım
donanım fare şarj pil kablo ışık lamba sandalye dolap perde halı duvar tavan
zemin merdiven asansör bina apartman sokak cadde meydan park bahçe çiçek ağaç yaprak
dal kök toprak taş kum çakıl kaya tepe vadi göl nehir ırmak okyanus ada
kıyı sahil plaj tuz şeker tatlı tuzlu ekşi acı buruk keskin yumuşak sert katı
sıvı gaz buhar buz kar yağmur bulut rüzgar fırtına şimşek gökkuşağı gündüz karanlık
aydınlık gölge sis çiy don kuraklık sel deprem yangın felaket afet tehlike güvenlik
huzur barış savaş asker ordu silah kalkan zafer yenilgi başarı hedef amaç plan
karar sonuç neden etki durum olay haber gazete dergi radyo televizyon film dizi
oyun spor futbol basketbol voleybol yüzme koşu yürüyüş bisiklet otobüs tren
uçak gemi tekne kamyon motosiklet bilet yolculuk tatil gezi seyahat harita pusula
valiz bavul pasaport vize gümrük havalimanı istasyon durak terminal liman
market dükkan mağaza alışveriş indirim kampanya ürün marka kalite miktar
sipariş fatura kasa banka hesap kredi borç ödeme nakit kart şifre anahtar
kilit çatı garaj bodrum salon yatak oda mutfak banyo tuvalet
koridor balkon teras havuz bahçıvan temizlik çöp geri dönüşüm doğa çevre
hayvan kuş balık böcek arı kelebek karınca örümcek yılan kaplumbağa tavşan kedi
köpek at inek koyun keçi tavuk horoz ördek kaz aslan kaplan fil zürafa maymun
ayı kurt tilki geyik ceylan yunus balina köpekbalığı istakoz karides midye
meyve sebze elma armut muz portakal limon üzüm çilek karpuz kavun kiraz şeftali
kayısı erik incir nar ceviz fındık badem yer fıstık domates salatalık patates
soğan sarımsak biber patlıcan kabak havuç ıspanak marul lahana bezelye fasulye
mercimek nohut pirinç bulgur makarna un yağ baharat tarçın zencefil nane
kekik kimyon karabiber kırmızıbiber çorba salata kızartma haşlama ızgara fırın
tencere tava kaşık çatal bıçak tabak bardak fincan tepsi kavanoz şişe kutu
poşet paket ambalaj etiket reçete ilaç doktor hastane hemşire eczane sağlık
hastalık ateş öksürük baş ağrı diş kulak burun boğaz mide bağırsak kalp
akciğer kas kemik deri saç tırnak parmak avuç bilek dirsek omuz sırt bel
diz ayak topuk bacak kol boyun çene alın kaş kirpik dudak yanak
duygu mutluluk üzüntü öfke korku şaşkınlık merak heyecan umut hayal sevgi
saygı güven dostluk kardeşlik komşuluk misafir davet ziyaret sohbet tartışma
fikir düşünce görüş öneri eleştiri övgü teşekkür özür rica emir izin yasak
kural kanun hak adalet mahkeme avukat hakim tanık suç ceza hapis özgürlük
demokrasi seçim oy parti meclis hükümet bakan başkan vali belediye muhtar
vatandaş toplum kültür gelenek görenek bayram tören düğün nişan doğum ölüm
mezar cenaze din inanç ibadet cami kilise sinagog tapınak dua ayin kutsal
felsefe bilim matematik fizik kimya biyoloji tarih coğrafya edebiyat sanat
resim heykel müze tiyatro sinema konser sergi festival yarışma ödül madalya
şampiyon takım oyuncu antrenör saha stad tribün taraftar galibiyet
mağlubiyet beraberlik gol skor turnuva lig kupa final yarı
ekonomi ticaret ihracat ithalat sanayi fabrika üretim tüketim arz talep
enflasyon faiz döviz borsa yatırım şirket ortak çalışan işveren maaş
zam prim mesai vardiya toplantı proje rapor sunum belge imza
mühür damga onay red iptal değişiklik güncelleme yenileme yedekleme
kayıt silme arama filtre liste sıralama grup kategori başlık
özet içerik metin paragraf harf hece anlam sözlük dilbilgisi
telaffuz aksan lehçe çeviri tercüman yayın basın editör yazar şair
roman hikaye şiir deneme makale sayfa cilt bölüm kapak
kütüphane raf kitaplık arşiv belgelik depo ambar atölye tezgah
alet makine motor çark dişli vida somun çivi çekiç tornavida pense
matkap testere balta kürek çapa tırmık fide tohum gübre sulama
damla gökyüzü ufuk manzara peyzaj fotoğraf kamera
objektif çekim ton kontrast netlik odak açı kare
`;

const CHAR_SET = /^[a-zçğıöşü]+$/;

export const WORDS: readonly string[] = Array.from(
  new Set(
    raw
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.length <= 12 && CHAR_SET.test(w)),
  ),
);
