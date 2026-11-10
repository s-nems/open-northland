import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'Świat',
  items: [
    {
      id: 'goals',
      name: 'Cele misji i koniec gry',
      lead: 'Przegrywasz, gdy nie zostanie ci żaden dorosły mężczyzna. Bohater się liczy, kobiety, Cyra i dzieci nie.',
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
              ['Misja fabularna', 'Decyduje misja', 'Decyduje misja albo brak dorosłego mężczyzny'],
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
            'Przez pierwsze {{match.graceSeconds}} s gry brak mężczyzn nie oznacza porażki.',
            'Wynik zapada raz i na stałe. Kto wygrał, nie przegra, nawet gdy potem straci ludzi.',
            'Wygrana jednego gracza nie kończy gry pozostałym.',
          ],
        },
        {
          h: 'Co zostaje po pokonanym',
        },
        {
          p: 'Na mapie wieloosobowej znikają budynki, pojazdy i drogowskazy pokonanego, jego ludzie na lądzie zamieniają się w dzikie kury, a zwierzęta dziczeją. W misji fabularnej i na mapie bez misji znikają tylko pojazdy, a komputer przestaje grać.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Pojazdy i statki',
      lead: 'Pojazd bez dowódcy nigdzie nie pojedzie. Statek zabiera więcej ludzi, Statek handlowy więcej towaru.',
      blocks: [
        {
          p: 'Ładownię, miejsca dla pasażerów, zdrowie i koszt każdego pojazdu podaje jego karta: [[vehicle:handcart|Wózek Ręczny]], [[vehicle:oxcart|Zaprzęg]], [[vehicle:ship_small|Statek]], [[vehicle:ship_big|Statek handlowy]], [[vehicle:catapult|Katapulta]]. Który warsztat co robi, podają karty [[building:work_joinery_02|Warsztatu ciesielskiego 3]] i [[building:work_joinery_03|4]].',
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
            'Liczba pasażerów na karcie nie obejmuje dowódcy. Dowódcą zostaje pierwszy przydzielony, a gdy odejdzie, dowodzi kolejny pasażer.',
            '[[job:joiner|Cieśla]] stawia pojazd na placu obok warsztatu, a statek na wodzie w zasięgu warsztatu. Gdy takiej wody nie ma, okno budowy ostrzega "Brak wody w zasięgu do budowy statków".',
            'Kto wsiada, traci miejsce pracy. Tylko Tragarz z miejscem pracy i Kupiec ciągną wóz sami i zachowują pracę.',
            'Towar ładuje dowódca i każdy dorosły mężczyzna na pokładzie, ale żołnierze, bohaterowie, [[job:scout|Zwiadowcy]] i [[job:druid|Druidzi]] tylko wtedy, gdy dowodzą. Gdy nie ma komu ładować, pojawia się "Brak tragarza".',
          ],
        },
        {
          h: 'Który wóz wybrać',
        },
        {
          list: [
            '[[good:handcart|Wózek Ręczny]] jest dobry na krótkie trasy, [[good:oxcart|Zaprzęg]] na długie: wiezie {{haul.oxcart}} sztuk i z ładunkiem prawie nie zwalnia.',
            '[[job:carrier|Tragarzom]] dawaj Wózki Ręczne: na krótkich kursach między budynkami przewiozą więcej w tym samym czasie.',
            '[[job:trader|Kupcom]] dawaj Zaprzęgi: na długich trasach handlowych przewiozą więcej. Od jakiej długości trasy: [[article:trade|Handel]].',
          ],
        },
        {
          h: 'Szybkość z ładunkiem',
        },
        {
          table: {
            head: ['Pojazd', 'Droga: pusty', 'Droga: pełny'],
            rows: [
              ['[[good:handcart|Wózek Ręczny]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|Zaprzęg]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|Katapulta]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: 'Hexy na sekundę. Pełny to {{haul.handcart}} sztuk na Wózku i {{haul.oxcart}} na Zaprzęgu. Po lądzie: tabela niżej. Wybór wozu na trasę: [[article:trade|Handel]].',
          },
        },
        {
          h: 'Ile zwalnia ładunek',
        },
        {
          table: {
            head: [
              'Ładunek',
              'Wózek: strata prędkości',
              'Wózek: hexy/s po lądzie',
              'Zaprzęg: strata prędkości',
              'Zaprzęg: hexy/s po lądzie',
            ],
            rows: [
              [
                '{{vehicle.fill.0}}%',
                '{{vehicle.handcartLoss.0}}%',
                '{{pace.handcartLand.0}}',
                '{{vehicle.oxcartLoss.0}}%',
                '{{pace.oxcartLand.0}}',
              ],
              [
                '{{vehicle.fill.25}}%',
                '{{vehicle.handcartLoss.25}}%',
                '{{pace.handcartLand.25}}',
                '{{vehicle.oxcartLoss.25}}%',
                '{{pace.oxcartLand.25}}',
              ],
              [
                '{{vehicle.fill.50}}%',
                '{{vehicle.handcartLoss.50}}%',
                '{{pace.handcartLand.50}}',
                '{{vehicle.oxcartLoss.50}}%',
                '{{pace.oxcartLand.50}}',
              ],
              [
                '{{vehicle.fill.75}}%',
                '{{vehicle.handcartLoss.75}}%',
                '{{pace.handcartLand.75}}',
                '{{vehicle.oxcartLoss.75}}%',
                '{{pace.oxcartLand.75}}',
              ],
              [
                '{{vehicle.fill.100}}%',
                '{{vehicle.handcartLoss.100}}%',
                '{{pace.handcartLand.100}}',
                '{{vehicle.oxcartLoss.100}}%',
                '{{pace.oxcartLand.100}}',
              ],
            ],
            num: [0, 1, 2, 3, 4],
            foot: 'Ładunek to część pojemności wozu. Strata rośnie równo z ładunkiem: pełny Wózek Ręczny jedzie o {{vehicle.handcartLoss.100}}% wolniej, w połowie pełny o {{vehicle.handcartLoss.50}}%. Pełny Zaprzęg traci {{vehicle.oxcartLoss.100}}%. Dla porównania: osadnik w butach na lądzie idzie {{pace.walkerLand}} hexy/s (krok {{step.landBrief}} s).',
          },
        },
        {
          list: [
            'Tak jedzie wóz z dowódcą. Buty nic tu nie zmieniają.',
            'Tragarz i Kupiec, którzy ciągną wóz sami, idą własnym tempem, a w butach szybciej. Ładunek spowalnia ich o ten sam procent: Kupiec w butach z pełnym Wózkiem Ręcznym robi krok po lądzie w {{step.traderFullCart}} s.',
            '[[good:catapult|Katapulta]] jedzie po lądzie {{pace.catapultLand}} hexów/s.',
            'Statek z ładunkiem nie zwalnia i płynie około {{pace.ship}} hexów/s.',
          ],
        },
        {
          h: 'Wół do Zaprzęgu',
        },
        {
          p: 'Gotowy Zaprzęg czeka na zwierzę pociągowe i bierze najbliższego dorosłego [[good:cattle|Wołu]] z tego samego lądu. Każda Ferma zatrzymuje sobie {{draught.kept}} dorosłe Woły i tyle samo zostaje ze stada bez Fermy, więc Zaprzęg dostanie dopiero Wołu ponad tę liczbę.',
        },
        {
          h: 'Statki',
        },
        {
          table: {
            head: ['Statek', 'Miejsca na pojazdy', 'Pojazdy'],
            rows: [
              ['[[good:ship_small|Statek]]', '{{vehicle.shipSlots}}', 'Wózek Ręczny, Zaprzęg, Katapulta'],
              ['[[good:ship_big|Statek handlowy]]', '{{vehicle.bigShipSlots}}', 'Wózek Ręczny, Zaprzęg'],
            ],
            num: [1],
          },
        },
        {
          list: [
            'Pojazd wjedzie na statek, jeśli jego załoga zmieści się na pokładzie. Statek przypięty do trasy Kupca nie przyjmie pojazdu.',
            '"Zacumuj": wskaż brzeg, a statek stanie {{vehicle.mooringDistance}} hexy od niego. Port nie jest potrzebny.',
            'Na morzu nikt nie wsiada ani nie wysiada.',
            'Ctrl/Cmd + prawy klik cumuje i wysadza wszystkich prócz dowódcy, więc statek może od razu odpłynąć.',
          ],
        },
        {
          h: 'Ładownia',
        },
        {
          list: [
            '"cel" to liczba sztuk, którą chcesz mieć w ładowni. Suma celów nie przekroczy pojemności.',
            '"w rękach tragarza": wóz ciągnie Tragarz i przy każdym kursie sam wybiera ładunek. Celów wtedy nie ustawisz.',
            'Ładujący nosi po 1 sztuce. Najpierw szuka towaru do {{vehicle.cargoSearch}} hexów od wozu, a potem wszędzie, gdzie sięgają drogowskazy.',
            'Towar musi leżeć na tym samym lądzie co wóz albo statek. Jedzenia z domów nikt nie bierze.',
            'Gdy obniżysz cel, nadmiar trafia do najbliższego Magazynu lub Kwatery głównej z wolnym miejscem, do {{vehicle.cargoSearch}} hexów od wozu. Gdy takiego nie ma, ląduje na ziemi.',
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
              ['Statek przy brzegu', 'Wysiada na brzeg', 'Staje na brzegu', 'Przepada'],
              ['Statek na morzu', 'Tonie', 'Tonie razem ze swoją załogą', 'Przepada'],
            ],
            foot: 'Dopóki pojazd jest cały, nikt nie trafi siedzącej w nim załogi.',
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
              ['Ktoś cię zaatakuje', 'Twój stosunek do niego sam zmienia się na wrogi'],
              ['Ustawisz wrogi wobec neutralnego komputera', 'Komputer też przechodzi na wrogi'],
              ['Komputer neutralny na mapie wyspiarskiej', 'Sam przechodzi na wrogi wobec graczy'],
              ['Obniżysz stosunek do przyjaznego komputera', 'Komputer też obniży, do twojego poziomu'],
              ['Wrogi komputer', 'Sam nie zawrze pokoju'],
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
            'Nie wyślesz ludzi ani nic nie zbudujesz do {{peace.keepOut}} hexów od budynku takiego gracza, chyba że to miejsce leży bliżej twojego budynku.',
            'Ostrzeżenia przychodzą {{peace.noticeFirstMinutes}} min i {{peace.noticeLastMinutes}} min przed końcem.',
          ],
        },
        {
          h: 'Pierwszy kontakt',
        },
        {
          p: 'Przy mgle plemię pojawi się w oknie Dyplomacja dopiero wtedy, gdy zobaczysz jego człowieka, budynek, pojazd lub palisadę albo gdy cię zaatakuje. Potem zostaje tam na stałe.',
        },
        {
          h: 'Trybuty',
        },
        {
          p: 'Trybutu żąda tylko misja. "Zapłać" w oknie Dyplomacja zabiera towar od razu, nikt go nie nosi, a "Minimum w magazynach" go nie chroni.',
        },
        {
          p: 'Towar idzie z [[building:headquarters|Kwater głównych]], Magazynów i warsztatów, z warsztatu tylko jego wyroby. Domy, wieże, [[building:barracks|Koszary]], [[building:school|Szkoła]] i stosy na ziemi nie płacą.',
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Mgła i widzenie',
      lead: 'Zwiadowca widzi na {{vision.scout}} hexów, Kwatera główna na {{vision.headquarters}}. Plac budowy nie widzi nic.',
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
          p: 'Na szarym terenie widać budynki, towary, surowce i pojazdy takie, jakie były, gdy ostatnio na nie patrzyłeś. Ludzi i zwierząt tam nie widać.',
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
              ['[[job:scout|Zwiadowca]]', '{{vision.scout}}'],
              ['[[building:headquarters|Kwatera główna]]', '{{vision.headquarters}}'],
              ['Bohater', '{{vision.hero}}'],
              ['[[good:ship_small|Statek]], [[good:ship_big|Statek handlowy]]', '{{vision.ship}}'],
              ['Żołnierz', '{{vision.soldier}}'],
              ['Inny budynek', '{{vision.building}}'],
              ['[[good:handcart|Wózek Ręczny]], [[good:oxcart|Zaprzęg]]', '{{vision.cart}}'],
              ['[[good:catapult|Katapulta]]', '{{vision.siege}}'],
              ['Inni dorośli, twoje zwierzęta', '{{vision.adult}}'],
              ['Dziecko', '{{vision.child}}'],
              ['Plac budowy', '0'],
            ],
            num: [1],
            foot: 'Palisada, droga i drogowskaz niczego nie odsłaniają. Żołnierz i [[job:hunter|Myśliwy]] znajdą cel także we mgle, a [[good:catapult|Katapulta]] sama strzela tylko do tego, co widzi.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Zwiadowca',
      lead: 'Zwiadowca nie ma miejsca pracy i bez rozkazu nic nie robi.',
      blocks: [
        {
          p: 'Stawia [[article:roads|drogowskazy]] bez materiału, a gdy przechodzi obok dzikich Wołów i Owiec, przejmuje je: [[article:livestock|Hodowla]]. Może chodzić po całej mapie, drogowskazy go nie ograniczają.',
        },
        {
          h: '"Badaj"',
        },
        {
          list: [
            'Odkrywa ląd coraz szerzej wokół wskazanego miejsca.',
            'Nie opuści swojego lądu. Na inny musi go zawieźć [[article:vehicles|statek]].',
            'Omija wąskie pasy przy brzegach i krawędziach mapy, więc małe skrawki mogą zostać nieodkryte.',
          ],
        },
        {
          h: 'Kiedy kończy',
        },
        {
          table: {
            head: ['Zdarzenie', 'Skutek'],
            rows: [
              ['Nie ma już czego odkrywać', 'Powiadomienie "Ląd zbadany", Zwiadowca czeka'],
              [
                'Ponad {{explore.maxFailedLegs}} razy z rzędu nie dotarł na miejsce',
                'Resztę uznaje za niedostępną, "Ląd zbadany"',
              ],
              ['Nowy rozkaz albo zmiana zawodu', 'Badanie się kończy'],
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
          p: 'Zdrowie, wielkość stada i to, czy zwierzę da się oswoić, podaje jego karta w Encyklopedii.',
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
                'Bronią się po uderzeniu',
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
          p: 'Rośnie tylko mniej więcej 1 stado na {{wild.breedingShare}}. Takie stado zyskuje 1 dorosłe zwierzę co {{wild.growthMinutes}} min, jeśli ma co najmniej 2 sztuki i mniej, niż podaje "Stado" na karcie zwierzęcia.',
        },
        {
          h: 'Na co poluje Myśliwy',
        },
        {
          list: [
            'Teren łowiecki sięga {{flag.hunter}} hexów od flagi roboczej albo miejsca pracy. W pościgu Myśliwy wychodzi poza niego najwyżej o {{wild.huntChase}} hexy.',
            'Najpierw poluje na najsłabsze zwierzę, nawet jeśli jest daleko.',
            'Strzał Myśliwego zabiera zwierzęciu {{wild.hunterShot}} zdrowia i sięga od {{hunterBow.min}} do {{hunterBow.max}} hexów.',
            'Na dorosłą Dziką Kozę sam nie zapoluje, na jej młode tak.',
            'Nie poluje na zwierzęta, które do kogoś należą, ani na te z innego lądu.',
            'Na karcie zwierzęcia "Myśliwy: sam" oznacza zwierzynę, na którą poluje sam, a "na rozkaz" taką, którą zaatakuje tylko na twój rozkaz.',
          ],
        },
        {
          h: 'Zdobycz',
        },
        {
          p: 'Co zostawia dorosłe zwierzę, podaje jego karta. Młode upolowane przez Myśliwego daje połowę tego, Koń młody tylko 1 [[good:leather|Skórę]]. Młode zabite przez kogoś innego nie zostawia nic.',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Hodowla',
      lead: 'Hodowca rozmnaża zwierzęta tylko wtedy, gdy ma dokładnie {{livestock.pair}} dorosłe sztuki gatunku. Trzecią najpierw ubija.',
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
                'Przechodząc obok, przejmuje dzikie Woły i Owce oraz zwierzęta wroga. Te trochę dalej rozbiegają się',
                'przejęcie {{livestock.captureRange}}, rozbieganie {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Hodowca]]',
                'Sprowadza na Fermę najbliższe twoje zwierzę spoza Fermy. Gdy brakuje mu pary, weźmie też nadmiar z innej twojej Fermy',
                'ten sam ląd',
              ],
            ],
            foot: 'Zwiadowca stojący w miejscu nic nie przejmuje.',
          },
        },
        {
          h: 'Ubój',
        },
        {
          table: {
            head: ['Zwierzę', 'Ubój daje'],
            rows: [
              [
                '[[good:sheep|Owca]]',
                '{{livestock.sheepWool}} [[good:wool|Wełna]], {{livestock.sheepMeat}} [[good:meat|Mięso]]',
              ],
              [
                '[[good:cattle|Wół]]',
                '{{livestock.cattleLeather}} [[good:leather|Skóra]], {{livestock.cattleMeat}} [[good:meat|Mięso]]',
              ],
            ],
            foot: 'Gatunek wybierasz w produkcji Hodowcy. Ile kosztuje i trwa młode oraz ile towaru mieści Ferma, podaje karta [[building:work_animal_farm|Fermy bydła]].',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|Ferma bydła]] mieści łącznie {{livestock.farmHerd}} zwierząt, licząc oba gatunki i młode w drodze.',
            'Młode dorasta {{livestock.growMinutes}} min i do tego czasu nie liczy się do pary.',
          ],
        },
        {
          h: 'Stan Fermy',
        },
        {
          table: {
            head: ['Komunikat', 'Znaczenie'],
            rows: [
              ['"Brak zwierząt"', 'Nie ma ani jednej sztuki, potrzebny Zwiadowca'],
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
      lead: 'Religia spada tylko przy wytwarzaniu broni i zbroi. Przy 0% rzemieślnik nie wytwarza broni ani zbroi.',
      blocks: [
        {
          h: 'Ile Religii kosztuje wyrób',
        },
        {
          table: {
            head: [
              'Zawód',
              'Kosztuje {{piety.lowPct}}% Religii za sztukę',
              'Kosztuje {{piety.highPct}}% Religii za sztukę',
            ],
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
            foot: 'We wszystkich plemionach tak samo. Inne wyroby tych zawodów Religii nie kosztują.',
          },
        },
        {
          list: [
            'Poniżej {{need.drivePct}}% Płatnerz, Kowal i Krawiec sami idą się modlić. Gdy nie mają gdzie, przy {{need.criticalPct}}% pojawia się komunikat "Chce się modlić".',
            'Zaczętą sztukę dokończą nawet przy 0%.',
          ],
        },
        {
          h: 'Gdzie się modlić',
        },
        {
          table: {
            head: ['Miejsce', 'Warunek'],
            rows: [
              ['Dom', 'Gdy płonie w nim święty ogień. Wtedy osadnik modli się najpierw w domu'],
              [
                '[[building:work_temple|Świątynia]], [[building:headquarters|Kwatera główna]]',
                'Twoja i ukończona',
              ],
            ],
            foot: 'Modlitwa trwa {{pray.seconds}} s i daje +{{pray.pct}}% Religii.',
          },
        },
        {
          h: 'Święty ogień',
        },
        {
          p: 'Rozpalisz go w Domu 3 i wyższych. 1 [[good:holy_oil|Oliwa]] starcza na {{oil.burnTime}}, pełny zapas w domu na {{oil.fullBurnTime}}. Ogień płonie także wtedy, gdy nikt się nie modli.',
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
              ['Dla kogo', 'Wszyscy twoi ludzie, dzieci tylko zdrowie'],
              ['Warunek', 'Świątynia ukończona i nieuszkodzona'],
              ['Kilka Świątyń', 'Aury się nie sumują'],
            ],
            foot: 'Zdrowie powyżej {{health.human}} zostaje, dopóki nie zabiorą go rany.',
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
          p: 'Skrzynię otworzy każdy dorosły, Magiczną skrzynię tylko [[job:druid|Druid]] i bohater. Rozkaz to "Otwórz skrzynię". Osadnik musi móc do niej dojść.',
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
            foot: 'Papier znika po użyciu, chyba że miejsce nie pasuje. Swoje papiery znajdziesz w oknie budowy pod "Papiery".',
          },
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
            foot: 'Taka skrzynia daje też osadnika w tym zawodzie i odblokowuje ten zawód.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
