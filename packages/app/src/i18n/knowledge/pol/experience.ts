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
            'Sadzenie, podlewanie, [[building:school|Szkoła]] i szkolenie w [[building:barracks|Koszarach]] nie dają doświadczenia. Musztra za monety daje doświadczenie w walce: [[article:exp-combat|Doświadczenie w walce]].',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Doświadczenie w walce',
      lead: 'Każdy człowiek ma jedno doświadczenie w walce, od 0 do {{combat.fightCapHits}} pkt, wspólne dla każdej broni.',
      blocks: [
        {
          h: 'Co daje doświadczenie',
        },
        {
          p: 'Przy {{combat.fightCapHits}} pkt cios wręcz zadaje o {{combat.fightDealtPct}}% więcej obrażeń, a każdy cios i strzał, który trafi wojownika, o {{combat.fightTakenPct}}% mniej. Obie premie rosną równo z każdym punktem.',
        },
        {
          table: {
            head: ['Punkty', 'Zadawane wręcz', 'Cios {{combat.sampleBlow}} po mnożniku', 'Otrzymywane'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}', '×1'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}', '×{{fight.taken.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}', '×{{fight.taken.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}', '×{{fight.taken.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}', '×{{fight.taken.75}}'],
              [
                '{{combat.fightCapHits}}',
                '×{{combat.fightCapFactor}}',
                '{{combat.fightCapBlow}}',
                '×{{combat.fightTakenFactor}}',
              ],
            ],
            num: [0, 1, 2, 3],
            foot: 'Powyżej {{combat.fightCapHits}} pkt nic już nie rośnie.',
          },
        },
        {
          p: 'Premia do zadawanych obrażeń działa przy ciosie wręcz w ludzi, zwierzęta i budynki. Nie działa na [[article:walls|palisady]] i [[article:vehicles|pojazdy]] ani przy strzałach i [[article:catapult|katapulcie]]. Łucznikowi doświadczenie daje celność i mniejsze otrzymywane obrażenia, a nie mocniejsze strzały.',
        },
        {
          h: 'Z amuletami',
        },
        {
          p: '[[good:amulet_strength|Amulet Siły]] dodaje swoją premię do premii z doświadczenia: przy pełnym doświadczeniu cios wręcz wychodzi ×{{combat.fightStrengthFactor}}. [[good:amulet_defense|Amulet Obrony]] mnoży się z doświadczeniem: z pełnym doświadczeniem wojownik dostaje ×{{combat.fightDefenseFactor}} obrażeń. Amulety: [[article:draughts|Napoje i amulety]].',
        },
        {
          p: 'Łucznik bez doświadczenia trafia {{aim.basePct}}% strzałów, a od {{aim.noSpreadHits}} pkt każdy strzał spada w cel. [[article:catapult|Katapulta]] liczy własne trafienia. Szczegóły: [[article:aim|Trafienie i strzelanie]].',
        },
        {
          h: 'Jak je zdobyć',
        },
        {
          list: [
            'Walka: cios wręcz, który zadał obrażenia, daje {{combat.fightMeleePerSecond}} pkt za każdą sekundę zamachu, a strzał {{combat.fightShotPerSecond}} pkt za każdą sekundę naciągania cięciwy. Wolna broń zbiera punkty w tym samym tempie co szybka, a łuk na sekundę daje mniej.',
            'Ciosy i strzały w budynki, [[article:walls|palisady]] i [[article:vehicles|pojazdy]] dają {{combat.fightStructurePct}}% tego.',
            'Przyjęte ciosy: kogo zrani ktokolwiek, człowiek, zwierzę, wieża czy katapulta, ten dostaje {{combat.fightTakenPerSecond}} pkt za każdą sekundę ciosu napastnika.',
            'Musztra: żołnierz, z bronią czy bez, płaci jedną [[good:coin|Monetę]] za {{coinDrill.termSeconds}} s ćwiczeń w twoich [[building:barracks|Koszarach]] i po ich końcu dostaje {{coinDrill.points}} pkt. Zaznacz żołnierzy i kliknij prawym przyciskiem własne Koszary.',
          ],
        },
        {
          p: 'Pięść i każda broń liczą się tak samo, strzały [[job:hunter|Myśliwego]] też. Doświadczenie zostaje po zmianie broni i zawodu. Kto ma {{coinDrill.limit}} pkt lub więcej, już nie ćwiczy, resztę zdobywa w walce. Gdy walka albo nowy rozkaz przerwie musztrę, moneta wraca, a punktów nie ma. Idzie tylu żołnierzy, ile Koszary mają wolnych monet, najbliżsi najpierw; reszta zostaje na miejscu.',
        },
        {
          p: 'W panelu osadnika to wiersz Walka: jego udział w pełnym liczniku w procentach, a w podpowiedzi premie: z bronią do walki wręcz lub gołymi rękami więcej zadawanych obrażeń, z łukiem celność, i o ile mniej obrażeń otrzymuje. Bohaterowi walka nie podnosi doświadczenia, chyba że misja to włącza.',
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
          p: 'Ustawienie lobby "Rozwój zawodów: Wszystkie od początku" znosi wymogi zawodów cywilnych i wyrobów. Zawody żołnierskie nie mają wymogów, a zakazy mapy zostają.',
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
