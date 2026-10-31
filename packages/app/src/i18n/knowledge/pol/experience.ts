import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Doświadczenie',
  items: [
    {
      id: 'exp-work',
      name: 'Doświadczenie w pracy',
      lead: 'Tor to osobny licznik doświadczenia dla jednego towaru: 100% przy drewnie nie przyspiesza kamienia.',
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
          p: 'Ułamek punktu nic nie daje. Przy [[article:gathering|zbieraniu]] doświadczenie skraca ciosy, sztuki dokłada w warsztacie i przy uboju. Tabele z narzędziem: [[article:tools|Narzędzia]]. Punkty budowy: [[article:construction|Budowa, rozbudowa, naprawa]].',
        },
        {
          h: 'Ile pracy trzeba',
        },
        {
          table: {
            head: ['Praca', 'Liczy się', 'Punkty za sztukę', 'Sztuk do 51%', 'Sztuk do 100%'],
            rows: [
              ['Drewno', 'ścięte drzewo', '2,5', 2, 65],
              ['Polowanie', 'sztuka z truchła', '2', 3, 81],
              ['Połów', 'ryba', '1,5', 4, 108],
              [
                'Glina, kamień, żelazo, złoto, grzyby, pszenica, ubój, warsztat',
                'sztuka, przy uboju zwierzę, w warsztacie partia',
                '1',
                5,
                162,
              ],
              ['Budowa, naprawa', 'cios, który coś dodał', '0,05', 100, 3240],
            ],
            num: [2, 3, 4],
            foot: 'Ostatnie kolumny liczą drzewa, sztuki, partie lub ciosy. Tor nazywa się jak praca i towar, np. Wydobywanie - Żelazo, Pieczenie - Chleb. Tory są takie same u wszystkich plemion.',
          },
        },
        {
          p: 'Każde drzewo, sztuka i partia dolicza też punkt do toru ogólnego zawodu, np. Wydobywanie. Tor ogólny otwiera kolejne [[article:trades|zawody]] i działa dla towaru bez własnego toru. Punkty zostają przy zmianie zawodu.',
        },
        {
          h: 'Kto nic nie zyskuje',
        },
        {
          list: [
            '[[job:carrier|Tragarz]] zbiera Noszenie, które nie przyspiesza pracy. 10 dostaw otwiera [[job:trader|Kupca]].',
            'Kupiec zbiera Handel, 1 punkt za rozładowaną sztukę. Handel niczego nie zmienia.',
            '[[job:scout|Zwiadowca]] nie zbiera punktów. [[job:woman|Kobieta]] i dziecko nie mają torów.',
            'Sadzenie, podlewanie, [[building:school|Szkoła]] i [[building:barracks|Koszary]] nie dają punktów.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Doświadczenie w walce',
      lead: 'Sto trafień jedną klasą broni podwaja obrażenia wręcz.',
      blocks: [
        {
          h: 'Obrażenia wręcz',
        },
        {
          table: {
            head: ['Trafienia', 'Mnożnik', 'Cios 1000 staje się'],
            rows: [
              [0, '×1', 1000],
              [10, '×1,05', 1052],
              [25, '×1,14', 1142],
              [50, '×1,33', 1333],
              [75, '×1,6', 1600],
              [100, '×2', 2000],
            ],
            num: [0, 1, 2],
            foot: 'Powyżej 100 trafień mnożnik nie rośnie.',
          },
        },
        {
          p: 'Mnożnik działa przy ciosie wręcz w ludzi, zwierzęta i budynki. Nie działa na [[article:walls|palisady]] i [[article:vehicles|pojazdy]] ani przy strzałach i [[article:catapult|katapulcie]].',
        },
        {
          h: 'Celność',
        },
        {
          p: 'Łuk i katapulta: 11% celnych strzałów przy 0 trafień, 100% przy 89. Tabela: [[article:aim|Trafienie i strzelanie]].',
        },
        {
          h: 'Co liczy się jako trafienie',
        },
        {
          p: 'Cios lub strzał, który zadał obrażenia, daje 1 punkt do klasy broni: Pięść, Włócznia, Miecz, Łuk lub Katapulta. Łuk [[job:hunter|Myśliwego]] to też Łuk. Strzał trafiający kilka celów liczy się raz.',
        },
        {
          p: 'Tor klasy nazywa się Walka - Klasa. Trafienia jednej klasy nie działają na inną i zostają przy zmianie zawodu.',
        },
        {
          h: 'Odkrycie broni',
        },
        {
          table: {
            head: ['Broń', 'Rzemieślnik', 'Wymóg'],
            rows: [
              ['[[good:spear_wooden|Drewniana Włócznia]]', '[[job:armorer|Płatnerz]]', 'brak'],
              ['[[good:spear_iron|Żelazna Włócznia]]', '[[job:smith|Kowal]]', '5 × Kowalstwo'],
              ['[[good:sword_shord|Krótki Miecz]]', '[[job:smith|Kowal]]', 'brak'],
              ['[[good:sword_long|Długi Miecz]]', '[[job:smith|Kowal]]', '5 × Kowalstwo'],
              ['[[good:bow_short|Krótki Łuk]]', '[[job:armorer|Płatnerz]]', 'brak'],
              ['[[good:bow_long|Długi Łuk]]', '[[job:armorer|Płatnerz]]', '10 × Wyrób Broni'],
            ],
            foot: 'Tak samo u wszystkich pięciu plemion.',
          },
        },
        {
          p: 'Trafienia nie blokują broni. Żołnierz bierze każdą broń, którą ma magazyn w zasięgu, także bez trafień, i od razu zostaje klasą tej broni. Próg 5 lub 10 trafień z [[article:trades|Zawodów i szkoły]] zapisuje tylko odkrycie klasy dla osady i otwiera jej wybór w "Zmiana zawodu".',
        },
        {
          h: 'Gwiazdka',
        },
        {
          p: 'Żołnierz nosi gwiazdkę od 25 trafień bronią, którą walczy. Rośnie co 25 trafień i jest największa przy 100.',
        },
        {
          h: 'Bohaterowie',
        },
        {
          p: 'Bohaterowi trafienia się nie liczą, jego obrażenia nie rosną. [[job:hero_axe|Bohater Topornik]] nie ma toru topora.',
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
      lead: 'Odkrycie należy do gracza i zostaje po śmierci pracownika, który je zdobył.',
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
          p: 'Wymóg z dwoma torami liczy ich sumę. [[job:builder|Budowniczy]], Zbieracz, [[job:farmer|Farmer]], [[job:hunter|Myśliwy]], [[job:fisher|Rybak]], [[job:carrier|Tragarz]] i [[job:scout|Zwiadowca]] są otwarci od początku.',
        },
        {
          p: 'Wyrób odkrywa się tak samo, np. [[good:furniture|Meble]] przy 10 × Ciesielstwo. Wymagania są takie same u wszystkich plemion.',
        },
        {
          h: 'Jak przebiega odkrycie',
        },
        {
          steps: [
            'Osadnik pracuje w zawodzie poprzednika, np. [[job:collector|Zbieracz]] przy drewnie.',
            'Po 10 ściętych drzewach spełnia wymóg [[job:joiner|Cieśli]] i gra ogłasza odkrycie.',
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
              ['Miejsca', '5', '25'],
              ['Uczy', 'cywilnego zawodu lub wyrobu', 'zawodu Żołnierza'],
              ['Czas', 'tabela niżej', '16,3 s'],
              ['Kto', 'dorosły mężczyzna', 'dorosły mężczyzna, także z zawodem'],
              ['Punkty doświadczenia', '0', '0'],
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
                '7 s',
              ],
              ['zawody i większość wyrobów', '11,7 s'],
              ['[[good:potion_heal_big|Duża Lecznicza Mikstura]]', '16,3 s'],
              ['[[good:handcart|Wózek Ręczny]]', '21 s'],
              ['[[good:oxcart|Zaprzęg]]', '25,7 s'],
              [
                '[[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]], [[good:catapult|Katapulta]]',
                '30,3 s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Zawód a miejsce pracy',
        },
        {
          p: 'Zawód i miejsce pracy to dwie osobne decyzje. "Zmiana zawodu" kasuje miejsce pracy i nikt nie przydzieli nowego sam. Wyjątek to absolwenci, gdy włączysz ich przełącznik w [[article:assistant|Asystencie]].',
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
            'Prawy klik na budynku ("Pracuj tutaj") zmienia zawód i daje miejsce pracy jednym rozkazem.',
            'Bez wymogu na zawód budynku osadnik zajmuje tam wolne miejsce Tragarza, o ile takie jest.',
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
              ['Miejsce pracy', 'Przepada.'],
              ['Liczniki produkcji', 'Przepadają.'],
              ['Niesiony towar', 'Spada na ziemię.'],
              ['Narzędzie', 'Zostaje. Przy wejściu do wojska nowe spada na ziemię, używane przepada.'],
              [
                'Broń i zbroja',
                'Przy wyjściu z wojska nieużywana rzecz trafia do rąk albo na ziemię. Używana przepada.',
              ],
              ['Rozkazy', 'Bieżący rozkaz i kolejka przepadają. "Jedzenie i sen" wraca na "Dozwolone".'],
              ['Poznane zawody', 'Zostają, także poprzedni zawód. Punkty doświadczenia też.'],
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
