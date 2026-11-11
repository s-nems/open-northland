import { LANGUAGES, type Language } from '../languages.js';
import type { HypertextBlock } from '../schema/gui/hypertext.js';
import type { MapVariantBriefingPages } from './schema.js';

/** The `PlayCutscene` pages the map's opening mission and its `MissionWon` show. */
const OPENING_PAGE = 0;
const VICTORY_PAGE = 1;

/** Two or more empty lines open a new section of the book, with a wider gap above it. */
const SECTION_GAP_LINES = 2;
const blank: HypertextBlock = { kind: 'blank', lines: 1 };
const sectionGap: HypertextBlock = { kind: 'blank', lines: SECTION_GAP_LINES };

const title = (text: string): HypertextBlock => ({ kind: 'text', style: 'title', text, align: 'center' });
/** A red title, which the book sets as a solemn section heading. */
const solemnTitle = (text: string): HypertextBlock => ({
  kind: 'text',
  style: 'title',
  text,
  align: 'center',
  color: 'red',
});

/** Laid out like the map's own page: centred paragraphs a blank line apart. */
const paragraphs = (texts: readonly string[]): HypertextBlock[] =>
  texts.flatMap((text): HypertextBlock[] => [blank, { kind: 'text', style: 'body', text, align: 'center' }]);

