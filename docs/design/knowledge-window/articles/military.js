export const GROUP = {
  group: 'Wojsko',
  items: [
    {
      id: 'damage',
      name: 'Broń, pancerz i obrażenia',
      lead: 'Człowiek ma 5000 zdrowia. Cios zabiera wartość z tabeli, a mnożniki poniżej ją zmieniają.',
      blocks: [
        { data: 'matrix' },
        { h: 'Co zmienia cios' },
        {
          table: {
            head: ['Mnożnik', 'Wartość'],
            rows: [
              [
                'Trafienia tą klasą broni, tylko wręcz: [[article:exp-combat|Doświadczenie w walce]]',
                'do ×2',
              ],
              ['Cios od tylnego boku', '×1,25'],
              ['Cios od tyłu', '×1,5'],
              ['[[good:amulet_strength|Amulet Siły]] atakującego', '×1,5'],
              ['[[good:amulet_crithit|Amulet Precyzji]] atakującego', '20% szans na ×2'],
              ['[[good:amulet_defense|Amulet Obrony]] celu', '×0,5'],
            ],
            foot: 'Działają w tej kolejności. Przód i przedni bok dają ×1. Strzała i kamień nie rosną z trafieniami, a kierunek liczą od miejsca strzału.',
          },
        },
        {
          list: [
            'Wynik 0 lub mniej nie rani i nie daje doświadczenia.',
            'Dziecka nie da się zranić.',
            'Broń i pancerz nie zużywają się.',
            'Broń i pancerz nosi tylko dorosły mężczyzna.',
          ],
        },
        { h: 'Co działa na jaki cel' },
        {
          table: {
            head: ['Mnożnik', 'Człowiek', 'Zwierzę', 'Budynek', 'Pojazd', 'Palisada'],
            rows: [
              ['Kolumna tabeli', 'Pancerz', 'Skórzana', 'Budynek', 'Pojazd', 'Budynek'],
              ['Doświadczenie', 'Tak', 'Tak', 'Tak', 'Nie', 'Nie'],
              ['Kierunek', 'Tak', 'Nie', 'Nie', 'Nie', 'Nie'],
              ['Amulet Siły, Precyzji', 'Tak', 'Tak', 'Tak', 'Tak', 'Tak'],
              ['Amulet Obrony', 'Tak', 'Nie', 'Nie', 'Nie', 'Nie'],
            ],
            foot: 'Kamień z katapulty nie dostaje amuletów dowódcy. Palisada liczy obrażenia po swojemu: [[article:walls|Palisady i bramy]].',
          },
        },
        { h: 'Różnice plemion' },
        {
          table: {
            head: ['Broń', 'Plemię', 'Różnica'],
            rows: [
              [
                '[[good:bow_short|Krótki Łuk]]',
                'Saracen',
                'Tunika 245 zamiast 123, Kolczuga i Płytowa 120 zamiast 95',
              ],
              [
                '[[good:spear_wooden|Drewniana Włócznia]]',
                'Bizantyjczyk',
                'Smok z mapy: 20000 zdrowia, zasięg 1-3, seria 5 ciosów co 4,9 s, bez pancerza 500. Wyszkolony Włócznik walczy jak w innych plemionach',
              ],
            ],
            foot: 'Reszta broni żołnierzy jest taka sama w pięciu plemionach.',
          },
        },
        { h: 'Pancerze' },
        { data: 'armour' },
        { p: 'Ciężar broni i pancerza się sumuje: [[article:walking|Szybkość chodu]].' },
      ],
      see: [
        'article:exp-combat',
        'article:aim',
        'article:walking',
        'good:spear_iron',
        'good:sword_long',
        'good:armor_chain',
        'good:armor_plate',
      ],
    },
    {
      id: 'aim',
      name: 'Trafienie i strzelanie',
      lead: 'Cios wręcz chybia tylko wtedy, gdy cel w chwili ciosu stoi dalej niż zasięg broni. Celność łucznika rośnie z trafieniami łukiem.',
      blocks: [
        { h: 'Broń dystansowa' },
        {
          table: {
            head: ['Broń', 'Zasięg', 'Z posterunku', 'Podchodzi na', 'Strzał co'],
            rows: [
              ['[[good:bow_short|Krótki Łuk]]', '3-15', '0-20', '13', '1 s'],
              ['[[good:bow_long|Długi Łuk]]', '4-23', '0-28', '21', '2,3 s'],
              ['[[job:hunter|Myśliwy]]', '3-17', '-', '-', '2,1 s'],
              ['[[job:heroine_bow_xena|Cyra]]', '4-20', '-', '18', '1 s'],
              ['[[building:catapult|Katapulta]]', '8-24', '-', '19-24', '4 s'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Zasięg w krokach. Poniżej dolnej granicy łucznik nie strzela. Cyra u Franków: zasięg 3-12, strzał co 2,3 s.',
          },
        },
        { h: 'Celność' },
        {
          table: {
            head: ['Trafienia', 'Celny strzał'],
            rows: [
              ['0', '11%'],
              ['10', '21%'],
              ['25', '36%'],
              ['50', '61%'],
              ['75', '86%'],
              ['89+', '100%'],
            ],
            num: [0, 1],
            foot: 'Krótki i Długi Łuk mają wspólny licznik trafień, [[article:catapult|Katapulta]] własny, według tej samej tabeli. Bohater zawsze strzela celnie.',
          },
        },
        { h: 'Rozrzut niecelnej strzały' },
        {
          table: {
            head: ['Odległość', '0 trafień', '25 trafień', '50 trafień', '75 trafień'],
            rows: [
              ['0-7', '0', '0', '0', '0'],
              ['8-11', '1', '1', '0', '0'],
              ['12-15', '1', '1', '1', '0'],
              ['16-19', '2', '1', '1', '0'],
              ['20-23', '2', '2', '1', '0'],
              ['24-28', '3', '2', '1', '0'],
            ],
            num: [0, 1, 2, 3, 4],
            foot: 'Największe przesunięcie w każdej osi, w krokach, przy najgorszym rzucie.',
          },
        },
        {
          list: [
            'Niecelna strzała trafia pierwszego wroga na punkcie upadku: człowieka, zwierzę albo pojazd, potem budynek, potem palisadę.',
            'Strzała przelatuje nad swoimi, sojusznikami i neutralnymi.',
            'Żołnierz bierze poprawkę na idący cel. Budynek celuje tam, gdzie cel stoi.',
          ],
        },
        { h: 'Posterunek na wieży' },
        {
          list: [
            'Premia zasięgu działa, gdy łucznik stoi na posterunku, a nie w drodze na niego.',
            'Wróg nie może celować w strzelca na posterunku, tylko w wieżę.',
            'Broń wręcz nie zyskuje na posterunku.',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Postawy',
      lead: 'Żołnierz i bohater zaczynają w Obronie.',
      blocks: [
        {
          table: {
            head: ['Postawa', 'Szuka wroga', 'Promień', 'Puszcza cel', 'Na cios'],
            rows: [
              ['Atak', 'Wokół siebie', '18', 'Gdy cel padnie albo jest nieosiągalny', 'Odpowiada'],
              ['Obrona', 'Wokół punktu postawy', '18', 'Cel ponad 40 od punktu postawy', 'Odpowiada'],
              [
                'Ignorowanie',
                'Tylko w zasięgu broni, nie podchodzi',
                'Zasięg broni',
                'Cel ponad 18 od punktu postawy',
                'Nie odpowiada',
              ],
            ],
            foot: 'Promienie w krokach. Punkt postawy to miejsce, gdzie żołnierz stał przy zmianie postawy. Rozkaz ruchu i ataku go przesuwa.',
          },
        },
        {
          list: [
            'Żołnierz w Ataku wraca do punktu postawy, gdy skończy walkę dalej niż 18 kroków od niego.',
            'Szukanie wroga nie zależy od [[article:fog|mgły]].',
            'Rozkaz ataku działa w każdej postawie.',
            'Łucznik na posterunku strzela do tego, co ma w zasięgu, w każdej postawie.',
            'Zwykły rozkaz ruchu trzyma żołnierza na trasie, także pod ciosami. Przy rozkazie "Atakuj po drodze" odwraca się do napastnika.',
          ],
        },
        { h: 'Kogo wybiera' },
        {
          steps: [
            'Żołnierzy, bohaterów, katapulty, wieże i budynki, które strzelają.',
            'Resztę: cywilów, pozostałe budynki, nieuzbrojone pojazdy.',
          ],
        },
        { p: 'Palisady i Muru obronnego żołnierz nie wybiera sam: [[article:walls|Palisady i bramy]].' },
        { h: 'Kto reaguje na cios' },
        {
          table: {
            head: ['Kto', 'Od rannego, kroki', 'Reakcja'],
            rows: [
              ['Żołnierze i bohaterowie w Ataku lub Obronie', '40', 'Idą na napastnika'],
              ['Żołnierze i bohaterowie w Ignorowaniu', '-', 'Biją tylko to, co w zasięgu broni'],
              ['Cywile i Zwiadowcy', '20', 'Uciekają 10-15 kroków i wracają do pracy'],
              ['Ludzie w budynkach', '-', 'Nie reagują, poza łucznikiem na posterunku'],
              ['Cywil śpiący na otwartym terenie', '-', 'Śpi, ucieka tylko uderzony'],
            ],
            num: [1],
            foot: 'Reakcję wywołuje tylko cios w człowieka.',
          },
        },
        { h: 'Cywile' },
        {
          list: [
            'Cywil ma Ignorowanie i nie walczy. Postawę ustawia się żołnierzom i bohaterom.',
            'Cywil ucieka tylko od ciosu. Widok wroga go nie rusza.',
            'Uciekający zrzuca niesiony towar. Tragarz zostawia wózek.',
          ],
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog'],
    },
    {
      id: 'heroes',
      name: 'Bohaterowie',
      lead: 'Bohater przychodzi z mapy. Nie da się go wyszkolić ani zmienić mu zawodu.',
      blocks: [
        {
          table: {
            head: ['Cecha', 'Żołnierz', 'Bohater'],
            rows: [
              ['Zdrowie', '5000', '5000'],
              ['Zasięg widzenia', '20', '25'],
              ['Celność łuku', 'Rośnie z trafieniami', 'Zawsze celny'],
              ['Doświadczenie w walce', 'Rośnie', 'Nie rośnie'],
              ['Jedzenie i sen', 'Potrzebuje', 'Nie potrzebuje'],
              ['Buty', 'Trzeba dać, zużywają się', 'Ma od początku, nie zużywają się'],
              ['Broń, pancerz, buty', 'Można zmienić', 'Stałe'],
              ['Ciężar wyposażenia', 'Wydłuża krok', 'Nie wydłuża'],
              ['Dom i miejsce pracy', 'Może mieć', 'Nie ma'],
              ['Magiczna skrzynia', 'Nie otwiera', 'Otwiera'],
            ],
          },
        },
        { h: 'Broń bohaterów' },
        {
          table: {
            head: ['Bohater', 'Broń', 'Pancerz', 'Zasięg', 'Cios co'],
            rows: [
              [
                '[[job:hero_spear_siegfried|Sigurd]]',
                'Włócznia',
                '[[good:armor_plate|Zbroja Płytowa]]',
                '1-2',
                '1 s',
              ],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Miecz', '[[good:armor_chain|Kolczuga]]', '1', '1 s'],
              ['[[job:hero_saber_hatschi|Hatchie]]', 'Szabla', '[[good:armor_chain|Kolczuga]]', '1', '1 s'],
              ['[[job:hero_axe|Bohater Topornik]]', 'Topór', '[[good:armor_chain|Kolczuga]]', '1', '1 s'],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                'Łuk',
                '[[good:armor_leather|Skórzana Zbroja]]',
                '4-20',
                '1 s',
              ],
              [
                '[[job:hero_unarmed|Nieuzbrojony Bohater]]',
                'Pięści',
                '[[good:armor_wool|Tunika]]',
                '1',
                '1 s',
              ],
            ],
            num: [3, 4],
            foot: 'Obrażenia: opcja Bohaterowie w tabeli [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        { h: 'Różnice plemion' },
        {
          table: {
            head: ['Bohater', 'Plemię', 'Różnica'],
            rows: [
              ['Sigurd', 'Egipcjanin', 'Kolczuga 375'],
              ['Hatchie', 'Saracen', '2 ciosy co 1,8 s'],
              ['Bohater Topornik', 'Wiking', 'Płytowa 945, cios co 2 s'],
              [
                'Cyra',
                'Frank',
                'Zasięg 3-12, strzał co 2,3 s, bez pancerza 60, Tunika i Skórzana 55, Kolczuga i Płytowa 35, Budynek i Pojazd 40',
              ],
              ['Nieuzbrojony Bohater', 'Bizantyjczyk, Egipcjanin', 'Seria 5 ciosów co 4,9 s'],
            ],
          },
        },
        { h: 'Torba' },
        {
          list: [
            'Bierze: [[good:amulet_strength|Amulet Siły]], [[good:amulet_defense|Amulet Obrony]], [[good:amulet_crithit|Amulet Precyzji]], [[good:amulet_speed|Amulet Wiatru]], [[good:potion_heal_small|Mała Lecznicza Mikstura]], [[good:potion_heal_big|Duża Lecznicza Mikstura]].',
            'Nie bierze rzeczy na potrzeby: Miód Pitny, mikstury odżywcze, mikstury wytrzymałości, [[good:amulet_food|Odżywczy Amulet]], [[good:amulet_stamina|Amulet Wytrzymałości]].',
          ],
        },
        { h: 'Śmierć' },
        { p: 'Broń znika. Pancerz, Buty i nieużyte rzeczy z torby zostają na ziemi.' },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Wieże, alarm, schronienie',
      lead: 'Budynek na alarmie strzela sam. Każdy schroniony daje mu 0,5 strzały na sekundę.',
      blocks: [
        { h: 'Budynki obronne' },
        {
          table: {
            head: [
              'Budynek',
              'Miejsca',
              'Strzały na sekundę',
              'Posterunki: Krótki Łuk',
              'Posterunki: Długi Łuk',
            ],
            rows: [
              ['[[building:headquarters|Kwatera główna]]', '30', '15', '-', '-'],
              ['[[building:tower_01|Wieża obronna 2]]', '20', '10', '4', '4'],
              ['[[building:tower_00|Wieża obronna 1]]', '10', '5', '3', '3'],
              ['[[building:barracks|Koszary]]', '10', '5', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Strzały na sekundę przy komplecie schronionych. Posterunek nie zabiera miejsca w schronieniu. Łucznik zatrudniony w wieży strzela sam, bez alarmu: [[article:aim|Trafienie i strzelanie]].',
          },
        },
        { h: 'Alarm' },
        {
          list: [
            '"Bij na alarm" działa na jeden budynek, "Cała osada" na wszystkie budynki obronne.',
            'Gracz podnosi alarm sam. Cios w osadnika go nie włącza.',
            'Budynek w budowie nie podnosi alarmu.',
            'Alarm trwa do "Odwołaj alarm" albo zniszczenia budynku.',
          ],
        },
        { h: 'Kto się chowa' },
        {
          list: [
            'Cywile, Kobiety, dzieci i niemowlęta biegną do najbliższego budynku z wolnym miejscem w zasięgu chodu.',
            'Żołnierze, bohaterowie i [[job:scout|Zwiadowca]] zostają na zewnątrz.',
            'Kto nie znajdzie miejsca, pracuje dalej.',
            'Alarm wyprzedza głód i sen. Schroniony je tylko to, co niesie, i nie pracuje.',
            'Schronionego nie można zaatakować.',
            'Zniszczenie budynku wypuszcza schronionych na zewnątrz.',
          ],
        },
        { h: 'Strzały z budynku' },
        {
          table: {
            head: ['Cel', 'Strzała', 'Na sekundę przy 10 schronionych'],
            rows: [
              ['Bez pancerza', '375', '1875'],
              ['Tunika', '240', '1200'],
              ['Skórzana', '300', '1500'],
              ['Kolczuga, Płytowa', '150', '750'],
              ['Pojazd', '9', '45'],
              ['Budynek', '50', '250'],
            ],
            num: [1, 2],
            foot: 'Wartości takie same w każdym plemieniu, przed mnożnikami z [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        {
          list: [
            'Zasięg to 29 kroków od najbliższej ściany budynku, bez dolnej granicy.',
            'Budynek strzela także do wroga we mgle.',
            'Strzały nic nie kosztują i nie dają doświadczenia.',
            'Kolejność celów: żołnierze i bohaterowie, dzikie zwierzęta, budynki, pozostali ludzie.',
          ],
        },
        { h: 'Zdrowie budynków' },
        {
          table: {
            head: ['Budynek', 'Wiking', 'Frank', 'Bizantyjczyk', 'Saracen', 'Egipcjanin'],
            rows: [
              ['Kwatera główna', '100000', '130000', '110000', '100000', '100000'],
              ['Koszary', '90000', '130000', '110000', '90000', '100000'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Wieża obronna 2 ma 65000 zdrowia, Wieża obronna 1 ma 45000, w każdym plemieniu.',
          },
        },
      ],
      see: [
        'article:aim',
        'article:stances',
        'building:tower_00',
        'building:tower_01',
        'building:headquarters',
        'building:barracks',
      ],
    },
    {
      id: 'walls',
      name: 'Palisady i bramy',
      lead: 'Cios zabiera palisadzie 1 punkt zdrowia za każde pełne 100 obrażeń przeciw budynkom. Mniej niż 100 nie robi nic.',
      blocks: [
        {
          table: {
            head: ['Element', 'Zdrowie', 'Naprawa na cios', 'Koszt'],
            rows: [
              ['Odcinek palisady', '150', '5', '1 [[good:wood|Drewno]]'],
              ['Brama', '500', '5', 'Darmowa, powstaje z odcinków'],
            ],
            num: [1, 2],
            foot: 'Naprawa nic nie kosztuje. Palisadę naprawia jeden Budowniczy naraz.',
          },
        },
        { h: 'Ciosy na palisadę' },
        {
          table: {
            head: [
              'Broń',
              'Przeciw budynkom',
              'Punkty na cios',
              'Ciosy: odcinek',
              'Ciosy: brama',
              'Czas: odcinek',
            ],
            rows: [
              ['[[building:catapult|Katapulta]]', '3625', '36', '5', '14', '20 s'],
              ['Bohater wręcz', '550', '5', '30', '100', '30 s'],
              ['[[good:spear_iron|Żelazna Włócznia]]', '500', '5', '30', '100', '68 s'],
              ['[[good:sword_long|Długi Miecz]]', '500', '5', '30', '100', '73 s'],
              ['[[good:spear_wooden|Drewniana Włócznia]]', '450', '4', '38', '125', '86 s'],
              ['[[good:bow_long|Długi Łuk]]', '250', '2', '75', '250', '175 s'],
              ['[[good:sword_shord|Krótki Miecz]]', '225', '2', '75', '250', '75 s'],
              ['[[good:bow_short|Krótki Łuk]]', '100', '1', '150', '500', '150 s'],
              ['Pięści, strzały z budynku', '50', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Czas dla jednego żołnierza. Cyra 2 punkty, u Franków 0.',
          },
        },
        {
          list: [
            'Doświadczenie w walce nie podnosi ciosu w palisadę.',
            'Amulet Siły liczy się od punktów: 5 daje 7, 2 daje 3, 1 zostaje 1.',
            'Żołnierz nie wybiera palisady sam. Bije ją na rozkaz albo wtedy, gdy zagradza mu drogę do wroga.',
            'Gdy odcinek padnie, żołnierze idą przez wyłom i przestają rąbać sąsiednie.',
          ],
        },
        { h: 'Budowa bramy' },
        {
          list: [
            'Bramę stawia się na pięciu odcinkach w linii prostej, własnych i gotowych.',
            'Każdy odcinek ma co najmniej 75% zdrowia i stoi na równym terenie.',
            'W przejściu nikt nie stoi.',
            'Brama powstaje od razu, zamknięta, z pełnym zdrowiem, także na uszkodzonym odcinku.',
          ],
        },
        { h: 'Tryby bramy' },
        {
          table: {
            head: ['Tryb', 'Działanie'],
            rows: [
              ['Otwórz', 'Przechodzi każdy, także wróg'],
              ['Zamknij', 'Nikt nie przechodzi, także swoi'],
              [
                'Automatyczny',
                'Otwarta. Zamyka się, gdy wróg jest do 12 kroków od bramy, potem znów się otwiera',
              ],
            ],
            foot: 'W trybie automatycznym liczą się żywi ludzie i pojazdy gracza w stanie wojny, cywile też. Zwierzęta i budynki się nie liczą.',
          },
        },
        {
          list: [
            'Brama zamyka się dopiero, gdy nikt nie stoi w przejściu.',
            'Komputer ustawia swoje bramy na tryb automatyczny.',
          ],
        },
        { h: 'Mur obronny' },
        {
          p: '[[building:work_pottery_02|Mur obronny]] jest budynkiem: 100000 zdrowia, obrażenia z kolumny Budynek. Żołnierz bije go tylko na rozkaz albo gdy zagradza drogę do wroga.',
        },
      ],
      see: [
        'article:damage',
        'article:catapult',
        'article:construction',
        'building:work_pottery_02',
        'good:wood',
      ],
    },
    {
      id: 'catapult',
      name: 'Katapulty',
      lead: 'Kamień rani wszystko na punkcie upadku i sześciu punktach dookoła, także swoich.',
      blocks: [
        {
          table: {
            head: ['Cecha', 'Wartość'],
            rows: [
              ['Zasięg', '8-24 kroki'],
              ['Strzał co', '4 s'],
              ['Zdrowie', '3000'],
              ['Załoga', '1 żołnierz albo bohater, z dowolną bronią'],
              ['Koszt', '[[building:catapult|Katapulta]]: 9 [[good:wood|Drewno]], 1 [[good:iron|Żelazo]]'],
            ],
            foot: 'Bez dowódcy Katapulta nie jedzie i nie strzela. Kamienie nic nie kosztują.',
          },
        },
        { h: 'Kamień' },
        {
          table: {
            head: ['Cel', 'Obrażenia', 'Kamienie do zniszczenia'],
            rows: [
              ['Bez pancerza', '8000', '1'],
              ['Skórzana', '5995', '1'],
              ['Tunika', '3995', '2'],
              ['Kolczuga, Płytowa', '1995', '3'],
              ['Katapulta', '350', '9'],
              ['Budynek', '3625', 'tabela niżej'],
              ['Odcinek palisady', '36 punktów', '5'],
              ['Brama', '36 punktów', '14'],
            ],
            num: [2],
            foot: 'Człowiek bez kierunku ciosu i amuletów. Trafienia Katapultą nie podnoszą obrażeń.',
          },
        },
        {
          table: {
            head: ['Budynek', 'Zdrowie', 'Kamienie', 'Czas'],
            rows: [
              ['[[building:tower_00|Wieża obronna 1]]', '45000', '13', '52 s'],
              ['[[building:tower_01|Wieża obronna 2]]', '65000', '18', '72 s'],
              ['[[building:barracks|Koszary]], Wiking', '90000', '25', '100 s'],
              ['[[building:headquarters|Kwatera główna]], Wiking', '100000', '28', '112 s'],
              ['[[building:work_pottery_02|Mur obronny]]', '100000', '28', '112 s'],
              ['Kwatera główna, Frank', '130000', '36', '144 s'],
            ],
            num: [1, 2, 3],
          },
        },
        { h: 'Co obrywa' },
        {
          table: {
            head: ['Na siedmiu punktach', 'Kamień'],
            rows: [
              ['Wróg', 'Rani'],
              ['Swoi ludzie, pojazdy, budynki, palisady', 'Rani'],
              ['Neutralni i sojusznicy', 'Rani, nie psuje stosunków'],
              ['Gracz w pokoju ustalonym w lobby', 'Omija'],
              ['Dzieci', 'Omija'],
              ['Ludzie wewnątrz budynków', 'Omija'],
              ['Drzewa', 'Przewraca'],
            ],
          },
        },
        { h: 'Celność' },
        {
          table: {
            head: ['Trafienia Katapultą', 'Celny strzał', 'Przesunięcie na 24 kroki'],
            rows: [
              ['0', '11%', '3'],
              ['25', '36%', '2'],
              ['50', '61%', '1'],
              ['75', '86%', '0'],
              ['89+', '100%', '0'],
            ],
            num: [0, 1, 2],
            foot: 'Przesunięcie w każdej osi, w krokach, przy najgorszym rzucie. Doświadczenie zbiera dowódca, 1 punkt za kamień, który kogoś zranił.',
          },
        },
        { h: 'Postawy Katapulty' },
        {
          table: {
            head: ['Postawa', 'Szuka wroga', 'Promień', 'Rusza się'],
            rows: [
              ['Atak', 'Wokół siebie', '40', 'Tak'],
              ['Obrona', 'Wokół swojej pozycji', '40', 'Tak, do 60 od pozycji'],
              ['Ignorowanie', 'Wokół swojej pozycji', '8-24', 'Nie'],
            ],
            foot: 'Nowa Katapulta stoi w Ignorowaniu. Sama wybiera tylko cel, który widzi. Rozkaz ataku działa w każdej postawie.',
          },
        },
        {
          list: [
            'Cel bliżej niż 8 kroków: Katapulta odjeżdża. Cel dalej niż 24: podjeżdża na 19-24 kroki.',
            'Strzela tylko z postoju i tylko wtedy, gdy nie styka się z innym pojazdem.',
            'Rozkaz może wskazać punkt na ziemi. Palisadę bije tylko na rozkaz.',
          ],
        },
        { h: 'Co niszczy Katapultę' },
        {
          table: {
            head: ['Broń', 'Obrażenia', 'Ciosy na Katapultę'],
            rows: [
              ['Druga Katapulta', '350', '9'],
              ['Włócznie, [[good:sword_long|Długi Miecz]], [[good:bow_long|Długi Łuk]]', '125', '24'],
              ['[[good:sword_shord|Krótki Miecz]], [[good:bow_short|Krótki Łuk]]', '40', '75'],
              ['Pięści', '15', '200'],
              ['Strzała z budynku', '9', '334'],
            ],
            num: [1, 2],
            foot: 'Doświadczenie w walce nie podnosi ciosu w pojazd. Amulety atakującego działają.',
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
  ],
};
