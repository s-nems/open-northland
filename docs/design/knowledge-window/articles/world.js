export const GROUP = {
  group: 'Świat',
  items: [
    {
      id: 'vehicles',
      name: 'Pojazdy i statki',
      lead: 'Pojazd bez dowódcy stoi. Dowódca nie zajmuje miejsca pasażera, więc Statek zabiera 20 osób, a Statek handlowy 10.',
      blocks: [
        { data: 'vehicles' },
        { h: 'Szybkość z ładunkiem' },
        {
          table: {
            head: ['Pojazd', 'Ładunek', 'Utrata szybkości', 'Droga, kroki/s', 'Ląd, kroki/s'],
            rows: [
              ['[[good:handcart|Wózek Ręczny]]', 'pusty', '0%', '2,0', '1,5'],
              ['[[good:handcart|Wózek Ręczny]]', '15 z 15', '60%', '0,8', '0,6'],
              ['[[good:oxcart|Zaprzęg]]', 'pusty', '0%', '2,0', '1,5'],
              ['[[good:oxcart|Zaprzęg]]', '30 z 30', '15%', '1,7', '1,3'],
              ['[[good:catapult|Katapulta]]', '-', '0%', '1,0', '0,75'],
            ],
            num: [2, 3, 4],
            foot: 'Wózek i Zaprzęg liczone dla woźnicy bez butów, w butach jest szybciej. Statek nie zwalnia od ładunku i płynie około 2 kroków/s. Tragarz ciągnący wóz traci ten sam procent ze swojego chodu. Wybór wozu na trasę: [[article:trade|Handel]].',
          },
        },
        { h: 'Budowa' },
        {
          table: {
            head: ['Pojazd', 'Warsztat', 'Koszt'],
            rows: [
              [
                '[[good:handcart|Wózek Ręczny]]',
                '[[building:work_joinery_02|Warszt. ciesielski 3]], 4',
                '2 [[good:wood|Drewno]]',
              ],
              [
                '[[good:oxcart|Zaprzęg]]',
                '[[building:work_joinery_02|Warszt. ciesielski 3]], 4',
                '5 [[good:wood|Drewno]]',
              ],
              [
                '[[good:ship_small|Statek]]',
                '[[building:work_joinery_03|Warszt. ciesielski 4]]',
                '10 [[good:wood|Drewno]], 5 [[good:leather|Skóra]]',
              ],
              [
                '[[good:ship_big|Statek handlowy]]',
                '[[building:work_joinery_03|Warszt. ciesielski 4]]',
                '15 [[good:wood|Drewno]], 5 [[good:leather|Skóra]]',
              ],
              [
                '[[good:catapult|Katapulta]]',
                '[[building:work_joinery_03|Warszt. ciesielski 4]]',
                '9 [[good:wood|Drewno]], 1 [[good:iron|Żelazo]]',
              ],
            ],
            foot: '[[job:joiner|Cieśla]] stawia pojazd na placu obok warsztatu, statek na wodzie przy brzegu.',
          },
        },
        { h: 'Wół do Zaprzęgu' },
        {
          steps: [
            'Gotowy Zaprzęg ma stan "Czeka na zwierzę pociągowe".',
            'Bierze najbliższego dorosłego [[good:cattle|Wołu]] gracza z tego samego lądu, wolnego i spoza wnętrza Fermy.',
            'Każda Ferma zachowuje 2 pierwsze dorosłe sztuki. Bydło bez Fermy też zachowuje 2.',
            'Wół idzie do wozu i znika, a Zaprzęg rusza dopiero z nim.',
          ],
        },
        { h: 'Kto prowadzi' },
        {
          table: {
            head: ['Pojazd', 'Kto wsiada', 'Miejsca z dowódcą'],
            rows: [
              [
                '[[good:handcart|Wózek Ręczny]], [[good:oxcart|Zaprzęg]]',
                '[[job:carrier|Tragarz]], [[job:trader|Kupiec]]',
                '1',
              ],
              ['[[good:ship_small|Statek]]', 'każdy dorosły', '20'],
              ['[[good:ship_big|Statek handlowy]]', 'każdy dorosły', '10'],
              ['[[good:catapult|Katapulta]]', 'żołnierz, bohater', '1'],
            ],
            num: [2],
          },
        },
        {
          list: [
            'Pierwszy przypisany zostaje dowódcą. Po jego odejściu dowództwo przejmuje następny pasażer.',
            'Wsiadający traci miejsce pracy. Tragarz z posadą i Kupiec biorą wolny wóz jako narzędzie i posadę zachowują.',
            'Ładownię obsługuje dowódca albo Tragarz na pokładzie. Bez nich pojawia się "Brak tragarza".',
          ],
        },
        { h: 'Statki' },
        {
          list: [
            'Ładownia jest wspólna na wszystkie towary.',
            'Statek przewozi 1 pojazd: Wózek Ręczny, Zaprzęg albo Katapultę. Załoga pojazdu musi się zmieścić na pokładzie. Statek handlowy nie przewozi pojazdów.',
            '"Zacumuj" każe wskazać brzeg. Statek staje 4 kroki od wskazanego miejsca, budynek portowy nie jest potrzebny.',
            'Na morzu nikt nie wsiada ani nie wysiada.',
            'Ctrl/Cmd + klik cumuje i wysadza załogę.',
            'Pasażerowie pod 20% paska jedzą z ładowni, śpią i rozmawiają. Sen daje połowę wartości, Kupcowi, Zwiadowcy i żołnierzowi całość. Religia czeka na ląd.',
          ],
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: 'Dyplomacja',
      lead: 'Stosunek działa w jedną stronę: twój do nich i ich do ciebie to dwa osobne ustawienia.',
      blocks: [
        { h: 'Co daje stosunek' },
        {
          table: {
            head: ['Działanie', 'Wrogi', 'Neutralny', 'Przyjazny'],
            rows: [
              ['Atakujesz ich ludzi i budynki', 'tak', 'nie', 'nie'],
              ['[[job:scout|Zwiadowca]] zabiera ich Bydło i Owce', 'tak', 'nie', 'nie'],
              ['Handel [[job:trader|Kupca]] w ich budynku z ofertami', 'nie', 'nie', 'tak, obie strony'],
              ['Wspólny widok mapy', 'nie', 'nie', 'tak, obie strony'],
              ['Wspólna wygrana ostatnich na mapie', 'nie', 'nie', 'tak, obie strony'],
            ],
            foot: 'Wspólny widok wymaga też ustawienia "Wspólna mapa sojuszników" w ustawieniach rozgrywki.',
          },
        },
        { h: 'Co zmienia stosunek' },
        {
          table: {
            head: ['Zdarzenie', 'Skutek'],
            rows: [
              ['Start mapy', 'Mapa ustala stosunki, para bez wpisu zaczyna jako neutralna'],
              ['Cios od obcego', 'Stosunek ofiary do atakującego staje się wrogi'],
              ['Komputer neutralny, ty wrogi wobec niego', 'Komputer przechodzi na wrogi'],
              ['Komputer przyjazny, ty mniej przyjazny', 'Komputer schodzi do twojego stosunku'],
              ['Komputer wrogi', 'Sam nie wraca do pokoju'],
              ['Zapłacony trybut, wydarzenie misji', 'Może zmienić ich stosunek'],
              ['"Stosunek ustala scenariusz"', 'Nie zmienisz go w oknie Dyplomacja'],
            ],
          },
        },
        { h: 'Czas pokoju' },
        {
          list: [
            'Walka między graczami objętymi pokojem jest zablokowana.',
            'Do 60 kroków od budynku partnera nie ma rozkazów wejścia i budowy. Miejsce bliżej twojego budynku niż budynku partnera pozostaje dostępne.',
            'Ostrzeżenia przychodzą 5 min i 1 min przed końcem.',
          ],
        },
        { h: 'Pierwszy kontakt' },
        {
          p: 'Pod mgłą plemię trafia do okna Dyplomacja, gdy zobaczysz jego człowieka, budynek, pojazd lub palisadę albo gdy cię uderzy. Kontakt nie wygasa.',
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Mgła i widzenie',
      lead: 'Żołnierz atakuje też wroga stojącego we mgle. Katapulta sama strzela tylko do widocznych celów.',
      blocks: [
        { h: 'Zasięg widzenia' },
        {
          table: {
            head: ['Kto', 'Zasięg, kroki'],
            rows: [
              ['[[job:scout|Zwiadowca]], [[building:headquarters|Kwatera główna]]', '30'],
              ['Bohater, [[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]]', '25'],
              ['Żołnierz, budynek, także wieża i dom', '20'],
              ['[[good:handcart|Wózek Ręczny]], [[good:oxcart|Zaprzęg]], [[good:catapult|Katapulta]]', '20'],
              ['Dorosły cywil, Kobieta, własne zwierzę', '15'],
              ['Dziecko', '10'],
              ['Plac budowy', '0'],
            ],
            num: [1],
            foot: 'Kroki liczone w poziomie. Pole widzenia to koło na ekranie, więc w pionie sięga około 1,8 raza więcej kroków. Palisada, droga i drogowskaz nie widzą.',
          },
        },
        { h: 'Tryby mapy' },
        {
          table: {
            head: ['Ustawienie', 'Start', 'Teren poza wzrokiem'],
            rows: [
              ['Odkryta', 'wszystko widać', 'bez mgły'],
              ['Klasyczna', 'czarna mapa', 'raz odkryty pozostaje widoczny'],
              ['Klasyczna + Mgła wojny', 'czarna mapa', 'szary teren, bez jednostek'],
              ['Rozpoznanie', 'szary teren, bez jednostek', 'raz odkryty pozostaje widoczny'],
              ['Rozpoznanie + Mgła wojny', 'szary teren, bez jednostek', 'szary teren, bez jednostek'],
            ],
          },
        },
        {
          p: 'Szary teren pokazuje budynki, palisady, pojazdy, skrzynie, surowce, pnie i stosy towarów w stanie z ostatniego zobaczenia. Ludzi i zwierząt nie pokazuje. Ta pamięć jest też na minimapie i w zapisie gry.',
        },
        { h: 'Walka we mgle' },
        {
          table: {
            head: ['Kto', 'Wróg we mgle'],
            rows: [
              ['Żołnierz w Ataku, do 18 kroków', 'Znajduje go i atakuje'],
              ['Żołnierz w Obronie, do 18 kroków od punktu postawy', 'Znajduje go i atakuje'],
              ['[[job:hunter|Myśliwy]]', 'Poluje bez względu na mgłę'],
              ['[[good:catapult|Katapulta]] sama wybierająca cel', 'Nie strzela'],
            ],
          },
        },
      ],
      see: ['article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Dzikie zwierzęta i polowanie',
      lead: 'Agresywne stado rzuca się na ludzi w promieniu 20 kroków od swojego miejsca, a za 40 krokami wraca.',
      blocks: [
        { data: 'animals' },
        { h: 'Agresja' },
        {
          table: {
            head: ['Grupa', 'Zwierzęta', 'Zachowanie'],
            rows: [
              ['Agresywne', 'Wilk, Lew, Lwica, Niedźwiedź Polarny', 'Atakują same'],
              [
                'Rozwścieczone po ciosie',
                'Niedźwiedź, Słoń',
                'Złość trwa 20 s od ostatniego ciosu, zaczęty atak trwa do śmierci celu albo jego schronienia',
              ],
              ['Płochliwe', 'Pozostałe', 'Uderzony przywódca ucieka do 20 kroków, stado za nim'],
            ],
            foot: 'Dzika Koza nie atakuje i nie ucieka.',
          },
        },
        {
          list: [
            'Cios alarmuje zwierzęta tego gatunku do 20 kroków wokół uderzonego.',
            'Kolejność ofiar: żołnierze i bohaterowie, rozwścieczone zwierzęta, inni ludzie, pozostałe zwierzęta.',
            'Budynków i pojazdów zwierzęta nie atakują.',
          ],
        },
        { h: 'Na co poluje Myśliwy' },
        {
          list: [
            'Teren łowiecki to 50 kroków od flagi roboczej albo miejsca pracy. Pościg wychodzi poza teren o 4 kroki.',
            'Wybiera cel o najniższej sumie odległości w krokach i aktualnego zdrowia.',
            'Poluje na 1 ofiarę naraz, nową bierze dopiero po zebraniu zdobyczy.',
            'Łuk Myśliwego zabiera 525 na strzał, zasięg 3-17 kroków.',
            'Dorosłej Dzikiej Kozy sam nie weźmie, jej młode są zwierzyną.',
            'Pomija zwierzęta z właścicielem, rozwścieczone oraz stojące na innym lądzie.',
          ],
        },
        { h: 'Zdobycz' },
        {
          table: {
            head: ['Zwierzę', 'Zabił Myśliwy', 'Zabił ktoś inny'],
            rows: [
              ['Dorosłe', '2 [[good:leather|Skóra]], 2 [[good:meat|Mięso]]', '1 [[good:meat|Mięso]]'],
              ['Młode', '1 [[good:leather|Skóra]], 1 [[good:meat|Mięso]]', 'nic'],
              ['Koń dorosły', '1 [[good:leather|Skóra]], 1 [[good:meat|Mięso]]', '1 [[good:meat|Mięso]]'],
              ['Koń młody', '1 [[good:leather|Skóra]]', 'nic'],
            ],
          },
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Hodowla',
      lead: 'Hodowca rozmnaża tylko przy dokładnie 2 dorosłych sztukach gatunku. Trzecia dorosła idzie na ubój.',
      blocks: [
        { h: 'Stan Fermy' },
        {
          table: {
            head: ['Komunikat', 'Znaczenie'],
            rows: [
              ['"Brak zwierząt"', 'Zero sztuk gatunku, potrzebny Zwiadowca'],
              ['"Tylko jedno zwierzę"', 'Potrzebna druga sztuka'],
              ['"Młode dorastają"', 'Hodowla ruszy, gdy para dorośnie'],
              ['"Stado pełne"', 'Hodowca czeka na dorosłe młode'],
            ],
          },
        },
        { h: 'Młode i ubój' },
        {
          table: {
            head: ['Zwierzę', 'Młode kosztuje', 'Ubój daje', 'Czas'],
            rows: [
              [
                '[[good:sheep|Owca]]',
                '1 [[good:water|Woda]], 2 [[good:wheat|Pszenica]]',
                '1 [[good:wool|Wełna]], 2 [[good:meat|Mięso]]',
                '8 s',
              ],
              [
                '[[good:cattle|Wół]]',
                '1 [[good:water|Woda]], 2 [[good:wheat|Pszenica]]',
                '2 [[good:leather|Skóra]], 2 [[good:meat|Mięso]]',
                '8 s',
              ],
            ],
            num: [3],
            foot: 'Młode i ubój trwają po 8 s. Wybór produkcji Hodowcy decyduje, którym gatunkiem się zajmuje. Na Fermie mieści się po 30 sztuk Mięsa, Wełny i Skóry.',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|Ferma bydła]] mieści 20 sztuk łącznie, oba gatunki i młode w drodze.',
            'Młode dorasta 300 s (5 min) i nie liczy się do pary.',
            'Rodzic musi być do 40 kroków od drzwi Fermy przy narodzinach. Dalej: stracony surowiec i brak młodego.',
            'Załoga Fermy to 2 [[job:breeder|Hodowców]] i 1 [[job:carrier|Tragarz]].',
          ],
        },
        { h: 'Skąd wziąć zwierzęta' },
        {
          table: {
            head: ['Kto', 'Co robi', 'Zasięg, kroki'],
            rows: [
              ['[[job:scout|Zwiadowca]]', 'Każdy jego krok przejmuje dzikie Bydło i Owce', '2'],
              ['[[job:scout|Zwiadowca]]', 'To samo ze stadem gracza, wobec którego masz stosunek wrogi', '2'],
              ['[[job:scout|Zwiadowca]]', 'Pozostałe wrogie stado w pobliżu rozbiega się', '6'],
              [
                '[[job:breeder|Hodowca]]',
                'Zabiera do Fermy najbliższe twoje zwierzę bez Fermy',
                'ten sam ląd',
              ],
              [
                '[[job:breeder|Hodowca]]',
                'Poniżej pary bierze sztukę z innej twojej Fermy, która ma więcej niż parę',
                'ten sam ląd',
              ],
            ],
            foot: 'Zwiadowca stojący w miejscu nic nie przejmuje.',
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religia i świątynia',
      lead: 'Pasek Religii spada wyłącznie przy produkcji broni i zbroi. Przy 0% rzemieślnik nie zacznie partii, która kosztuje Religię.',
      blocks: [
        { h: 'Koszt partii' },
        {
          table: {
            head: ['Zawód', 'Towar', 'Religia', 'Czas'],
            rows: [
              [
                '[[job:armorer|Płatnerz]]',
                '[[good:bow_short|Krótki Łuk]], [[good:spear_wooden|Drewniana Włócznia]]',
                '15%',
                '12,5 s',
              ],
              ['[[job:armorer|Płatnerz]]', '[[good:bow_long|Długi Łuk]]', '30%', '16,7 s'],
              [
                '[[job:smith|Kowal]]',
                '[[good:spear_iron|Żelazna Włócznia]], [[good:sword_shord|Krótki Miecz]]',
                '15%',
                '20 s',
              ],
              [
                '[[job:smith|Kowal]]',
                '[[good:sword_long|Długi Miecz]], [[good:armor_chain|Kolczuga]], [[good:armor_plate|Zbroja Płytowa]]',
                '30%',
                '20 s',
              ],
              [
                '[[job:sewer|Krawiec]]',
                '[[good:armor_wool|Tunika]], [[good:armor_leather|Skórzana Zbroja]]',
                '15%',
                '13,3 s',
              ],
            ],
            num: [2, 3],
            foot: 'Tak samo we wszystkich plemionach. Inne towary tych zawodów nie zużywają Religii.',
          },
        },
        {
          list: [
            'Pod 20% Płatnerz i Kowal idą się modlić, a bez miejsca modlitwy przy 10% pada komunikat "Chce się modlić".',
            'Krawiec sam nie idzie, trzeba mu kazać "Módl się".',
            'Przy 0% rzemieślnik dokończy opłaconą partię.',
          ],
        },
        { h: 'Gdzie się modlić' },
        {
          table: {
            head: ['Miejsce', 'Warunek'],
            rows: [
              ['Dom', 'Płonie w nim święty ogień, zawsze pierwszy wybór'],
              ['[[building:work_temple|Świątynia]]', 'Gotowa, twoja'],
              ['[[building:headquarters|Kwatera główna]]', 'Gotowa, twoja'],
            ],
            foot: 'Modlitwa trwa 8,3 s i daje +40% Religii. Dom bez ognia i obcy budynek nie działają.',
          },
        },
        { h: 'Święty ogień' },
        {
          list: [
            'Działa od Domu 3.',
            '1 sztuka [[good:holy_oil|Oliwy]] to 1000 punktów. Ogień mieści 5000 punktów i spala 3 punkty na sekundę.',
            '1 sztuka starcza na 5 min 33 s, pełny ogień na 28 min.',
            'Dom prosi o dostawę poniżej 3000 punktów.',
          ],
        },
        { h: 'Aura Świątyni' },
        {
          table: {
            head: ['Działanie', 'Wartość'],
            rows: [
              ['Zasięg', '50 kroków'],
              ['Zdrowie', '+50 na sekundę, do 7500'],
              ['Religia', '+2,5% na sekundę, gdy pasek ma do 80%'],
              ['Kto', 'Wszyscy ludzie właściciela Świątyni. Dzieci dostają zdrowie'],
              ['Warunek', 'Świątynia gotowa i bez uszkodzeń'],
              ['Kilka Świątyń', 'Działa jedna aura, wartości się nie sumują'],
            ],
            foot: 'Zdrowie ponad 5000 zostaje, dopóki nie zabiorą go rany.',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: 'Skrzynie i papiery',
      lead: 'Papiery ze skrzyń stawiają budynek od razu, bez budowy, materiałów i wymaganych odkryć.',
      blocks: [
        { h: 'Kto otwiera' },
        {
          table: {
            head: ['Skrzynia', 'Kto'],
            rows: [
              ['Skrzynia', 'każdy dorosły'],
              ['Magiczna skrzynia', '[[job:druid|Druid]], bohater'],
            ],
            foot: 'Rozkaz "Otwórz skrzynię". Osadnika obowiązuje jego zasięg chodu. Towary spadają obok skrzyni.',
          },
        },
        { h: 'Zawartość' },
        {
          table: {
            head: ['Nagroda', 'Skrzynia', 'Magiczna'],
            rows: [
              ['Mikstura albo amulet, 1 rodzaj', '1', '3'],
              ['Duże mikstury, 1 rodzaj', '12', '18'],
              [
                '[[good:armor_chain|Kolczuga]], [[good:armor_plate|Zbroja Płytowa]] albo [[good:shoes|Buty]]',
                '6',
                '9',
              ],
              ['[[good:bread|Żywność]]', '30', '48'],
              ['[[good:catapult|Katapulta]]', '1', '1'],
              [
                '3 Cywili, 3 Kobiety, 3 wojowników z długim mieczem albo 3 łuczników z długim łukiem',
                '3',
                '3',
              ],
              ['5 Wilków albo 3 Lwy, stado dzikie', '5 albo 3', '5 albo 3'],
            ],
            num: [1, 2],
            foot: 'Mapa wybiera zawartość każdej skrzyni.',
          },
        },
        { h: 'Papiery' },
        {
          table: {
            head: ['Papier', 'Działanie'],
            rows: [
              ['Umieść wybrany przez ciebie budynek', 'Dowolny budynek z katalogu, stanie od razu'],
              ["Umieść 'nazwa'", 'Wskazany budynek, stanie od razu'],
              ["Umieść 'nazwa' i zapełnij jego skład", 'Wskazany budynek ze składem pełnym po brzegi'],
            ],
            foot: 'Papier znika po użyciu, odmowa miejsca go nie zużywa. Lista mieści 100 papierów, nadmiar przepada. Znajdziesz ją w oknie budowy pod "Papiery".',
          },
        },
        {
          p: 'Budynki na papierach: [[building:home_level_01|Dom 2]], [[building:home_level_04|Dom 5]], [[building:stock_02|Magazyn 3]], [[building:headquarters|Kwatera główna]], [[building:work_well_00|Studnia]], [[building:work_farm_00|Farma]], [[building:work_mill_00|Młyn]], [[building:work_bakery_00|Piekarnia 1]], [[building:work_temple|Świątynia]], [[building:school|Szkoła]], [[building:barracks|Koszary]], [[building:tower_01|Wieża obronna 2]].',
        },
        { h: 'Papiery z warsztatem' },
        {
          table: {
            head: ['Budynek ze składem', 'Osadnik', 'Odkrywa na stałe'],
            rows: [
              [
                '[[building:work_smithy_01|Kuźnia 2]]',
                '1 [[job:smith|Kowal]]',
                '[[good:sword_long|Długi Miecz]]',
              ],
              [
                '[[building:work_armory_00|Warszt. płatnerski 1]]',
                '1 [[job:armorer|Płatnerz]]',
                '[[good:bow_short|Krótki Łuk]]',
              ],
              ['[[building:work_coin_mint|Mennica]]', '1 [[job:coin_maker|Mincerz]]', '[[good:coin|Moneta]]'],
              [
                '[[building:work_druid_00|Chatka alchemika 1]]',
                '1 [[job:druid|Druid]]',
                '[[good:holy_oil|Oliwa]]',
              ],
              [
                '[[building:work_druid_01|Chatka alchemika 2]]',
                '1 [[job:druid|Druid]]',
                '[[good:holy_oil|Oliwa]], małe mikstury',
              ],
            ],
            foot: 'Taka skrzynia daje papier, osadnika w tym zawodzie i dostęp do zawodu.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
