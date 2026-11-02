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
          p: 'Tabela podaje zwykłą pracę. Drewno, polowanie, połów i budowa liczą się inaczej, ich mnożnik jest w tabeli niżej. Przy [[article:gathering|zbieraniu]] doświadczenie daje mniej uderzeń na sztukę. W warsztacie i przy uboju dokłada dodatkowe sztuki. Tabele z narzędziem: [[article:tools|Narzędzia]]. Budowa: [[article:construction|Budowa, rozbudowa, naprawa]].',
        },
        {
          p: 'Zaznaczony własny osadnik nosi gwiazdkę fachu. Pojawia się przy {{star.step}}% najlepszej umiejętności zawodu i rośnie co {{star.step}}%, aż do {{star.full}}%. Tragarz jej nie ma.',
        },
        {
          h: 'Ile pracy trzeba',
        },
        {
          table: {
            head: ['Praca', 'Liczy się', 'Mnożnik', 'Razy do {{exp.quotedPct}}%', 'Razy do 100%'],
            rows: [
              [
                'Drewno',
                'ścięte drzewo',
                '×{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                'Polowanie',
                'sztuka z truchła',
                '×{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                'Połów',
                'ryba',
                '×{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                'Glina, kamień, żelazo, złoto, grzyby, zioła, pszenica, ubój, warsztat',
                'sztuka, przy uboju zwierzę, w warsztacie cykl',
                '×{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Budowa, naprawa',
                'uderzenie, które coś dodało',
                '×{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: 'Ostatnie kolumny liczą drzewa, sztuki, cykle lub uderzenia. Od {{exp.quotedPct}}% [[job:builder|Budowniczy]] bez narzędzia potrzebuje o połowę mniej uderzeń na sztukę materiału. W panelu osadnika, w Doświadczeniu, każda umiejętność ma własny wiersz, np. Wydobywanie - Żelazo: {{exp.craft.repeatsQuoted}} razy, wydajność +{{exp.quotedPct}}%.',
          },
        },
        {
          p: 'Każde drzewo, sztuka i cykl liczy się też do ogólnej umiejętności zawodu, np. Rolnictwa. Zawód otwiera ona albo umiejętność jednego towaru: Rolnictwo otwiera [[job:miller|Młynarza]], a Zbieranie - Drewno [[job:joiner|Cieślę]]. Wymogi: [[article:trades|Zawody i szkoła]]. Ogólna umiejętność działa też przy towarze, który nie ma własnej. Doświadczenie zostaje przy zmianie zawodu.',
        },
        {
          h: 'Kto nic nie zyskuje',
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
            head: ['Trafienia', 'Mnożnik', 'Cios {{combat.sampleBlow}} staje się'],
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
          p: 'Łuk i katapulta: {{aim.basePct}}% celnych strzałów przy 0 trafień, od {{aim.noSpreadHits}} trafień każdy strzał spada w cel. Tabela: [[article:aim|Trafienie i strzelanie]].',
        },
        {
          h: 'Co liczy się jako trafienie',
        },
        {
          p: 'Trafienie to cios lub strzał, który zadał obrażenia. Liczy się osobno dla każdego rodzaju broni: Pięść, Włócznia, Miecz, Łuk, Katapulta. Łuk [[job:hunter|Myśliwego]] to też Łuk. Strzał trafiający kilka celów liczy się raz.',
        },
        {
          p: 'W panelu osadnika to wiersze Walka - Miecz, Walka - Łuk i tak dalej. Trafienia mieczem nie pomagają włócznikowi i zostają po zmianie zawodu. Bohaterowi walka nie podnosi obrażeń, chyba że pozwala na to misja.',
        },
        {
          h: 'Odkrycie broni',
        },
        {
          table: {
            head: ['Broń', 'Rzemieślnik', 'Wymóg'],
            rows: [
              ['[[good:spear_wooden|Drewniana Włócznia]]', '[[job:armorer|Płatnerz]]', 'brak'],
              [
                '[[good:spear_iron|Żelazna Włócznia]]',
                '[[job:smith|Kowal]]',
                'Kowalstwo: {{exp.ironSpearNeed}} razy',
              ],
              ['[[good:sword_shord|Krótki Miecz]]', '[[job:smith|Kowal]]', 'brak'],
              [
                '[[good:sword_long|Długi Miecz]]',
                '[[job:smith|Kowal]]',
                'Kowalstwo: {{exp.longSwordNeed}} razy',
              ],
              ['[[good:bow_short|Krótki Łuk]]', '[[job:armorer|Płatnerz]]', 'brak'],
              [
                '[[good:bow_long|Długi Łuk]]',
                '[[job:armorer|Płatnerz]]',
                'Wyrób Broni: {{exp.longBowNeed}} razy',
              ],
            ],
          },
        },
        {
          p: 'Do wzięcia broni trafienia nie są potrzebne: żołnierz bierze każdą broń z magazynu w zasięgu i od razu walczy jako Miecznik, Włócznik czy Łucznik. Próg {{exp.classLowNeed}} lub {{exp.classHighNeed}} trafień tylko odkrywa ten rodzaj żołnierza dla osady i otwiera go w "Zmiana zawodu": [[article:trades|Zawody i szkoła]].',
        },
        {
          h: 'Gwiazdka',
        },
        {
          p: 'Żołnierz nosi gwiazdkę od {{star.step}} trafień bronią, którą walczy. Rośnie co {{star.step}} trafień i jest największa przy {{star.full}}. Widać ją u każdego żołnierza, także wroga.',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
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
          h: 'Jak przebiega odkrycie',
        },
        {
          steps: [
            'Osadnik pracuje, np. [[job:collector|Zbieracz]] ścina drzewa.',
            'Po {{exp.joinerNeed}} ściętych drzewach spełnia wymóg [[job:joiner|Cieśli]] i gra ogłasza odkrycie.',
            'Zawód jest odkryty dla całej osady, a ten osadnik może go objąć od razu.',
            'Pozostali idą do [[building:school|Szkoły]] albo zdobywają ten sam wymóg pracą.',
          ],
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
            foot: 'Ponad liczbę miejsc uczniowie czekają pod drzwiami w kolejności zapisów.',
          },
        },
        {
          list: [
            'Potrzeby przerywają kurs bez straty postępu. Anulowanie kasuje postęp.',
            'Uczeń wysłany do Szkoły w budowie donosi materiał i czeka.',
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
          p: '"Zmiana zawodu" kasuje miejsce pracy, a nowego nikt nie przydzieli sam. Wyjątek: absolwenci, gdy włączysz ich przełącznik w [[article:assistant|Asystencie]].',
        },
        {
          table: {
            head: ['Zawód', 'Budynek', 'Bez budynku'],
            rows: [
              ['[[job:builder|Budowniczy]]', 'niepotrzebny', 'Sam idzie na plac budowy.'],
              ['[[job:scout|Zwiadowca]]', 'niepotrzebny', 'Działa na rozkazy.'],
              ['[[job:trader|Kupiec]]', 'niepotrzebny', 'Jeździ swoją [[article:trade|trasą]].'],
              ['[[job:civilist|Cywil]]', 'niepotrzebny', 'Nie pracuje, czeka na przydział.'],
              [
                '[[job:collector|Zbieracz]], [[job:hunter|Myśliwy]], [[job:fisher|Rybak]]',
                'do wyboru',
                'Pracuje od [[article:work-flag|flagi roboczej]], która staje mu pod nogami przy objęciu zawodu.',
              ],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]', 'wymagany', 'Nie uprawia pola.'],
              ['[[job:carrier|Tragarz]]', 'wymagany', 'Nic nie nosi.'],
              ['Pozostałe zawody cywilne', 'wymagany', 'Stoi bezczynnie.'],
            ],
          },
        },
        {
          list: [
            'Prawy klik na budynku ("Pracuj tutaj") od razu zmienia zawód i daje miejsce pracy.',
            'Osadnik bez wymogu na zawód tego budynku zajmuje tam wolne miejsce Tragarza, jeśli jest.',
            'Żołnierz bierze tylko miejsce w swoim zawodzie.',
            '"Usuń miejsce pracy" zostawia zawód i niesiony towar. Zabiera liczniki produkcji i wózek Tragarza.',
            'Zburzenie budynku też zostawia zawód.',
            'Kobieta, dziecko i bohater nigdy nie dostają zawodu.',
          ],
        },
        {
          h: 'Co kosztuje zmiana zawodu',
        },
        {
          table: {
            head: ['Rzecz', 'Co się z nią dzieje'],
            rows: [
              ['Miejsce pracy i liczniki produkcji', 'Przepadają.'],
              ['Niesiony towar', 'Spada na ziemię.'],
              ['Narzędzie', 'Zostaje. Przy wejściu do wojska nowe spada na ziemię, używane przepada.'],
              ['Broń i zbroja', 'Przy wyjściu z wojska trafia do rąk albo na ziemię.'],
              ['Rozkazy', 'Bieżący rozkaz i kolejka przepadają. "Jedzenie i sen" wraca na "Dozwolone".'],
              ['Poznane zawody', 'Zostają, także poprzedni zawód. Doświadczenie też.'],
            ],
            foot: 'Szkoła i Koszary zmieniają zawód tak samo, ale kolejka rozkazów zostaje. Tragarz zostawia wózek.',
          },
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