interface PageText {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

interface LanguageText {
  /** The map's story, told without the trade and the tribes to find that Ragnarök does not have. */
  readonly intro: PageText;
  /** What Ragnarök changes, without the times and band sizes the escalation data may tune. */
  readonly rules: PageText;
  readonly victory: PageText;
}

const TEXTS: Record<Language, LanguageText> = {
  pol: {
    intro: {
      title: 'FORTECA',
      paragraphs: [
        'Nastały dla Wikingów mroczne dni...\nZ fortecy w samym sercu kraju wyruszają bandy siepaczy i pustoszą wszystko wokół. Nikt nie może się przed nimi ukryć.',
        'Tym razem nie musicie nikogo szukać ani z nikim handlować. Wszystkie plemiona, również Mieszkańcy równiny i Górale, biorą udział w grze jako sojusznicy. Fortecę zdobędziecie tylko razem!',
        'Plemiona Wikingów mogą oddawać sobie nawzajem ludzi. Wyślij kilku swoich Wikingów do świętego ognia sprzymierzonego plemienia Wikingów: kto przejdzie przez płonący krąg, służy odtąd temu sojusznikowi. Mieszkańców równiny i Górali to nie dotyczy.',
        'Na początek dostajesz kilka listów z budynkami. Nie zwlekaj z nimi zbyt długo, ale wybieraj rozważnie!',
      ],
    },
    rules: {
      title: 'RAGNARÖK',
      paragraphs: [
        'Forteca nie czeka na wasz atak. Jej siepacze napadają na każde plemię według stałego harmonogramu, za każdym razem silniej. Między atakami są krótkie przerwy, wykorzystaj je dobrze!',
        'Mniej więcej od połowy gry ataki nadchodzą także od morza: okręty fortecy przybijają do twoich brzegów i wysadzają wojowników.',
        'Z czasem siepacze zdobywają coraz lepszy ekwipunek: najpierw lepszą broń, lekkie zbroje i buty, potem ciężkie zbroje, amulety, a w końcu mikstury lecznicze.',
        'Z poległych siepaczy fortecy nic nie wypada: ich broń, zbroje i wszystko, co nieśli, przepada razem z nimi.',
        'Załoga fortecy rośnie z upływem czasu i z liczbą plemion w grze, a zniszczone katapulty po pewnym czasie wracają na swoje miejsca.',
        'Fortecy broni ponadto potężny bohater, Lord Uzurpator.',
        'Forteca ma własnych budowniczych, którzy odbudowują to, co zniszczysz, i tragarzy, którzy zbierają łupy z pola walki.',
        'Złoża złota, żelaza i grzybów dają trzy razy więcej.',
        'Drzewa oraz złoża kamienia i gliny też dają więcej niż zwykle, a Mieszkańcy równiny mają u siebie dodatkową gliniankę i zagajnik.',
        'Ile czasu zostało do następnego ataku, zobaczysz wśród celów misji.',
      ],
    },
    victory: {
      title: 'ZWYCIĘSTWO',
      paragraphs: [
        'Forteca padła! Ostatni siepacze legli wśród zgliszcz jej murów, a nad krajem po raz pierwszy od lat wstaje spokojny dzień.',
        'Ragnarök nie nadszedł. Plemiona, które razem stawiły czoła oprawcom, przetrwały ataki z lądu i z morza i wspólnymi siłami zdobyły twierdzę.',
        'Kraj jest wolny. Wikingowie, Mieszkańcy równiny i Górale mogą wreszcie odbudować swoje osady i żyć bez strachu. Chwała zwycięzcom!',
      ],
    },
  },
  eng: {
    intro: {
      title: 'DARK CASTLE',
      paragraphs: [
        'Dark days have fallen on the Vikings...\nFrom a fortress at the heart of the land, bands of enforcers ride out and lay waste to everything around them. No one can hide from them.',
        'This time there is nobody to seek out and nobody to trade with. Every tribe on the map, the Inhabitants of the Plain and the Highlanders included, takes part as an ally. You will only take the fortress together!',
        'Viking tribes can lend each other people. Send a few of your Vikings to an allied Viking tribe’s sacred fire: whoever walks through the burning ring serves that ally from then on. The Inhabitants of the Plain and the Highlanders cannot do this.',
        'You start with a few building letters. Do not hold on to them for long, but choose with care!',
      ],
    },
    rules: {
      title: 'RAGNARÖK',
      paragraphs: [
        'The fortress does not wait for your attack. Its enforcers raid every tribe on a fixed schedule, stronger each time. There are short breaks between the attacks, so use them well!',
        'From about the middle of the game, attacks also come from the sea: the fortress ships land warriors on your shores.',
        'Over time the enforcers get ever better gear: first better weapons, light armor and shoes, then heavy armor, amulets and finally healing potions.',
        'Nothing falls from the fortress enforcers when they die: their weapons, armor and everything they carried are lost with them.',
        'The fortress garrison grows with time and with the number of tribes in play, and destroyed catapults return to their posts after a while.',
        'The fortress is also defended by a mighty hero, Lord Usurper.',
        'The fortress has builders of its own who rebuild what you destroy, and porters who clear the loot off the battlefield.',
        'Gold, iron and mushroom deposits yield three times as much.',
        'Trees, stone and clay deposits yield more than usual too, and the Inhabitants of the Plain get an extra clay pit and grove.',
        'The time left until the next attack is shown among your goals.',
      ],
    },
    victory: {
      title: 'VICTORY',
      paragraphs: [
        'The fortress has fallen! The last enforcers lie among the ruins of its walls, and for the first time in years a peaceful day dawns over the land.',
        'Ragnarök did not come. The tribes that stood against the oppressors together held out against attacks from land and sea and took the stronghold with their united strength.',
        'The land is free. The Vikings, the Inhabitants of the Plain and the Highlanders can at last rebuild their villages and live without fear. Glory to the victors!',
      ],
    },
  },
  ger: {
    intro: {
      title: 'FESTUNG',
      paragraphs: [
        'Finstere Tage sind über die Wikinger gekommen...\nAus einer Festung im Herzen des Landes ziehen Banden von Schlächtern aus und verwüsten alles ringsum. Niemand kann sich vor ihnen verstecken.',
        'Diesmal musst du niemanden suchen und mit niemandem handeln. Jeder Stamm auf der Karte, auch die Plattländer und die Bergländer, spielt als Verbündeter mit. Die Festung fällt nur, wenn ihr zusammensteht!',
        'Wikingerstämme können einander Leute überlassen. Schicke ein paar deiner Wikinger zum heiligen Feuer eines verbündeten Wikingerstammes: Wer durch den brennenden Ring geht, dient fortan diesem Verbündeten. Für die Plattländer und die Bergländer gilt das nicht.',
        'Zu Beginn hast du ein paar Baubriefe. Halte sie nicht zu lange zurück, aber wähle mit Bedacht!',
      ],
    },
    rules: {
      title: 'RAGNARÖK',
      paragraphs: [
        'Die Festung wartet nicht auf euren Angriff. Ihre Schlächter überfallen jeden Stamm nach einem festen Zeitplan, jedes Mal stärker. Zwischen den Angriffen gibt es kurze Pausen, nutze sie gut!',
        'Etwa ab der Mitte des Spiels kommen Angriffe auch vom Meer: Die Schiffe der Festung setzen Krieger an deinen Küsten ab.',
        'Mit der Zeit werden die Schlächter immer besser ausgerüstet: zuerst mit besseren Waffen, leichten Rüstungen und Schuhen, dann mit schweren Rüstungen, Amuletten und schließlich mit Heiltränken.',
        'Von gefallenen Schlächtern der Festung bleibt nichts zurück: Ihre Waffen, Rüstungen und alles, was sie trugen, gehen mit ihnen verloren.',
        'Die Besatzung der Festung wächst mit der Zeit und mit der Zahl der Stämme im Spiel, und zerstörte Katapulte kehren nach einer Weile an ihren Platz zurück.',
        'Zudem verteidigt die Festung ein mächtiger Held: Lord Usurpator.',
        'Die Festung hat eigene Baumeister, die wieder aufbauen, was du zerstörst, und Träger, die die Beute vom Schlachtfeld räumen.',
        'Gold-, Eisen- und Pilzvorkommen geben dreimal so viel her.',
        'Auch Bäume, Stein- und Lehmvorkommen geben mehr her als sonst, und die Plattländer bekommen eine zusätzliche Lehmgrube und ein Wäldchen.',
        'Wie lange es noch bis zum nächsten Angriff dauert, siehst du bei den Missionszielen.',
      ],
    },
    victory: {
      title: 'SIEG',
      paragraphs: [
        'Die Festung ist gefallen! Die letzten Schlächter liegen in den Trümmern ihrer Mauern, und zum ersten Mal seit Jahren bricht über dem Land ein friedlicher Tag an.',
        'Ragnarök ist nicht gekommen. Die Stämme, die sich den Peinigern gemeinsam entgegenstellten, haben den Angriffen zu Land und zu Wasser standgehalten und die Feste mit vereinten Kräften erobert.',
        'Das Land ist frei. Die Wikinger, die Plattländer und die Bergländer können endlich ihre Dörfer wieder aufbauen und ohne Angst leben. Ruhm den Siegern!',
      ],
    },
  },
  rus: {
    intro: {
      title: 'КРЕПОСТЬ',
      paragraphs: [
        'Для Викингов наступили мрачные дни...\nИз крепости в сердце страны выходят банды приспешников и разоряют всё вокруг. Никому не укрыться от них.',
        'На этот раз никого не нужно разыскивать и ни с кем не нужно торговать. Каждое племя на карте, включая Жителей Равнины и Горцев, участвует в игре как союзник. Крепость падёт, только если вы будете действовать сообща!',
        'Племена Викингов могут уступать друг другу людей. Отправьте нескольких своих Викингов к священному огню союзного племени Викингов: тот, кто пройдёт сквозь пылающее кольцо, отныне служит этому союзнику. На Жителей Равнины и Горцев это не распространяется.',
        'В начале у Вас есть несколько разрешений на строительство. Не откладывайте их надолго, но выбирайте обдуманно!',
      ],
    },
    rules: {
      title: 'РАГНАРЁК',
      paragraphs: [
        'Крепость не ждёт вашего нападения. Её приспешники нападают на каждое племя по твёрдому расписанию, каждый раз всё сильнее. Между атаками бывают короткие передышки, используйте их с умом!',
        'Примерно с середины игры атаки приходят и с моря: корабли крепости высаживают воинов на Ваших берегах.',
        'Со временем приспешники получают всё лучшее снаряжение: сначала лучшее оружие, лёгкие доспехи и сапоги, затем тяжёлые доспехи, амулеты и, наконец, целебные зелья.',
        'С павших приспешников крепости ничего не падает: их оружие, доспехи и всё, что они несли, пропадает вместе с ними.',
        'Гарнизон крепости растёт со временем и с числом племён в игре, а разрушенные катапульты через некоторое время возвращаются на свои места.',
        'Кроме того, крепость защищает могучий герой, Лорд Узурпатор.',
        'У крепости есть свои строители, которые восстанавливают то, что Вы разрушили, и носильщики, которые убирают добычу с поля боя.',
        'Залежи золота, железа и грибов дают втрое больше.',
        'Деревья, залежи камня и глины тоже дают больше обычного, а у Жителей Равнины есть дополнительный глиняный карьер и роща.',
        'Сколько времени осталось до следующей атаки, Вы увидите среди целей миссии.',
      ],
    },
    victory: {
      title: 'ПОБЕДА',
      paragraphs: [
        'Крепость пала! Последние приспешники лежат среди развалин её стен, и впервые за долгие годы над страной встаёт мирный день.',
        'Рагнарёк не наступил. Племена, вместе вставшие против палачей, выдержали атаки с суши и с моря и общими силами взяли твердыню.',
        'Страна свободна. Викинги, Жители Равнины и Горцы наконец могут отстроить свои селения и жить без страха. Слава победителям!',
      ],
    },
  },
  ita: {
    intro: {
      title: 'CASTELLO OSCURO',
      paragraphs: [
        'Giorni bui sono calati sui Vichinghi...\nDa una fortezza nel cuore del paese partono bande di sgherri che devastano tutto ciò che li circonda. Nessuno può nascondersi da loro.',
        'Questa volta non devi cercare nessuno né commerciare con nessuno. Tutte le tribù della mappa, compresi gli Abitanti della pianura e i Montanari, partecipano come alleati. Solo insieme conquisterete la fortezza!',
        'Le tribù vichinghe possono cedersi uomini a vicenda. Manda alcuni dei tuoi Vichinghi al fuoco sacro di una tribù vichinga alleata: chi attraversa il cerchio di fiamme da quel momento serve quell’alleato. Gli Abitanti della pianura e i Montanari non possono farlo.',
        'All’inizio ricevi alcune lettere di costruzione. Non tenerle troppo a lungo, ma scegli con cura!',
      ],
    },
    rules: {
      title: 'RAGNARÖK',
      paragraphs: [
        'La fortezza non aspetta il vostro attacco. I suoi sgherri assaltano ogni tribù secondo un calendario fisso, ogni volta più forti. Tra un attacco e l’altro ci sono brevi pause: sfruttale bene!',
        'Più o meno da metà partita gli attacchi arrivano anche dal mare: le navi della fortezza sbarcano guerrieri sulle tue coste.',
        'Col tempo gli sgherri ricevono un equipaggiamento sempre migliore: prima armi migliori, armature leggere e scarpe, poi armature pesanti, amuleti e infine pozioni di guarigione.',
        'Gli sgherri della fortezza non lasciano nulla quando cadono: le loro armi, le armature e tutto ciò che portavano vanno perduti con loro.',
        'La guarnigione della fortezza cresce con il tempo e con il numero di tribù in gioco, e le catapulte distrutte tornano al loro posto dopo un po’.',
        'La fortezza è difesa inoltre da un potente eroe, Lord Usurpatore.',
        'La fortezza ha costruttori propri, che ricostruiscono ciò che distruggi, e trasportatori che portano via il bottino dal campo di battaglia.',
        'I giacimenti di oro, ferro e funghi rendono il triplo.',
        'Anche alberi, cave di pietra e giacimenti di argilla rendono più del solito, e gli Abitanti della pianura ricevono una cava di argilla e un boschetto in più.',
        'Il tempo che manca al prossimo attacco è indicato tra i tuoi obiettivi.',
      ],
    },
    victory: {
      title: 'VITTORIA',
      paragraphs: [
        'La fortezza è caduta! Gli ultimi sgherri giacciono tra le rovine delle sue mura e, per la prima volta da anni, sul paese sorge un giorno di pace.',
        'Il Ragnarök non è arrivato. Le tribù che si sono opposte insieme agli oppressori hanno resistito agli attacchi da terra e dal mare e hanno espugnato la roccaforte con le forze unite.',
        'Il paese è libero. I Vichinghi, gli Abitanti della pianura e i Montanari possono finalmente ricostruire i loro villaggi e vivere senza paura. Gloria ai vincitori!',
      ],
    },
  },
  chs: {
    intro: {
      title: '黑暗城堡',
      paragraphs: [
        '维京人迎来了艰难的岁月……\n国土中心的要塞不断派出成群的爪牙，所到之处一片狼藉，谁也躲不开他们。',
        '这一次，你不必寻找任何部族，也无需与人交易：地图上的每个部族，包括普拉特兰人和高地人，都作为盟友参战。唯有并肩作战，才能拿下要塞！',
        '维京部族之间可以借调人手：派几名维京人到同盟维京部族的圣火旁，穿过燃烧火圈的人从此便为那位盟友效力。普拉特兰人和高地人无法这样做。',
        '开局时你有几封建筑书信。别拖太久，但要慎重挑选！',
      ],
    },
    rules: {
      title: '诸神黄昏',
      paragraphs: [
        '要塞不会坐等你们来攻。它的爪牙按固定的时间表袭击每个部族，一次比一次猛烈。两次进攻之间只有短暂的间隙，好好利用！',
        '大约从游戏中段起，进攻也会来自海上：要塞的战船会在你的海岸放下战士。',
        '爪牙的装备会随时间越来越好：先是更好的武器、轻甲和鞋子，然后是重甲、护身符，最后是治疗药水。',
        '要塞的爪牙阵亡时什么也不会掉落：他们的武器、盔甲和携带的一切都会随之消失。',
        '要塞守军会随着时间和参战部族的数量不断壮大，被摧毁的投石车过一段时间也会回到原处。',
        '此外，还有一位强大的英雄镇守要塞：篡位领主。',
        '要塞有自己的建筑工重建被你摧毁的东西，还有搬运工把战场上的战利品清走。',
        '金矿、铁矿和蘑菇的产量是平常的三倍。',
        '树木、石矿和黏土矿的产量也比平常高，普拉特兰人还多了一处黏土坑和一片树林。',
        '距下一次进攻还有多久，可在任务目标中查看。',
      ],
    },
    victory: {
      title: '胜利',
      paragraphs: [
        '要塞陷落了！最后的爪牙倒在城墙的废墟之间，多年来第一次，这片土地迎来了平静的一天。',
        '诸神黄昏没有降临。携手对抗暴徒的各个部族顶住了来自陆地和海上的进攻，同心协力攻下了这座堡垒。',
        '这片土地自由了。维京人、普拉特兰人和高地人终于可以重建家园，不再生活在恐惧之中。荣耀属于胜利者！',
      ],
    },
  },
  cht: {
    intro: {
      title: '黑暗城堡',
      paragraphs: [
        '維京人迎來了艱難的歲月……\n國土中心的要塞不斷派出成群的爪牙，所到之處一片狼藉，誰也躲不開他們。',
        '這一次，你不必尋找任何部族，也無需與人交易：地圖上的每個部族，包括普拉特蘭人和高地人，都作為盟友參戰。唯有並肩作戰，才能拿下要塞！',
        '維京部族之間可以借調人手：派幾名維京人到同盟維京部族的聖火旁，穿過燃燒火圈的人從此便為那位盟友效力。普拉特蘭人和高地人無法這樣做。',
        '開局時你有幾封建築書信。別拖太久，但要慎重挑選！',
      ],
    },
    rules: {
      title: '諸神黃昏',
      paragraphs: [
        '要塞不會坐等你們來攻。它的爪牙按固定的時間表襲擊每個部族，一次比一次猛烈。兩次進攻之間只有短暫的間隙，好好利用！',
        '大約從遊戲中段起，進攻也會來自海上：要塞的戰船會在你的海岸放下戰士。',
        '爪牙的裝備會隨時間越來越好：先是更好的武器、輕甲和鞋子，然後是重甲、護身符，最後是治療藥水。',
        '要塞的爪牙陣亡時什麼也不會掉落：他們的武器、盔甲和攜帶的一切都會隨之消失。',
        '要塞守軍會隨著時間和參戰部族的數量不斷壯大，被摧毀的投石車過一段時間也會回到原處。',
        '此外，還有一位強大的英雄鎮守要塞：篡位領主。',
        '要塞有自己的建築工重建被你摧毀的東西，還有搬運工把戰場上的戰利品清走。',
        '金礦、鐵礦和蘑菇的產量是平常的三倍。',
        '樹木、石礦和黏土礦的產量也比平常高，普拉特蘭人還多了一處黏土坑和一片樹林。',
        '距下一次進攻還有多久，可在任務目標中查看。',
      ],
    },
    victory: {
      title: '勝利',
      paragraphs: [
        '要塞陷落了！最後的爪牙倒在城牆的廢墟之間，多年來第一次，這片土地迎來了平靜的一天。',
        '諸神黃昏沒有降臨。攜手對抗暴徒的各個部族頂住了來自陸地和海上的進攻，同心協力攻下了這座堡壘。',
        '這片土地自由了。維京人、普拉特蘭人和高地人終於可以重建家園，不再生活在恐懼之中。榮耀屬於勝利者！',
      ],
    },
  },
};

function byLanguage(
  build: (text: LanguageText) => HypertextBlock[],
): Partial<Record<Language, HypertextBlock[]>> {
  const out: Partial<Record<Language, HypertextBlock[]>> = {};
  for (const lang of LANGUAGES) out[lang] = build(TEXTS[lang]);
  return out;
}

/** The opening page tells the story Ragnarök keeps, then its own rules as a section of their own; the
 *  victory page, a copy of the opening one on the authored map, tells the fortress's fall. */
export const SPECJALNA_FORTECA_RAGNAROK_BRIEFING: MapVariantBriefingPages = {
  [OPENING_PAGE]: byLanguage(({ intro, rules }) => [
    blank,
    title(intro.title),
    ...paragraphs(intro.paragraphs),
    sectionGap,
    solemnTitle(rules.title),
    ...paragraphs(rules.paragraphs),
  ]),
  [VICTORY_PAGE]: byLanguage(({ victory }) => [
    blank,
    title(victory.title),
    ...paragraphs(victory.paragraphs),
  ]),
};
