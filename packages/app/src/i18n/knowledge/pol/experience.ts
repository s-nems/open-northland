import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Doświadczenie',
  items: [
    {
      id: 'exp-work',
      name: 'Doświadczenie w pracy',
      lead: 'Doświadczenie rośnie osobno dla każdego towaru: 100% przy drewnie nie przyspiesza kamienia.',
      blocks: [
        {
          h: 'Co daje doświadczenie',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: 'Pierwsze sztuki dają najwięcej',
          },
        },
        {
          data: 'experience',
        },
        {
          p: 'Tabela dotyczy zwykłej pracy. Drewno, polowanie, połów i budowa przybywają w innym tempie, patrz tabela niżej. Przy [[article:gathering|zbieraniu]] doświadczenie zmniejsza liczbę uderzeń na sztukę, a w warsztacie i przy uboju daje dodatkowe sztuki. Doświadczenie razem z narzędziem: [[article:tools|Narzędzia]]. Budowa: [[article:construction|Budowa, rozbudowa, naprawa]].',
        },
        {
          p: 'Zaznaczony własny osadnik ma gwiazdkę fachu. Pojawia się, gdy jego najlepsza umiejętność w zawodzie dojdzie do {{star.step}}%, i rośnie co {{star.step}}% aż do {{star.full}}%. Tragarz jej nie dostaje.',
        },
        {
          h: 'Ile pracy trzeba',
        },
        {
          table: {
            head: ['Praca', 'Liczy się', 'Razy do połowy ({{exp.quotedPct}}%)', 'Razy do 100%'],
            rows: [
              ['Drewno', 'ścięte drzewo', '{{exp.wood.repeatsQuoted}}', '{{exp.wood.repeatsFull}}'],
              ['Polowanie', 'sztuka z truchła', '{{exp.hunt.repeatsQuoted}}', '{{exp.hunt.repeatsFull}}'],
              ['Połów', 'ryba', '{{exp.fish.repeatsQuoted}}', '{{exp.fish.repeatsFull}}'],
              [
                'Glina, kamień, żelazo, złoto, grzyby, zioła, pszenica, ubój, warsztat',
                'sztuka, przy uboju zwierzę, w warsztacie cykl',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Budowa, naprawa',
                'uderzenie młotka w plac budowy',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3],
            foot: 'Ostatnie kolumny liczą drzewa, sztuki, cykle lub uderzenia. Od {{build.bareGainPct}}% [[job:builder|Budowniczy]] bez narzędzia potrzebuje o połowę mniej uderzeń na sztukę materiału. W panelu osadnika, na karcie Doświadczenie, każda umiejętność ma swój wiersz, np. Wydobywanie - Żelazo: {{exp.craft.repeatsQuoted}} razy, wydajność +{{exp.quotedPct}}%.',
          },
        },
        {
          p: 'Każde drzewo, sztuka i cykl liczy się też do ogólnej umiejętności zawodu, np. Rolnictwa. Nowy zawód otwiera albo ta ogólna umiejętność, albo umiejętność jednego towaru: Rolnictwo otwiera [[job:miller|Młynarza]], a Zbieranie - Drewno [[job:joiner|Cieślę]]. Wymogi są w artykule [[article:trades|Zawody i szkoła]]. Przy towarze bez własnej umiejętności liczy się ogólna. Doświadczenie zostaje przy zmianie zawodu.',
        },
        {
          h: 'Doświadczenie, które nie przyspiesza pracy',
        },
        {
          list: [
            '[[job:carrier|Tragarz]] zbiera Noszenie. Nie przyspiesza mu ono pracy, ale {{exp.carrierTrader}} dostaw otwiera [[job:trader|Kupca]].',
            'Kupiec zbiera Handel za każdą rozładowaną sztukę, ale Handel niczego nie zmienia.',
            '[[job:scout|Zwiadowca]], [[job:woman|Kobieta]] i dziecko nie zdobywają doświadczenia.',
            'Sadzenie, podlewanie, [[building:school|Szkoła]] i [[building:barracks|Koszary]] nie dają doświadczenia.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Doświadczenie w walce',
      lead: '{{combat.fightCapHits}} trafień jednym rodzajem broni podwaja obrażenia wręcz.',
      blocks: [
        {
          h: 'Obrażenia wręcz',
        },
        {
          table: {
            head: ['Trafienia', 'Mnożnik', 'Cios {{combat.sampleBlow}} po mnożniku'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: 'Powyżej {{combat.fightCapHits}} trafień mnożnik nie rośnie.',
          },
        },
        {
          p: 'Mnożnik działa przy ciosie wręcz w ludzi, zwierzęta i budynki. Nie działa na [[article:walls|palisady]] i [[article:vehicles|pojazdy]] ani przy strzałach i [[article:catapult|katapulcie]].',
        },
        {
          p: 'Łuk i katapulta bez doświadczenia trafiają {{aim.basePct}}% strzałów, a od {{aim.noSpreadHits}} trafień każdy strzał spada w cel. Szczegóły: [[article:aim|Trafienie i strzelanie]].',
        },
        {
          h: 'Co liczy się jako trafienie',
        },
        {
          p: 'Trafienie to cios lub strzał, który zadał obrażenia. Liczy się osobno dla każdego rodzaju broni: Pięść, Włócznia, Miecz, Łuk, Katapulta. Strzały [[job:hunter|Myśliwego]] też liczą się do Łuku.',
        },
        {
          p: 'W panelu osadnika to wiersze Walka - Miecz, Walka - Łuk i tak dalej. Trafienia mieczem nie pomagają włócznikowi i zostają po zmianie zawodu. Bohaterowi walka nie podnosi obrażeń, chyba że misja to włącza.',
        },
        {
          p: 'Lepszą broń odkrywa się wyrobem, nie walką. Wymóg podaje karta broni, np. [[good:sword_long|Długi Miecz]]. Kto jaką broń nosi: [[article:equip|Wyposażanie żołnierzy]].',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:equip',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: 'Zawody i szkoła',
      lead: 'Odkryty zawód zostaje dla całej osady, nawet gdy osadnik, który go odkrył, zginie.',
      blocks: [
        {
          p: 'Ustawienie lobby "Rozwój zawodów: Wszystkie od początku" znosi wymogi zawodów cywilnych i wyrobów. Wymogi zawodów żołnierskich i zakazy mapy zostają.',
        },
        {
          h: 'Co otwiera zawód',
        },
        {
          data: 'jobs',
        },
        {
          p: 'Gdy wymóg podaje dwie umiejętności, liczy się ich suma. [[job:builder|Budowniczy]], Zbieracz, [[job:farmer|Farmer]], [[job:hunter|Myśliwy]], [[job:fisher|Rybak]], [[job:carrier|Tragarz]] i [[job:scout|Zwiadowca]] są otwarci od początku.',
        },
        {
          p: 'Wyroby odkrywa się tak samo, np. [[good:furniture|Meble]] wymagają Ciesielstwa: {{exp.furnitureNeed}} razy.',
        },
        {
          p: 'Osadnik, który spełnił wymóg, może objąć zawód od razu. Pozostali muszą przejść kurs w [[building:school|Szkole]] albo zdobyć ten sam wymóg pracą.',
        },
        {
          h: 'Szkoła i Koszary',
        },
        {
          table: {
            head: ['Cecha', 'Szkoła', 'Koszary'],
            rows: [
              ['Miejsca', '{{school.seats}}', '{{barracks.seats}}'],
              ['Uczy', 'cywilnego zawodu lub wyrobu', 'zawodu Żołnierza'],
              ['Czas', 'tabela niżej', '{{barracks.drillSeconds}} s'],
              ['Kto', 'dorosły mężczyzna', 'dorosły mężczyzna'],
              [
                'Po kursie',
                'nowy zawód, czeka przy Szkole na przydział',
                'Żołnierz bez broni, dawny zawód zostaje znany',
              ],
            ],
            foot: 'Gdy miejsca są zajęte, kolejni uczniowie czekają pod drzwiami.',
          },
        },
        {
          list: [
            'Uczeń, który wyjdzie jeść albo spać, nie traci postępu. Odwołanie z kursu go kasuje.',
            'Uczeń wysłany do Szkoły w budowie donosi materiał i czeka, aż budowa się skończy.',
            'Ukończony kurs zostaje na stałe, także po zmianie zawodu.',
          ],
        },
        {
          h: 'Czas kursu',
        },
        {
          table: {
            head: ['Kursy', 'Czas'],
            rows: [
              [
                '[[good:armor_leather|Skórzana Zbroja]], [[good:potion_food_small|Mała Odżywcza Mikstura]], [[good:potion_stamina_small|Mała Mikstura Wytrzymałości]]',
                '{{course.shortSeconds}} s',
              ],
              ['zawody i większość wyrobów', '{{course.commonSeconds}} s'],
              ['[[good:potion_heal_big|Duża Lecznicza Mikstura]]', '{{course.healSeconds}} s'],
              ['[[good:handcart|Wózek Ręczny]]', '{{course.handcartSeconds}} s'],
              ['[[good:oxcart|Zaprzęg]]', '{{course.oxcartSeconds}} s'],
              [
                '[[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]], [[good:catapult|Katapulta]]',
                '{{course.shipSeconds}} s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Zawód a miejsce pracy',
        },
        {
          p: 'Po "Zmianie zawodu" osadnik traci miejsce pracy i nowego nie dostanie sam. Wyjątek: absolwenci, gdy włączysz ich przełącznik w [[article:assistant|Asystencie]].',
        },
        {
          table: {
            head: ['Zawód', 'Budynek', 'Bez budynku'],
            rows: [
              ['[[job:builder|Budowniczy]]', 'niepotrzebny', 'Sam idzie na plac budowy.'],
              ['[[job:scout|Zwiadowca]]', 'niepotrzebny', 'Wykonuje rozkazy.'],
              ['[[job:trader|Kupiec]]', 'niepotrzebny', 'Jeździ swoją [[article:trade|trasą]].'],
              ['[[job:civilist|Cywil]]', 'niepotrzebny', 'Nie pracuje, czeka na przydział.'],
              [
                '[[job:collector|Zbieracz]], [[job:hunter|Myśliwy]], [[job:fisher|Rybak]]',
                'do wyboru',
                'Pracuje od [[article:work-flag|flagi roboczej]], która staje mu pod nogami przy objęciu zawodu.',
              ],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zielarz]]', 'wymagany', 'Nie uprawia pola.'],
              ['[[job:carrier|Tragarz]]', 'wymagany', 'Nic nie nosi.'],
              ['Pozostałe zawody cywilne', 'wymagany', 'Stoi bezczynnie.'],
            ],
          },
        },
        {
          list: [
            'Prawy klik na budynku ("Pracuj tutaj") od razu zmienia zawód i daje miejsce pracy.',
            'Osadnik, który nie spełnia wymogu tego zawodu, zajmuje w budynku wolne miejsce Tragarza, jeśli jest.',
            'Żołnierz bierze tylko miejsce w swoim zawodzie.',
            '"Usuń miejsce pracy" i zburzenie budynku nie odbierają zawodu.',
            'Kobieta, dziecko i bohater nigdy nie dostają zawodu.',
          ],
        },
      ],
      see: [
        'article:exp-work',
        'article:exp-combat',
        'article:assistant',
        'article:work-flag',
        'building:school',
        'building:barracks',
      ],
    },
  ],
};
