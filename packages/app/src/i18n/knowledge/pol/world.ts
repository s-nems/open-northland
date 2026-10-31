import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Świat',
  items: [
    {
      id: 'goals',
      name: 'Cele misji i koniec gry',
      lead: 'Gracz odpada, gdy nie ma ani jednego żywego dorosłego mężczyzny. Liczy się dorosły mężczyzna i Bohater. Kobieta i Cyra nie, dzieci też nie.',
      blocks: [
        {
          h: 'Kto rozstrzyga',
        },
        {
          table: {
            head: ['Mapa', 'Wygrana', 'Porażka'],
            rows: [
              [
                'Mapa wieloosobowa, także grana samotnie',
                'Cel z listy mapy',
                'Brak dorosłego mężczyzny, cel przegranej ze skryptu',
              ],
              ['Misja fabularna', 'Skrypt mapy', 'Skrypt mapy, brak dorosłego mężczyzny'],
              ['Mapa bez skryptu', 'Ostatni na mapie', 'Brak dorosłego mężczyzny'],
            ],
          },
        },
        {
          h: 'Cele mapy wieloosobowej',
        },
        {
          table: {
            head: ['Cel', 'Co się liczy', 'Wynik'],
            rows: [
              [
                'Towary',
                'Zapas na półkach budynków. Stosy na ziemi, ładownie i towar w rękach się nie liczą',
                'Wygrana przy pełnej liście ilości',
              ],
              ['"Mieszkańcy"', 'Każdy człowiek gracza, także dzieci', 'Wygrana przy wymaganej liczbie'],
              [
                '"Żołnierze"',
                'Dorośli mężczyźni w zawodzie żołnierza, bez bohaterów',
                'Wygrana przy wymaganej liczbie',
              ],
              ['Wygrana ze skryptu', 'Wydarzenie misji nazywa gracza', 'Wygrana'],
              ['Przegrana ze skryptu', 'Wydarzenie misji nazywa gracza', 'Porażka'],
              [
                'Ostatni na mapie',
                'Choć jeden rywal odpadł, a pozostali są wzajemnymi przyjaciółmi: [[article:diplomacy|Dyplomacja]]',
                'Wygrana wszystkich pozostałych',
              ],
            ],
            foot: 'Postęp towarów, "Mieszkańców" i "Żołnierzy" gra pokazuje jako obecne/wymagane. Ostatni na mapie działa, gdy mapa nie ma celu towarów, ludzi ani wyniku ze skryptu.',
          },
        },
        {
          list: [
            'Najpierw liczy się brak mężczyzn, potem lista w kolejności z mapy.',
            'Pierwszy spełniony warunek rozstrzyga o graczu na stałe. Zwycięzca, który potem straci ludzi, nadal jest zwycięzcą.',
            'Wygrana jednego gracza nie kończy gry pozostałym.',
            'Mapa może zwolnić wskazanego gracza z zasady o dorosłym mężczyźnie.',
          ],
        },
        {
          h: 'Co zostaje po pokonanym',
        },
        {
          steps: [
            'Brak dorosłego mężczyzny: pojazdy znikają od razu.',
            'Porażka zapada na najbliższym sprawdzeniu celów.',
            'Na kolejnym znikają budynki, ludzie, pojazdy i drogowskazy.',
            'Zwierzęta gracza dziczeją tam, gdzie stoją.',
          ],
        },
        {
          p: 'Tak jest na mapie wieloosobowej. W misji fabularnej i na mapie bez skryptu znikają tylko pojazdy, a komputer przestaje grać. Budynki i ludzie zostają.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Pojazdy i statki',
      lead: 'Pojazd bez dowódcy stoi. Statek zabiera 20 osób, Statek handlowy 10, razem z dowódcą.',
      blocks: [
        {
          data: 'vehicles',
        },
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
            'Wsiadający traci miejsce pracy. Tragarz z miejscem pracy i Kupiec biorą wolny wóz jako narzędzie i miejsce pracy zachowują.',
            'Ładownię obsługuje dowódca albo Tragarz na pokładzie. Bez nich pojawia się "Brak tragarza".',
          ],
        },
        {
          h: 'Szybkość z ładunkiem',
        },
        {
          table: {
            head: ['Pojazd', 'Utrata, pełny', 'Droga: pusty', 'Droga: pełny', 'Ląd: pusty', 'Ląd: pełny'],
            rows: [
              ['[[good:handcart|Wózek Ręczny]]', '60%', '2,0', '0,8', '1,5', '0,6'],
              ['[[good:oxcart|Zaprzęg]]', '15%', '2,0', '1,7', '1,5', '1,3'],
              ['[[good:catapult|Katapulta]]', '-', '1,0', '-', '0,75', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Kroki na sekundę. Pełny to 15 z 15 na Wózku i 30 z 30 na Zaprzęgu. Liczone dla woźnicy bez butów, w butach jest szybciej. Statek nie zwalnia od ładunku i płynie około 2 kroków/s. Tragarz ciągnący wóz traci ten sam procent ze swojego chodu. Wybór wozu na trasę: [[article:trade|Handel]].',
          },
        },
        {
          h: 'Budowa',
        },
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
        {
          h: 'Wół do Zaprzęgu',
        },
        {
          steps: [
            'Gotowy Zaprzęg ma stan "Czeka na zwierzę pociągowe".',
            'Bierze najbliższego dorosłego [[good:cattle|Wołu]] gracza z tego samego lądu, wolnego i spoza wnętrza Fermy.',
            'Każda Ferma zachowuje 2 pierwsze dorosłe sztuki. Woły bez Fermy też zachowują 2.',
            'Wół idzie do wozu i znika, a Zaprzęg rusza dopiero z nim.',
          ],
        },
        {
          h: 'Statki',
        },
        {
          list: [
            'Ładownia jest wspólna na wszystkie towary.',
            'Statek przewozi 1 pojazd: Wózek Ręczny, Zaprzęg albo Katapultę. Załoga pojazdu musi się zmieścić na pokładzie. Statek handlowy nie przewozi pojazdów.',
            '"Zacumuj" każe wskazać brzeg. Statek staje 4 kroki od wskazanego miejsca, budynek portowy nie jest potrzebny.',
            'Na morzu nikt nie wsiada ani nie wysiada.',
            'Ctrl/Cmd + klik cumuje i wysadza załogę.',
          ],
        },
        {
          h: 'Ładownia',
        },
        {
          list: [
            '"cel": ile sztuk ma być w ładowni. Suma celów nie przekroczy pojemności.',
            '"w rękach tragarza": wóz ciągnie Tragarz z miejscem pracy i wiezie to, co podnosi w każdym kursie. Cele są zablokowane.',
            'Dowódca albo Tragarz wysiada, gdy wóz stoi albo statek cumuje. Na morzu nikt nie pracuje.',
            'Bierze po 1 sztuce: stos, budynek do 40 kroków, potem dalej.',
            'Źródło musi leżeć na lądzie, na którym stoją drzwi. Jedzenia z domu nie bierze.',
            'Cel 0 albo niższy od zawartości: nadmiar idzie do najbliższego Magazynu lub Kwatery głównej z miejscem, do 40 kroków od drzwi. Gdy takich brak, ląduje na ziemi.',
            'Dowódca bez Tragarza na pokładzie obniża cel, gdy towaru nie ma skąd wziąć. Z Tragarzem cel zostaje.',
            'Rozkaz jazdy woła załogę na pokład przed odjazdem.',
          ],
        },
        {
          h: 'Utrata pojazdu',
        },
        {
          table: {
            head: ['Stan', 'Załoga na pokładzie', 'Przewożony pojazd', 'Ładunek'],
            rows: [
              [
                'Wóz, [[good:catapult|Katapulta]]',
                'Wysiada przy drzwiach',
                '-',
                'Rozsypany do 10 kroków wokół',
              ],
              ['Statek cumuje', 'Wysiada na brzeg', 'Staje przy drzwiach', 'Przepada'],
              ['Statek na morzu', 'Tonie', 'Tonie razem ze swoją załogą', 'Przepada'],
            ],
            foot: 'Załogi na pokładzie nie da się trafić, dopóki kadłub stoi. Kto stoi poza pokładem, traci tylko przydział.',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: 'Dyplomacja',
      lead: 'Stosunek działa w jedną stronę: twój do nich i ich do ciebie to dwa osobne ustawienia.',
      blocks: [
        {
          h: 'Co daje stosunek',
        },
        {
          table: {
            head: ['Działanie', 'Wrogi', 'Neutralny', 'Przyjazny'],
            rows: [
              ['Atakujesz ich ludzi i budynki', 'tak', 'nie', 'nie'],
              ['[[job:scout|Zwiadowca]] zabiera ich Woły i Owce', 'tak', 'nie', 'nie'],
              ['Handel [[job:trader|Kupca]] w ich budynku z ofertami', 'nie', 'nie', 'tak, obie strony'],
              ['Wspólny widok mapy', 'nie', 'nie', 'tak, obie strony'],
              ['Wspólna wygrana ostatnich na mapie', 'nie', 'nie', 'tak, obie strony'],
            ],
            foot: 'Wspólny widok wymaga też ustawienia "Wspólna mapa sojuszników" w ustawieniach rozgrywki.',
          },
        },
        {
          h: 'Co zmienia stosunek',
        },
        {
          table: {
            head: ['Zdarzenie', 'Skutek'],
            rows: [
              ['Start mapy', 'Mapa ustala stosunki, para bez wpisu zaczyna jako neutralna'],
              ['Cios od obcego', 'Stosunek ofiary do atakującego staje się wrogi'],
              ['Komputer neutralny, ty wrogi wobec niego', 'Komputer przechodzi na wrogi'],
              ['Obniżysz stosunek do przyjaznego komputera', 'Komputer też obniży, do twojego poziomu'],
              ['Komputer wrogi', 'Sam nie wraca do pokoju'],
              ['Zapłacony trybut, wydarzenie misji', 'Może zmienić ich stosunek'],
              ['"Stosunek ustala scenariusz"', 'Nie zmienisz go w oknie Dyplomacja'],
            ],
          },
        },
        {
          h: 'Czas pokoju',
        },
        {
          list: [
            'Walka między graczami objętymi pokojem jest zablokowana.',
            'Nie wejdziesz ani nie zbudujesz do 60 kroków od budynku partnera, chyba że bliżej ci do własnego.',
            'Ostrzeżenia przychodzą 5 min i 1 min przed końcem.',
          ],
        },
        {
          h: 'Pierwszy kontakt',
        },
        {
          p: 'Pod mgłą plemię trafia do okna Dyplomacja, gdy zobaczysz jego człowieka, budynek, pojazd lub palisadę albo gdy cię uderzy. Kontakt nie wygasa.',
        },
        {
          h: 'Trybuty',
        },
        {
          p: 'Trybut otwiera tylko skrypt mapy. "Zapłać" w oknie Dyplomacja zabiera towar od razu, nikt go nie nosi. Kolejność źródeł:',
        },
        {
          steps: [
            'Pierwsza [[building:headquarters|Kwatera główna]].',
            'Pozostałe Kwatery i Magazyny.',
            'Warsztaty, tylko własne wyroby, bez surowców.',
          ],
        },
        {
          list: [
            'Domy, wieże, [[building:barracks|Koszary]], [[building:school|Szkoła]] i stosy na ziemi nie płacą.',
            'Żądanie jedzenia przyjmuje każde danie tej samej klasy.',
            '"Minimum w magazynach" nie chroni towaru przed trybutem.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Mgła i widzenie',
      lead: 'Widzisz tylko to, co jest w zasięgu twoich ludzi i budynków.',
      blocks: [
        {
          h: 'Tryby mapy',
        },
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
        {
          h: 'Zasięg widzenia',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Co widzi kto',
          },
        },
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
            foot: 'Kroki liczone w poziomie. Palisada, droga i drogowskaz nie widzą.',
          },
        },
        {
          h: 'Walka we mgle',
        },
        {
          p: 'Żołnierz atakuje też we mgle, [[good:catapult|Katapulta]] sama nie. [[job:hunter|Myśliwy]] poluje bez względu na mgłę.',
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Zwiadowca',
      lead: 'Zwiadowca nie ma miejsca pracy. Bez rozkazu stoi i czeka.',
      blocks: [
        {
          h: 'Co robi',
        },
        {
          table: {
            head: ['Zadanie', 'Jak', 'Więcej'],
            rows: [
              [
                'Drogowskazy',
                'Rozkaz "Postaw drogowskaz", bez materiału',
                '[[article:roads|Drogi i drogowskazy]]',
              ],
              ['Badanie lądu', 'Rozkaz "Badaj"', 'Poniżej'],
              ['Zwierzęta', 'Przejmuje dzikie Woły i Owce, idąc obok nich', '[[article:livestock|Hodowla]]'],
              ['Widzenie', '30 kroków, najwięcej wśród ludzi', '[[article:fog|Mgła i widzenie]]'],
            ],
            foot: 'Zasięg drogowskazów go nie dotyczy, więc chodzi po całej mapie.',
          },
        },
        {
          h: '"Badaj"',
        },
        {
          list: [
            'Rozkaz działa tylko na Zwiadowcę, także na kilku zaznaczonych naraz.',
            'Idzie pierścieniami od miejsca rozkazu, zawsze do najbliższego nieodkrytego lądu.',
            'Zostaje na jednym lądzie. Na inny przewiezie go tylko [[article:vehicles|statek]].',
            'Pomija wąskie pasy wzdłuż brzegów i krawędzi mapy, więc drobne skrawki zostają nieodkryte.',
            'Po drodze je i śpi, a potem idzie dalej z miejsca, w którym stoi.',
          ],
        },
        {
          h: 'Kiedy kończy',
        },
        {
          table: {
            head: ['Zdarzenie', 'Skutek'],
            rows: [
              ['Brak lądu do odkrycia', 'Powiadomienie "Ląd zbadany", Zwiadowca czeka'],
              ['Ponad 16 nieudanych celów z rzędu', 'Reszta uchodzi za niedostępną, "Ląd zbadany"'],
              ['Tryb mapy "Odkryta"', '"Ląd zbadany" od razu'],
              ['Nowy rozkaz', 'Badanie przepada'],
              ['Rozkaz z Shift', 'Czeka do końca badania'],
              ['Zmiana zawodu', 'Badanie przepada'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Dzikie zwierzęta i polowanie',
      lead: 'Agresywne stado rzuca się na ludzi w promieniu 20 kroków od swojego miejsca, a za 40 krokami wraca.',
      blocks: [
        {
          data: 'animals',
        },
        {
          h: 'Agresja',
        },
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
            'Budynków i pojazdów zwierzęta nie atakują.',
          ],
        },
        {
          h: 'Przyrost stada',
        },
        {
          p: 'Dzikie stado większe niż 1 sztuka i mniejsze od kolumny "Stado" zyskuje 1 dorosłą sztukę co 10 min, ale rośnie tylko około 1 stada na 5.',
        },
        {
          h: 'Na co poluje Myśliwy',
        },
        {
          list: [
            'Teren łowiecki to 50 kroków od flagi roboczej albo miejsca pracy. Pościg wychodzi poza teren o 4 kroki.',
            'Wybiera bliskie i słabe zwierzę.',
            'Poluje na 1 ofiarę naraz, nową bierze dopiero po zebraniu zdobyczy.',
            'Łuk Myśliwego zabiera 525 na strzał, zasięg 3-17 kroków.',
            'Dorosłej Dzikiej Kozy sam nie weźmie, jej młode są zwierzyną.',
            'Pomija zwierzęta z właścicielem, rozwścieczone oraz stojące na innym lądzie.',
          ],
        },
        {
          h: 'Zdobycz',
        },
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
        {
          figure: {
            id: 'livestock-cycle',
            caption: 'Cykl hodowli',
          },
        },
        {
          h: 'Skąd wziąć zwierzęta',
        },
        {
          table: {
            head: ['Kto', 'Co robi', 'Zasięg, kroki'],
            rows: [
              [
                '[[job:scout|Zwiadowca]]',
                'Każdy jego krok przejmuje dzikie Woły i Owce oraz stado gracza, wobec którego masz stosunek wrogi. Pozostałe wrogie stado w pobliżu rozbiega się',
                '2, rozbieganie 6',
              ],
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
        {
          h: 'Młode i ubój',
        },
        {
          table: {
            head: ['Zwierzę', 'Młode kosztuje', 'Ubój daje'],
            rows: [
              [
                '[[good:sheep|Owca]]',
                '1 [[good:water|Woda]], 2 [[good:wheat|Pszenica]]',
                '1 [[good:wool|Wełna]], 2 [[good:meat|Mięso]]',
              ],
              [
                '[[good:cattle|Wół]]',
                '1 [[good:water|Woda]], 2 [[good:wheat|Pszenica]]',
                '2 [[good:leather|Skóra]], 2 [[good:meat|Mięso]]',
              ],
            ],
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
        {
          h: 'Stan Fermy',
        },
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
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religia i świątynia',
      lead: 'Pasek Religii spada wyłącznie przy produkcji broni i zbroi. Przy 0% rzemieślnik nie zacznie serii, która kosztuje Religię.',
      blocks: [
        {
          h: 'Koszt serii',
        },
        {
          table: {
            head: ['Zawód', '15%', '30%'],
            rows: [
              [
                '[[job:armorer|Płatnerz]]',
                '[[good:bow_short|Krótki Łuk]], [[good:spear_wooden|Drewniana Włócznia]]',
                '[[good:bow_long|Długi Łuk]]',
              ],
              [
                '[[job:smith|Kowal]]',
                '[[good:spear_iron|Żelazna Włócznia]], [[good:sword_shord|Krótki Miecz]]',
                '[[good:sword_long|Długi Miecz]], [[good:armor_chain|Kolczuga]], [[good:armor_plate|Zbroja Płytowa]]',
              ],
              [
                '[[job:sewer|Krawiec]]',
                '[[good:armor_wool|Tunika]], [[good:armor_leather|Skórzana Zbroja]]',
                '-',
              ],
            ],
            foot: 'Tak samo we wszystkich plemionach. Inne towary tych zawodów nie zużywają Religii.',
          },
        },
        {
          list: [
            'Pod 20% Płatnerz i Kowal idą się modlić, a bez miejsca modlitwy przy 10% pada komunikat "Chce się modlić".',
            'Krawiec sam nie idzie, trzeba mu kazać "Módl się".',
            'Przy 0% rzemieślnik dokończy opłaconą serię.',
          ],
        },
        {
          h: 'Gdzie się modlić',
        },
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
        {
          h: 'Święty ogień',
        },
        {
          p: 'Działa od Domu 3. 1 [[good:holy_oil|Oliwa]] pali się 5,5 min, pełny ogień 28 min.',
        },
        {
          h: 'Aura Świątyni',
        },
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
        {
          h: 'Kto otwiera',
        },
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
        {
          h: 'Zawartość',
        },
        {
          table: {
            head: ['Nagroda', 'Skrzynia', 'Magiczna'],
            rows: [
              ['Mikstura albo amulet', '1', '3'],
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
        {
          h: 'Papiery',
        },
        {
          table: {
            head: ['Papier', 'Działanie'],
            rows: [
              ['Umieść wybrany przez ciebie budynek', 'Dowolny budynek z katalogu, stanie od razu'],
              ["Umieść 'nazwa'", 'Wskazany budynek, stanie od razu'],
              ["Umieść 'nazwa' i zapełnij jego skład", 'Wskazany budynek ze składem pełnym po brzegi'],
            ],
            foot: 'Papier znika po użyciu, odmowa miejsca go nie zużywa. Listę znajdziesz w oknie budowy pod "Papiery".',
          },
        },
        {
          p: 'Budynki na papierach: [[building:home_level_01|Dom 2]], [[building:home_level_04|Dom 5]], [[building:stock_02|Magazyn 3]], [[building:headquarters|Kwatera główna]], [[building:work_well_00|Studnia]], [[building:work_farm_00|Farma]], [[building:work_mill_00|Młyn]], [[building:work_bakery_00|Piekarnia 1]], [[building:work_temple|Świątynia]], [[building:school|Szkoła]], [[building:barracks|Koszary]], [[building:tower_01|Wieża obronna 2]].',
        },
        {
          h: 'Papiery z warsztatem',
        },
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
