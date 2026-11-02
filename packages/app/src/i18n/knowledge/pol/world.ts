import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Świat',
  items: [
    {
      id: 'goals',
      name: 'Cele misji i koniec gry',
      lead: 'Gracz przegrywa, gdy nie ma już żadnego dorosłego mężczyzny. Bohater się liczy. Kobiety, Cyra i dzieci nie.',
      blocks: [
        {
          h: 'Jak kończy się mapa',
        },
        {
          table: {
            head: ['Mapa', 'Wygrana', 'Porażka'],
            rows: [
              [
                'Mapa wieloosobowa, także grana samotnie',
                'Cele mapy, tabela niżej',
                'Brak dorosłego mężczyzny albo porażka ogłoszona przez misję',
              ],
              ['Misja fabularna', 'Ogłasza misja', 'Ogłasza misja albo brak dorosłego mężczyzny'],
              ['Mapa bez misji', 'Ostatni na mapie', 'Brak dorosłego mężczyzny'],
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
                'Zapas w budynkach. Stosy na ziemi, ładownie i towar w rękach się nie liczą',
                'Wygrana, gdy masz wszystkie wymagane ilości',
              ],
              ['"Mieszkańcy"', 'Każdy człowiek gracza, także dzieci', 'Wygrana po osiągnięciu liczby'],
              [
                '"Żołnierze"',
                'Dorośli mężczyźni w zawodzie żołnierza, bez bohaterów',
                'Wygrana po osiągnięciu liczby',
              ],
              ['Ogłoszenie misji', 'Misja ogłasza wygraną albo porażkę gracza', 'Wygrana albo porażka'],
              [
                'Ostatni na mapie',
                'Odpadł co najmniej jeden gracz, a wszyscy pozostali mają wobec siebie stosunek przyjazny: [[article:diplomacy|Dyplomacja]]',
                'Wygrana wszystkich pozostałych',
              ],
            ],
            foot: 'Postęp towarów, "Mieszkańców" i "Żołnierzy" gra pokazuje jako obecne/wymagane. Ostatni na mapie obowiązuje tylko wtedy, gdy mapa nie ma celów towarów ani ludzi i misja nie ogłasza wyniku.',
          },
        },
        {
          list: [
            'Gra najpierw sprawdza mężczyzn, potem kolejne cele z mapy. Mężczyzn liczy dopiero po {{match.graceSeconds}} s gry.',
            'Pierwszy spełniony warunek rozstrzyga o graczu na stałe.',
            'Wygrana jednego gracza nie kończy gry innym, a zwycięzca, który straci potem ludzi, nadal wygrał.',
            'Mapa może zwolnić wskazanego gracza z zasady o dorosłym mężczyźnie.',
          ],
        },
        {
          h: 'Co zostaje po pokonanym',
        },
        {
          steps: [
            'Brak dorosłego mężczyzny: pojazdy znikają od razu.',
            'Porażka zapada przy najbliższym sprawdzeniu celów, co {{match.checkSeconds}} s.',
            'Przy następnym sprawdzeniu znikają budynki, pojazdy i drogowskazy, a w miejscu każdego człowieka stojącego na lądzie zostaje dzika kura.',
            'Zwierzęta gracza dziczeją tam, gdzie stoją.',
          ],
        },
        {
          p: 'Tak jest na mapie wieloosobowej. W misji fabularnej i na mapie bez misji znikają tylko pojazdy, a komputer przestaje grać.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Pojazdy i statki',
      lead: 'Pojazd bez dowódcy stoi. Statek wiezie więcej ludzi, Statek handlowy więcej towaru.',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['Pojazd', 'Kto wsiada'],
            rows: [
              [
                '[[good:handcart|Wózek Ręczny]], [[good:oxcart|Zaprzęg]]',
                '[[job:carrier|Tragarz]], [[job:trader|Kupiec]]',
              ],
              ['[[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]]', 'każdy dorosły'],
              ['[[good:catapult|Katapulta]]', 'żołnierz, bohater'],
            ],
          },
        },
        {
          list: [
            'Kolumna "Pasażerowie" nie liczy dowódcy. Pierwszy przypisany zostaje dowódcą, a po jego odejściu dowodzi następny pasażer.',
            'Kto wsiada, traci miejsce pracy. Wyjątek: Tragarz z miejscem pracy i Kupiec ciągną wóz sami i pracę zachowują.',
            'Ładownię obsługuje dowódca i każdy dorosły mężczyzna na pokładzie. Żołnierze, bohaterowie, [[job:scout|Zwiadowcy]] i [[job:druid|Druidzi]] ładują tylko jako dowódcy. Gdy nie ma kto, pojawia się "Brak tragarza".',
          ],
        },
        {
          h: 'Szybkość z ładunkiem',
        },
        {
          table: {
            head: [
              'Pojazd',
              'Utrata przy pełnym',
              'Droga: pusty',
              'Droga: pełny',
              'Ląd: pusty',
              'Ląd: pełny',
            ],
            rows: [
              [
                '[[good:handcart|Wózek Ręczny]]',
                '{{vehicle.handcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.handcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.handcartLandFull}}',
              ],
              [
                '[[good:oxcart|Zaprzęg]]',
                '{{vehicle.oxcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.oxcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.oxcartLandFull}}',
              ],
              [
                '[[good:catapult|Katapulta]]',
                '-',
                '{{pace.catapultRoad}}',
                '-',
                '{{pace.catapultLand}}',
                '-',
              ],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Hexy na sekundę. Pełny to {{haul.handcart}} sztuk na Wózku i {{haul.oxcart}} na Zaprzęgu. Utrata rośnie z ładunkiem: pół wozu to pół utraty. Wybór wozu na trasę: [[article:trade|Handel]].',
          },
        },
        {
          list: [
            'Tak jedzie wóz z dowódcą, buty nic tu nie zmieniają.',
            'Tragarz i Kupiec, którzy ciągną wóz sami, idą własnym krokiem. W butach jadą szybciej i tracą ten sam procent.',
            'Statek nie zwalnia od ładunku i płynie około {{pace.ship}} hexów/s.',
          ],
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
                '[[building:work_joinery_02|Warsztat ciesielski 3]] i [[building:work_joinery_03|4]]',
                '{{cost.handcartWood}} [[good:wood|Drewno]]',
              ],
              [
                '[[good:oxcart|Zaprzęg]]',
                '[[building:work_joinery_02|Warsztat ciesielski 3]] i [[building:work_joinery_03|4]]',
                '{{cost.oxcartWood}} [[good:wood|Drewno]]',
              ],
              [
                '[[good:ship_small|Statek]]',
                '[[building:work_joinery_03|Warsztat ciesielski 4]]',
                '{{cost.shipWood}} [[good:wood|Drewno]], {{cost.shipLeather}} [[good:leather|Skóra]]',
              ],
              [
                '[[good:ship_big|Statek handlowy]]',
                '[[building:work_joinery_03|Warsztat ciesielski 4]]',
                '{{cost.bigShipWood}} [[good:wood|Drewno]], {{cost.bigShipLeather}} [[good:leather|Skóra]]',
              ],
              [
                '[[good:catapult|Katapulta]]',
                '[[building:work_joinery_03|Warsztat ciesielski 4]]',
                '{{catapult.wood}} [[good:wood|Drewno]], {{catapult.iron}} [[good:iron|Żelazo]]',
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
            'Bierze najbliższego dorosłego [[good:cattle|Wołu]] z tego samego lądu. Wół w środku Fermy się nie liczy.',
            'Każda Ferma zatrzymuje {{livestock.pair}} dorosłe Woły. Tyle samo zostaje ze stada bez Fermy.',
            'Wół idzie do wozu i znika, a Zaprzęg rusza dopiero z nim.',
          ],
        },
        {
          h: 'Statki',
        },
        {
          list: [
            'Pojemność ładowni dzielą wszystkie towary.',
            'Statek przewozi 1 pojazd: Wózek Ręczny, Zaprzęg albo Katapultę. Załoga pojazdu musi się zmieścić na pokładzie. Statek handlowy nie przewozi pojazdów.',
            '"Zacumuj": wskaż brzeg, statek stanie {{vehicle.mooringDistance}} hexy od niego. Portu nie trzeba.',
            'Na morzu nikt nie wsiada ani nie wysiada.',
            'Ctrl/Cmd + prawy klik cumuje i wysadza załogę.',
          ],
        },
        {
          h: 'Ładownia',
        },
        {
          list: [
            '"cel": ile sztuk ma być w ładowni. Suma celów nie przekroczy pojemności.',
            '"w rękach tragarza": wóz ciągnie Tragarz i sam decyduje w każdym kursie, co na niego wziąć. Celów nie ustawisz.',
            'Ładujący wysiada, gdy wóz stoi albo statek cumuje.',
            'Ładujący nosi po 1 sztuce. Najpierw szuka stosów do {{vehicle.cargoSearch}} hexów od wozu, potem budynków w tym samym zasięgu, a na końcu wszędzie, gdzie sięgają drogowskazy.',
            'Towar musi leżeć na tym samym lądzie co wóz albo statek. Jedzenia z domów nikt nie bierze.',
            'Gdy obniżysz cel, nadmiar trafia do najbliższego Magazynu lub Kwatery głównej z miejscem, do {{vehicle.cargoSearch}} hexów od wozu. Gdy takiego nie ma, ląduje na ziemi.',
            'Gdy ładuje sam dowódca, który jest żołnierzem albo bohaterem, a towaru nie ma skąd wziąć, cel sam spada. To samo dotyczy [[job:scout|Zwiadowcy]] i [[job:druid|Druida]].',
            'Rozkaz jazdy woła załogę na pokład przed odjazdem.',
          ],
        },
        {
          h: 'Utrata pojazdu',
        },
        {
          table: {
            head: ['Pojazd', 'Załoga na pokładzie', 'Przewożony pojazd', 'Ładunek'],
            rows: [
              [
                'Wóz, [[good:catapult|Katapulta]]',
                'Wysiada obok',
                '-',
                'Rozsypany do {{vehicle.spill}} hexów wokół',
              ],
              ['Statek cumuje', 'Wysiada na brzeg', 'Staje na brzegu', 'Przepada'],
              ['Statek na morzu', 'Tonie', 'Tonie razem ze swoją załogą', 'Przepada'],
            ],
            foot: 'Załogi w pojeździe nie da się trafić, dopóki pojazd jest cały. Kto stoi obok, po prostu przestaje należeć do załogi.',
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
              ['Wspólna wygrana "Ostatni na mapie"', 'nie', 'nie', 'tak, obie strony'],
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
              ['Start mapy', 'Stosunki ustala mapa. Gdzie ich nie podała, startujecie jako neutralni'],
              ['Inny gracz cię uderzy', 'Twój stosunek do niego sam zmienia się na wrogi'],
              ['Ustawisz wrogi wobec neutralnego komputera', 'Komputer też przechodzi na wrogi'],
              ['Komputer neutralny na mapie wyspiarskiej', 'Sam przechodzi na wrogi wobec graczy'],
              ['Obniżysz stosunek do przyjaznego komputera', 'Komputer też obniży, do twojego poziomu'],
              ['Komputer wrogi', 'Sam nie wraca do pokoju'],
              ['Misja', 'Może zmienić stosunek, także po zapłaconym trybucie'],
              ['"Stosunek ustala scenariusz"', 'Nie zmienisz go w oknie Dyplomacja'],
            ],
          },
        },
        {
          h: 'Czas pokoju',
        },
        {
          list: [
            '"Czas pokoju" ustawiasz przed grą. Gracze nim objęci nie mogą ze sobą walczyć.',
            'Nie wyślesz ludzi ani nic nie zbudujesz do {{peace.keepOut}} hexów od jego budynku, chyba że to miejsce leży bliżej twojego budynku.',
            'Ostrzeżenia przychodzą {{peace.noticeFirstMinutes}} min i {{peace.noticeLastMinutes}} min przed końcem.',
          ],
        },
        {
          h: 'Pierwszy kontakt',
        },
        {
          p: 'We mgle plemię pojawia się w oknie Dyplomacja, gdy zobaczysz jego człowieka, budynek, pojazd lub palisadę albo gdy cię zaatakuje. Zostaje tam na stałe.',
        },
        {
          h: 'Trybuty',
        },
        {
          p: 'Trybutu żąda tylko misja. "Zapłać" w oknie Dyplomacja zabiera towar od razu, nikt go nie nosi. Gra bierze go z:',
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
            'Gdy misja żąda jedzenia, zapłacisz każdym daniem tego samego rodzaju.',
            '"Minimum w magazynach" nie chroni towaru przed trybutem.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Mgła i widzenie',
      lead: 'Najdalej widzą Zwiadowca i Kwatera główna, {{vision.scout}} hexów. Plac budowy nie widzi nic.',
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
              ['Klasyczna + Mgła wojny', 'czarna mapa', 'szary teren, bez ludzi i zwierząt'],
              ['Rozpoznanie', 'szary teren, bez ludzi i zwierząt', 'raz odkryty pozostaje widoczny'],
              [
                'Rozpoznanie + Mgła wojny',
                'szary teren, bez ludzi i zwierząt',
                'szary teren, bez ludzi i zwierząt',
              ],
            ],
          },
        },
        {
          p: 'Szary teren pokazuje budynki, palisady, pojazdy, skrzynie, surowce, pnie i stosy towarów w stanie z ostatniego zobaczenia. Ludzi i zwierząt nie pokazuje.',
        },
        {
          h: 'Zasięg widzenia',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Zasięg widzenia',
          },
        },
        {
          table: {
            head: ['Kto', 'Zasięg, hexy'],
            rows: [
              ['[[job:scout|Zwiadowca]], [[building:headquarters|Kwatera główna]]', '{{vision.scout}}'],
              ['Bohater, [[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]]', '{{vision.hero}}'],
              ['Żołnierz, budynek, także wieża i dom', '{{vision.soldier}}'],
              [
                '[[good:handcart|Wózek Ręczny]], [[good:oxcart|Zaprzęg]], [[good:catapult|Katapulta]]',
                '{{vision.cart}}',
              ],
              ['Reszta dorosłych, własne zwierzę', '{{vision.adult}}'],
              ['Dziecko', '{{vision.child}}'],
              ['Plac budowy', '0'],
            ],
            num: [1],
            foot: 'Palisada, droga i drogowskaz nie widzą. Żołnierz i [[job:hunter|Myśliwy]] znajdują cel także we mgle. [[good:catapult|Katapulta]] sama wybiera tylko cel, który widzi.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Zwiadowca',
      lead: 'Zwiadowca nie ma miejsca pracy. Bez rozkazu stoi.',
      blocks: [
        {
          p: 'Stawia [[article:roads|drogowskazy]] bez materiału i przejmuje dzikie Woły i Owce, gdy idzie obok nich: [[article:livestock|Hodowla]]. Drogowskazy go nie ograniczają, chodzi po całej mapie.',
        },
        {
          h: '"Badaj"',
        },
        {
          list: [
            'Możesz wysłać kilku naraz.',
            'Odkrywa ląd pierścieniami wokół miejsca rozkazu.',
            'Nie opuści swojego lądu. Na inny musi go zawieźć [[article:vehicles|statek]].',
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
              [
                'Ponad {{explore.maxFailedLegs}} razy z rzędu nie doszedł do celu',
                'Uznaje resztę za niedostępną, "Ląd zbadany"',
              ],
              ['Tryb mapy "Odkryta"', '"Ląd zbadany" od razu'],
              ['Nowy rozkaz, zmiana zawodu', 'Badanie przepada'],
              ['Rozkaz z Shift', 'Wykona go po skończeniu badania'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Dzikie zwierzęta i polowanie',
      lead: 'Agresywne stado rzuca się na ludzi do {{wild.aggro}} hexów od miejsca, w którym się pasie. Goni najdalej {{wild.giveUp}} hexów, potem wraca.',
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
                'Atakują uderzone',
                'Niedźwiedź, Słoń',
                'Są groźne przez {{wild.angrySeconds}} s od ostatniego uderzenia. Zaczęty atak trwa, aż cel zginie albo się schowa',
              ],
              ['Płochliwe', 'Pozostałe', 'Uderzony przywódca ucieka do {{wild.flight}} hexów, stado za nim'],
            ],
            foot: 'Dzika Koza nie atakuje i nie ucieka.',
          },
        },
        {
          list: [
            'Gdy uderzysz zwierzę, reagują też inne tego gatunku do {{wild.kinAlarm}} hexów.',
            'Budynków i pojazdów zwierzęta nie atakują.',
          ],
        },
        {
          h: 'Przyrost stada',
        },
        {
          p: 'Tylko około 1 stado na {{wild.breedingShare}} w ogóle się powiększa. Takie stado zyskuje 1 dorosłą sztukę co {{wild.growthMinutes}} min, jeśli ma co najmniej 2 sztuki i mniej, niż podaje kolumna "Stado". Pojedyncze zwierzę się nie rozmnaża.',
        },
        {
          h: 'Na co poluje Myśliwy',
        },
        {
          list: [
            'Teren łowiecki to {{flag.hunter}} hexów od flagi roboczej albo miejsca pracy. Pościg wychodzi poza teren o {{wild.huntChase}} hexy.',
            'Wybiera zwierzę z najmniejszą sumą zdrowia i odległości. Zdrowie liczy się w setkach i tysiącach, więc wygrywa najsłabsze, nawet dalekie.',
            'Poluje na 1 zwierzę naraz, nowe bierze dopiero po zebraniu zdobyczy.',
            'Strzał Myśliwego odbiera zwierzęciu {{wild.hunterShot}} zdrowia, zasięg {{hunterBow.min}}-{{hunterBow.max}} hexów.',
            'Dorosłej Dzikiej Kozy sam nie weźmie, jej młode są zwierzyną.',
            'Pomija zwierzęta, które mają właściciela, oraz te na innym lądzie.',
            'Kolumna "Myśliwy": "sam" to zwierzyna, po którą pójdzie sam, a "na rozkaz" atakuje tylko na twój rozkaz.',
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
      lead: 'Hodowca rozmnaża tylko przy dokładnie {{livestock.pair}} dorosłych sztukach gatunku. Przy trzeciej najpierw ją ubije.',
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
            head: ['Kto', 'Co robi', 'Zasięg, hexy'],
            rows: [
              [
                '[[job:scout|Zwiadowca]]',
                'Z każdym krokiem przejmuje dzikie Woły i Owce oraz zwierzęta wrogiego gracza. Te dalej od niego rozbiegają się',
                'przejęcie {{livestock.captureRange}}, rozbieganie {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Hodowca]]',
                'Zabiera do Fermy najbliższe twoje zwierzę bez Fermy. Poniżej pary bierze też sztukę z innej twojej Fermy, która ma więcej niż parę',
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
                '{{livestock.calfWater}} [[good:water|Woda]], {{livestock.calfWheat}} [[good:wheat|Pszenica]]',
                '{{livestock.sheepWool}} [[good:wool|Wełna]], {{livestock.sheepMeat}} [[good:meat|Mięso]]',
              ],
              [
                '[[good:cattle|Wół]]',
                '{{livestock.calfWater}} [[good:water|Woda]], {{livestock.calfWheat}} [[good:wheat|Pszenica]]',
                '{{livestock.cattleLeather}} [[good:leather|Skóra]], {{livestock.cattleMeat}} [[good:meat|Mięso]]',
              ],
            ],
            foot: 'Młode i ubój trwają około {{livestock.cycleSeconds}} s. Gatunek wybierasz w produkcji Hodowcy. Na Fermie mieści się po {{livestock.farmShelf}} sztuk Mięsa, Wełny i Skóry.',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|Ferma bydła]] mieści {{livestock.farmHerd}} sztuk łącznie, oba gatunki i młode w drodze.',
            'Młode dorasta {{livestock.growMinutes}} min i do tego czasu nie liczy się do pary.',
            'Gdy rodzic przy narodzinach jest dalej niż {{livestock.birthRange}} hexów od Fermy, surowce przepadają i młodego nie ma.',
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
      lead: 'Pasek Religii spada wyłącznie przy produkcji broni i zbroi. Przy 0% rzemieślnik nie zacznie cyklu produkcji, który kosztuje Religię.',
      blocks: [
        {
          h: 'Koszt cyklu produkcji',
        },
        {
          table: {
            head: ['Zawód', '{{piety.lowPct}}%', '{{piety.highPct}}%'],
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
            'Pod {{need.drivePct}}% [[job:joiner|Cieśla]], Płatnerz, Kowal i Krawiec sami idą się modlić. Bez miejsca modlitwy przy {{need.criticalPct}}% pada komunikat "Chce się modlić".',
            'Zaczęty cykl dokończą nawet przy 0%.',
          ],
        },
        {
          h: 'Gdzie się modlić',
        },
        {
          table: {
            head: ['Miejsce', 'Warunek'],
            rows: [
              ['Dom', 'Gdy płonie w nim święty ogień. Osadnik idzie tam najpierw'],
              [
                '[[building:work_temple|Świątynia]], [[building:headquarters|Kwatera główna]]',
                'Tylko ukończone i twoje',
              ],
            ],
            foot: 'Modlitwa trwa {{pray.seconds}} s i daje +{{pray.pct}}% Religii.',
          },
        },
        {
          h: 'Święty ogień',
        },
        {
          p: 'Rozpalisz go od Domu 3. 1 [[good:holy_oil|Oliwa]] pali się {{oil.burnMinutes}} min, pełny zapas w domu {{oil.fullBurnMinutes}} min. Pali się też wtedy, gdy nikt się nie modli.',
        },
        {
          h: 'Aura Świątyni',
        },
        {
          table: {
            head: ['Działanie', 'Wartość'],
            rows: [
              ['Zasięg', '{{aura.range}} hexów'],
              ['Zdrowie', '+{{aura.perSecond}} na sekundę, do {{aura.ceiling}}'],
              ['Religia', '+{{aura.pietyPct}}% na sekundę, gdy pasek ma do {{need.satedPct}}%'],
              ['Kto', 'Wszyscy ludzie właściciela Świątyni. Dzieci dostają zdrowie'],
              ['Warunek', 'Świątynia gotowa i bez uszkodzeń'],
              ['Kilka Świątyń', 'Działa jedna aura, wartości się nie sumują'],
            ],
            foot: 'Zdrowie ponad {{health.human}} zostaje, dopóki nie zabiorą go rany.',
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
          p: 'Skrzynię otworzy każdy dorosły, Magiczną skrzynię tylko [[job:druid|Druid]] i bohater. Rozkaz to "Otwórz skrzynię". Osadnik musi do niej dojść w swoim zasięgu chodu.',
        },
        {
          h: 'Zawartość',
        },
        {
          table: {
            head: ['Nagroda', 'Skrzynia', 'Magiczna'],
            rows: [
              ['Mikstura albo amulet', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['Duże mikstury, 1 rodzaj', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|Kolczuga]], [[good:armor_plate|Zbroja Płytowa]] albo [[good:shoes|Buty]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|Żywność]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|Katapulta]]', '1', '1'],
              [
                'Cywile, Kobiety, wojownicy z długim mieczem albo łucznicy z długim łukiem',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                'Wilki albo Lwy. Wychodzą dzikie i atakują od razu',
                '{{chest.wolves}} albo {{chest.lions}}',
                '{{chest.wolves}} albo {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: 'Zawartość każdej skrzyni ustala mapa, nie los.',
          },
        },
        {
          h: 'Papiery',
        },
        {
          table: {
            head: ['Papier', 'Działanie'],
            rows: [
              ['Umieść wybrany przez ciebie budynek', 'Dowolny budynek z listy budowy, stanie od razu'],
              ["Umieść 'nazwa'", 'Wskazany budynek, stanie od razu'],
              ["Umieść 'nazwa' i zapełnij jego skład", 'Wskazany budynek z pełnym zapasem'],
            ],
            foot: 'Papier znika po użyciu. Gdy miejsce nie pasuje, zostaje. Twoje papiery są w oknie budowy pod "Papiery".',
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
            head: ['Budynek z zapasem', 'Osadnik', 'Odkrywa na stałe'],
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
            foot: 'Taka skrzynia daje też osadnika w tym zawodzie i dostęp do zawodu.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
