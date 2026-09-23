// English word pool.
// Core list preserved from the old `words.ts`; extended with common everyday
// nouns, verbs, adjectives and adverbs. Rules: lowercase only, [a-z'] only,
// length 2..12, unique. Note: the old list's single-letter word "a" is dropped
// by the length filter below (length must be >= 2).

const raw = `
the be of and a to in he have it that for they with as not on she at by this we you do
but from or which one would all will there say who make when can more if no man out
other so what time up go about than into could state only new year some take come
these know see use get like then first any work now may such give over think most even
find day also after way many must look before great back through long where much
should well people down own just because good each those feel seem how high too place
little world very still nation hand old life tell write become here show house both
between need mean call develop under last right move thing general school never same
another begin while number part turn real leave might want point form off child few
small since against ask late home interest large person end open public follow during
present without again hold around possible head consider word program problem however
lead system set order eye plan run keep face fact group play stand increase early
course change help line
apple banana orange grape lemon peach cherry mango melon berry plum fig date
table chair window door floor wall ceiling roof stairs kitchen bedroom bathroom
garden garage house building street road avenue square park bridge tower tunnel
river lake ocean sea beach island mountain valley hill forest desert field
cloud rain snow wind storm thunder lightning sun moon star sky horizon rainbow
morning evening night noon midnight today tomorrow yesterday week month season
spring summer autumn winter holiday birthday wedding festival ceremony
family mother father sister brother child friend neighbor guest stranger
teacher student school class lesson lecture exam homework grade diploma degree
book page chapter story novel poem letter word sentence paragraph paper pen
pencil eraser notebook folder file computer keyboard mouse screen printer
phone camera battery charger cable wire light lamp switch socket plug
music song singer band concert guitar piano drum violin flute orchestra
movie film actor actress director scene stage theater cinema ticket audience
sport football basketball tennis soccer swimming running cycling boxing
team player coach referee stadium field score goal match tournament trophy
food breakfast lunch dinner snack meal recipe kitchen chef restaurant menu
bread butter cheese milk egg meat chicken fish rice pasta soup salad sauce
sugar salt pepper spice herb oil vinegar honey jam juice coffee tea water
animal dog cat bird fish horse cow sheep goat pig chicken duck rabbit mouse
lion tiger bear wolf fox deer elephant monkey snake turtle frog bee ant
body head face eye ear nose mouth chin cheek forehead hair neck shoulder
arm hand finger elbow wrist chest back stomach hip leg knee foot ankle toe
health doctor nurse hospital clinic medicine pill treatment surgery patient
disease fever cough headache pain injury wound bandage vaccine therapy
emotion happiness sadness anger fear surprise joy hope love hate trust
respect friendship kindness patience courage honesty pride shame guilt
money bank account credit debit loan interest tax salary wage price cost
budget saving investment profit loss market trade business company office
job career employee employer manager worker customer client contract deal
government president minister parliament election vote law court judge
jury crime punishment prison freedom justice rights citizen nation country
city village town capital region district border language culture
tradition custom religion belief prayer church temple mosque
science physics chemistry biology mathematics history geography art music
painting sculpture museum gallery exhibition design architecture engineer
technology internet software hardware network server database security
password memory storage device application system update version code
travel journey trip vacation flight airport airplane train station ship
port harbor luggage suitcase passport visa ticket map compass guide hotel
room reservation tourist destination adventure explore discover
weather temperature climate humidity pressure forecast drought flood
earthquake disaster emergency rescue safety danger risk warning alarm
nature environment pollution recycle energy solar wind power fuel resource
plant tree flower leaf root branch seed soil grass bush farm crop
harvest agriculture farmer field barn tractor plow irrigation fertilizer
conversation discussion debate argument opinion suggestion
question answer explanation description summary report announcement notice
decision choice option solution problem challenge opportunity result outcome
success failure achievement goal target purpose plan strategy method
`;

const CHAR_SET = /^[a-z']+$/;

export const WORDS: readonly string[] = Array.from(
  new Set(
    raw
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.length <= 12 && CHAR_SET.test(w)),
  ),
);
