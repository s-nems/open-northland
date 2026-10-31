import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Wojsko',
  items: [
    {
      id: 'damage',
      name: 'Broń, pancerz i obrażenia',
      lead: 'Człowiek ma 5000 zdrowia. Cios zabiera wartość z tabeli, a mnożniki poniżej ją zmieniają.',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: 'Skąd pada cios',
          },
        },
        {
          h: 'Co zmienia cios',
        },
        {
          table: {
            head: ['Mnożnik', 'Wartość'],
            rows: [
              ['[[article:exp-combat|Doświadczenie z tą bronią]] (tylko wręcz)', 'do ×2'],
              ['Cios od tylnego boku', '×1,25'],
              ['Cios od tyłu', '×1,5'],
              ['[[good:amulet_strength|Amulet Siły]] atakującego', '×1,5'],
              ['[[good:amulet_crithit|Amulet Precyzji]] atakującego', '20% szans na ×2'],
              ['[[good:amulet_defense|Amulet Obrony]] celu', '×0,5'],
            ],
            foot: 'Działają w tej kolejności. Przód i przedni bok dają ×1. Strzała i kamień nie rosną z trafieniami, a kierunek liczą od miejsca strzału. Kierunek i Amulet Obrony działają tylko na ludzi. Trafienia nie działają na pojazdy i palisady. Kamień z Katapulty nie dostaje amuletów dowódcy. Palisada liczy obrażenia po swojemu: [[article:walls|Palisady i bramy]].',
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
        {
          h: 'Różnice plemion',
        },
        {
          list: [
            'Saracen: [[good:bow_short|Krótki Łuk]] zadaje Tunice 245 zamiast 123, Kolczudze i Płytowej 120 zamiast 95.',
            'Bizantyjczyk: wiersz [[good:spear_wooden|Drewniana Włócznia]] pokazuje Smoka z mapy: 20000 zdrowia, zasięg 1-3, seria 5 ciosów co 4,9 s, bez pancerza 500. Wyszkolony Włócznik walczy jak w innych plemionach.',
            'Reszta broni żołnierzy jest taka sama w pięciu plemionach.',
          ],
        },
        {
          h: 'Pancerze',
        },
        {
          data: 'armour',
        },
        {
          p: 'Ciężar broni i pancerza się sumuje: [[article:walking|Szybkość chodu]].',
        },
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
      id: 'equip',
      name: 'Wyposażanie żołnierzy',
      lead: 'Liczniki klas w oknie Asystent uzbrajają wojsko. Pojedynczego człowieka zmieniasz w jego panelu.',
      blocks: [
        {
          h: 'Liczniki',
        },
        {
          table: {
            head: ['Licznik', 'Co robi', 'Maleje'],
            rows: [
              ['"Żołnierze bez broni"', 'Szkoli w Koszarach, broni nie wydaje', 'Po szkoleniu'],
              [
                '"Miecznicy", "Włócznicy", "Łucznicy"',
                'Najpierw uzbraja żołnierza bez broni, potem szkoli nowego',
                'Gdy wojownik weźmie broń',
              ],
            ],
            foot: 'Kogo wysyła do Koszar: [[article:assistant|Asystent]].',
          },
        },
        {
          list: [
            'Dopóki żołnierz bez broni czeka, licznik nie wcieli nikogo w jego miejsce, nawet gdy broni na razie nie ma.',
            'Żołnierz bez broni idzie po nią, gdy broń klasy jest w jego zasięgu i nie czekają na nią inni.',
            'Zmniejszenie licznika odwołuje tych, którzy jeszcze czekają na broń.',
          ],
        },
        {
          h: 'Rekrut po szkoleniu',
        },
        {
          table: {
            head: ['Koszary mają', 'Rekrut'],
            rows: [
              ['Broń i zbroję', 'Wychodzi ubrany'],
              ['Tylko jedno z dwóch', 'Bierze to i idzie po resztę'],
              ['Nic', 'Idzie po broń, potem po zbroję'],
            ],
            foot: 'Gdy wyższa pozycja paska leży w magazynie w zasięgu, rekrut idzie po nią, a gorszej z Koszar nie bierze. Po wyprawie wraca pod Koszary, także żołnierz uzbrojony z licznika.',
          },
        },
        {
          h: 'Paski Broń i Zbroja',
        },
        {
          p: 'Każda klasa ma swoje paski. Żołnierz bierze od lewej pierwszą pozycję z magazynu i pomija przekreślone. Na starcie paski stoją od najmocniejszej. Kliknięcie przekreśla, przytrzymanie i przesunięcie zmienia kolejność.',
        },
        {
          list: [
            'Nie ma broni do wzięcia: czeka, okno pokazuje "czeka na broń".',
            'Nie ma zbroi do wzięcia: idzie bez zbroi. Później założy ją tylko na rozkaz.',
          ],
        },
        {
          h: 'Co trzymają Koszary',
        },
        {
          table: {
            head: ['Towar', 'Sztuk'],
            rows: [
              [
                'Każda broń, zbroja, [[good:shoes|Buty]], [[good:mead|Miód Pitny]], każda mikstura i amulet',
                '60',
              ],
              ['Żywność', '25'],
              ['[[good:coin|Moneta]]', '100'],
            ],
            num: [1],
            foot: 'Priorytet zwozi towar do Koszar, 4 miejsca dla Tragarzy: [[article:hauling|Tragarze i magazyny]].',
          },
        },
        {
          h: 'Zmiana ręczna',
        },
        {
          table: {
            head: ['Kto', 'Może zmienić'],
            rows: [
              ['Żołnierz', 'Broń, Zbroja, Buty, Ekwipunek'],
              ['Mężczyzna z zawodem', 'Narzędzia, Buty, Ekwipunek'],
              ['Bohater', 'Tylko Torba: [[article:heroes|Bohaterowie]]'],
              ['Kobieta, dziecko', 'Nic'],
            ],
          },
        },
        {
          list: [
            'Osadnik idzie po rzecz i wraca tam, gdzie dostał rozkaz.',
            'Gdy po drodze nie znajdzie źródła, wraca z pustymi rękami.',
            'Broń od razu zmienia klasę żołnierza. Po zdjęciu broni zostaje [[job:soldier_unarmed|Żołnierzem]].',
            'Wymienione i zdjęte Buty, narzędzia i napoczęte butelki przepadają.',
            'Broń, pancerz i amulety się nie zużywają, więc wracają do magazynu.',
            'Rozkaz dla jednej osoby ma pierwszeństwo przed Asystentem.',
          ],
        },
        {
          h: 'Trafienia a lepsza broń',
        },
        {
          p: 'Trafienia nie blokują lepszej broni. Żołnierz bierze każdą broń z magazynu. Blokada jest przy wyrobie: [[good:spear_iron|Żelazna Włócznia]] i [[good:sword_long|Długi Miecz]] wymagają doświadczenia [[job:smith|Kowala]], [[good:bow_long|Długi Łuk]] doświadczenia [[job:armorer|Płatnerza]]. Tabela: [[article:exp-combat|Doświadczenie w walce]].',
        },
      ],
      see: [
        'article:damage',
        'article:assistant',
        'article:exp-combat',
        'article:hauling',
        'building:barracks',
      ],
    },
    {
      id: 'aim',
      name: 'Trafienie i strzelanie',
      lead: 'Cios wręcz chybia tylko wtedy, gdy cel w chwili ciosu stoi dalej niż zasięg broni. Celność łucznika rośnie z trafieniami łukiem.',
      blocks: [
        {
          h: 'Broń dystansowa',
        },
        {
          table: {
            head: ['Broń', 'Zasięg', 'Zasięg na wieży', 'Podchodzi na', 'Strzał co'],
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
        {
          h: 'Celność',
        },
        {
          table: {
            head: ['Trafienia', 'Celny strzał'],
            rows: [
              ['0', '11%'],
              ['50', '61%'],
              ['89+', '100%'],
            ],
            num: [0, 1],
            foot: 'Każde trafienie to +1%. Krótki i Długi Łuk mają wspólny licznik trafień, [[article:catapult|Katapulta]] własny, według tej samej tabeli. Bohater zawsze strzela celnie.',
          },
        },
        {
          h: 'Rozrzut niecelnej strzały',
        },
        {
          list: [
            'Niecelna strzała spada do 3 kroków od celu. Od 75 trafień nie zbacza.',
            'Niecelna strzała trafia pierwszego wroga na punkcie upadku: człowieka, zwierzę albo pojazd, potem budynek, potem palisadę.',
            'Strzała przelatuje nad swoimi, sojusznikami i neutralnymi.',
            'Żołnierz bierze poprawkę na idący cel. Budynek celuje tam, gdzie cel stoi.',
          ],
        },
        {
          h: 'Posterunek na wieży',
        },
        {
          list: [
            'Premia zasięgu działa, gdy łucznik stoi na posterunku, a nie w drodze na niego.',
            'Wróg nie może celować w strzelca na posterunku, tylko w wieżę.',
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
          figure: {
            id: 'leash',
            caption: 'Jak daleko goni',
          },
        },
        {
          table: {
            head: ['Postawa', 'Szuka wroga', 'Promień', 'Rezygnuje, gdy', 'Na cios'],
            rows: [
              ['Atak', 'Wokół siebie', '18', 'Cel padnie albo jest nieosiągalny', 'Odpowiada'],
              ['Obrona', 'Wokół miejsca postoju', '18', 'Cel ponad 40 od miejsca postoju', 'Odpowiada'],
              [
                'Ignorowanie',
                'Tylko w zasięgu broni, nie podchodzi',
                'Zasięg broni',
                'Cel ponad 18 od miejsca postoju',
                'Nie odpowiada',
              ],
            ],
            foot: 'Promienie w krokach. Miejsce postoju to punkt, w którym żołnierz stał przy zmianie postawy. Rozkaz ruchu i ataku go przesuwa.',
          },
        },
        {
          list: [
            'Żołnierz w Ataku wraca do miejsca postoju, gdy skończy walkę dalej niż 18 kroków od niego.',
            'Szukanie wroga nie zależy od [[article:fog|mgły]].',
            'Rozkaz ataku działa w każdej postawie.',
            'Łucznik na posterunku strzela do tego, co ma w zasięgu, w każdej postawie.',
            'Zwykły rozkaz ruchu trzyma żołnierza na trasie, także pod ciosami. Przy rozkazie "Atakuj po drodze" odwraca się do napastnika.',
          ],
        },
        {
          h: 'Kogo atakuje najpierw',
        },
        {
          steps: [
            'Żołnierzy, bohaterów, katapulty, wieże i budynki, które strzelają.',
            'Resztę: cywilów, pozostałe budynki, nieuzbrojone pojazdy.',
          ],
        },
        {
          p: 'Palisady i Muru obronnego żołnierz nie wybiera sam: [[article:walls|Palisady i bramy]].',
        },
        {
          h: 'Kto reaguje na cios',
        },
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
        {
          h: 'Cywile',
        },
        {
          list: [
            'Cywil ma Ignorowanie i nie walczy. Postawę ustawia się żołnierzom i bohaterom.',
            'Cywil ucieka tylko od ciosu. Widok wroga go nie rusza.',
            'Uciekający zrzuca niesiony towar. Tragarz zostawia wózek.',
          ],
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
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
              ['Zasięg widzenia', '20', '25'],
              ['Celność łuku', 'Rośnie z trafieniami', 'Zawsze celny'],
              ['Doświadczenie w walce', 'Rośnie', 'Nie rośnie'],
              ['Jedzenie i sen', 'Potrzebuje', 'Nie potrzebuje'],
              ['Buty', 'Trzeba dać, zużywają się', 'Ma od początku, nie zużywają się'],
              ['Broń, pancerz, buty', 'Można zmienić', 'Stałe'],
              ['Ciężar wyposażenia', 'Spowalnia', 'Nie spowalnia'],
              ['Dom i miejsce pracy', 'Może mieć', 'Nie ma'],
              ['Magiczna skrzynia', 'Nie otwiera', 'Otwiera'],
            ],
          },
        },
        {
          h: 'Broń bohaterów',
        },
        {
          table: {
            head: ['Bohater', 'Broń', 'Pancerz', 'Zasięg'],
            rows: [
              [
                '[[job:hero_spear_siegfried|Sigurd]]',
                'Włócznia',
                '[[good:armor_plate|Zbroja Płytowa]]',
                '1-2',
              ],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Miecz', '[[good:armor_chain|Kolczuga]]', '1'],
              ['[[job:hero_saber_hatschi|Hatchie]]', 'Szabla', '[[good:armor_chain|Kolczuga]]', '1'],
              ['[[job:hero_axe|Bohater Topornik]]', 'Topór', '[[good:armor_chain|Kolczuga]]', '1'],
              ['[[job:heroine_bow_xena|Cyra]]', 'Łuk', '[[good:armor_leather|Skórzana Zbroja]]', '4-20'],
              ['[[job:hero_unarmed|Nieuzbrojony Bohater]]', 'Pięści', '[[good:armor_wool|Tunika]]', '1'],
            ],
            num: [3],
            foot: 'Cios co 1 s. Obrażenia: opcja Bohaterowie w tabeli [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        {
          h: 'Różnice plemion',
        },
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
        {
          h: 'Torba',
        },
        {
          list: [
            'Bierze: [[good:amulet_strength|Amulet Siły]], [[good:amulet_defense|Amulet Obrony]], [[good:amulet_crithit|Amulet Precyzji]], [[good:amulet_speed|Amulet Wiatru]], [[good:potion_heal_small|Mała Lecznicza Mikstura]], [[good:potion_heal_big|Duża Lecznicza Mikstura]].',
            'Nie bierze rzeczy na potrzeby: Miód Pitny, mikstury odżywcze, mikstury wytrzymałości, [[good:amulet_food|Odżywczy Amulet]], [[good:amulet_stamina|Amulet Wytrzymałości]].',
          ],
        },
        {
          h: 'Śmierć',
        },
        {
          p: 'Broń znika. Pancerz, Buty i nieużyte rzeczy z torby zostają na ziemi.',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Wieże, alarm, schronienie',
      lead: 'Budynek na alarmie strzela sam. Każdy schroniony daje mu 0,5 strzały na sekundę.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Bij na alarm" działa na jeden budynek, "Cała osada" na wszystkie budynki obronne.',
            'Gracz podnosi alarm sam. Cios w osadnika go nie włącza.',
            'Budynek w budowie nie podnosi alarmu.',
            'Alarm trwa do "Odwołaj alarm" albo zniszczenia budynku.',
          ],
        },
        {
          h: 'Kto się chowa',
        },
        {
          list: [
            'Cywile, Kobiety i dzieci biegną do najbliższego budynku z wolnym miejscem w zasięgu chodu.',
            'Żołnierze, bohaterowie i [[job:scout|Zwiadowca]] zostają na zewnątrz.',
            'Kto nie znajdzie miejsca, pracuje dalej.',
            'Alarm wyprzedza głód i sen. Schroniony je tylko to, co niesie, i nie pracuje.',
            'Schronionego nie można zaatakować.',
            'Zniszczenie budynku wypuszcza schronionych na zewnątrz.',
          ],
        },
        {
          h: 'Budynki obronne',
        },
        {
          table: {
            head: ['Budynek', 'Miejsca', 'Strzały na sekundę', 'Posterunki'],
            rows: [
              ['[[building:headquarters|Kwatera główna]]', '30', '15', '-'],
              ['[[building:tower_01|Wieża obronna 2]]', '20', '10', '4 Krótki Łuk, 4 Długi Łuk'],
              ['[[building:tower_00|Wieża obronna 1]]', '10', '5', '3 Krótki Łuk, 3 Długi Łuk'],
              ['[[building:barracks|Koszary]]', '10', '5', '-'],
            ],
            num: [1, 2],
            foot: 'Strzały na sekundę przy komplecie schronionych. Posterunek nie zabiera miejsca w schronieniu. Łucznik zatrudniony w wieży strzela sam, bez alarmu: [[article:aim|Trafienie i strzelanie]].',
          },
        },
        {
          h: 'Strzały z budynku',
        },
        {
          table: {
            head: ['Cel', 'Strzała'],
            rows: [
              ['Bez pancerza', '375'],
              ['Tunika', '235'],
              ['Skórzana', '295'],
              ['Kolczuga, Płytowa', '145'],
              ['Pojazd', '9'],
              ['Budynek', '50'],
            ],
            num: [1],
            foot: 'Pancerz liczony z Blokadą 5, jak w [[article:damage|Broń, pancerz i obrażenia]]. Tak samo w każdym plemieniu, przed mnożnikami.',
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
        {
          h: 'Załoga wieży',
        },
        {
          table: {
            head: ['Wieża', 'Tragarze', 'Miód Pitny', 'Żywność', 'Każda broń żołnierza'],
            rows: [
              ['[[building:tower_00|Wieża obronna 1]]', '3', '25', '25', '30'],
              ['[[building:tower_01|Wieża obronna 2]]', '4', '25', '25', '40'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Miejsca Tragarzy i pojemność zapasu.',
          },
        },
        {
          list: [
            'Posterunek przyjmuje tylko swoją klasę: [[job:soldier_bow_short|Łucznika z krót. łukiem]] albo [[job:soldier_bow_long|Łucznika z dł. łukiem]]. Przydziela się go jak miejsce pracy.',
            'Inna broń zmienia klasę i zabiera posterunek.',
            'Załoga je z zapasu wieży bez schodzenia i śpi na posterunku. Pusty zapas wysyła ją po jedzenie.',
            'Asystent nie zdejmuje załogi z wieży, nawet po wyposażenie.',
            '"Wyprowadź załogę": łucznicy opuszczają wieżę i zostają zaznaczeni do następnego rozkazu. Rozkaz ruchu też zdejmuje łucznika z posterunku.',
            'Status "Obsadzony": wieża ma przydzielonego łucznika. "Brak załogi": nie ma żadnego.',
          ],
        },
      ],
      see: [
        'article:aim',
        'article:stances',
        'building:tower_00',
        'building:tower_01',
        'building:headquarters',
        'building:barracks',
        'article:equip',
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
        {
          h: 'Budowa bramy',
        },
        {
          figure: {
            id: 'gate',
            caption: 'Brama na pięciu odcinkach',
          },
        },
        {
          list: [
            'Bramę stawia się na pięciu odcinkach w linii prostej, własnych i gotowych.',
            'Każdy odcinek ma co najmniej 75% zdrowia i stoi na równym terenie.',
            'W przejściu nikt nie stoi.',
            'Brama powstaje od razu, zamknięta, z pełnym zdrowiem, także na uszkodzonym odcinku.',
          ],
        },
        {
          h: 'Tryby bramy',
        },
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
        {
          h: 'Ciosy na palisadę',
        },
        {
          table: {
            head: ['Broń', 'Punkty na cios', 'Ciosy: odcinek', 'Ciosy: brama', 'Czas: odcinek'],
            rows: [
              ['[[building:catapult|Katapulta]]', '36', '5', '14', '20 s'],
              ['Bohater wręcz', '5', '30', '100', '30 s'],
              ['[[good:spear_iron|Żelazna Włócznia]]', '5', '30', '100', '68 s'],
              ['[[good:sword_long|Długi Miecz]]', '5', '30', '100', '73 s'],
              ['[[good:sword_shord|Krótki Miecz]]', '2', '75', '250', '75 s'],
              ['[[good:spear_wooden|Drewniana Włócznia]]', '4', '38', '125', '86 s'],
              ['[[good:bow_short|Krótki Łuk]]', '1', '150', '500', '150 s'],
              ['[[good:bow_long|Długi Łuk]]', '2', '75', '250', '175 s'],
              ['Pięści, strzały z budynku', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
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
        {
          h: 'Mur obronny',
        },
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
          figure: {
            id: 'catapult-splash',
            caption: 'Gdzie spada kamień',
          },
        },
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
        {
          h: 'Kamień',
        },
        {
          table: {
            head: ['Cel', 'Obrażenia', 'Kamienie do zniszczenia'],
            rows: [
              ['Bez pancerza', '8000', '1'],
              ['Skórzana', '5995', '1'],
              ['Tunika', '3995', '2'],
              ['Kolczuga, Płytowa', '1995', '3'],
              ['Katapulta', '350', '9'],
              ['Budynek', '3625', '13-36'],
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
              ['[[building:headquarters|Kwatera główna]], Wiking', '100000', '28', '112 s'],
            ],
            num: [1, 2, 3],
            foot: 'Kwatera główna Franków: 130000 zdrowia, 36 kamieni, 144 s.',
          },
        },
        {
          h: 'Co obrywa',
        },
        {
          table: {
            head: ['Pod kamieniem', 'Kamień'],
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
        {
          h: 'Celność',
        },
        {
          p: 'Tabela: [[article:aim|Trafienie i strzelanie]]. Na 24 krokach niecelny kamień zbacza do 3 kroków przy 0 trafień, 2 przy 25, 1 przy 50, 0 od 75. Doświadczenie zbiera dowódca, 1 punkt za kamień, który kogoś zranił.',
        },
        {
          h: 'Postawy Katapulty',
        },
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
        {
          h: 'Co niszczy Katapultę',
        },
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
    {
      id: 'computer',
      name: 'Przeciwnicy komputerowi',
      lead: 'Poziom ustawia się w lobby. Trudny może wysłać pierwszą falę zaraz po końcu pokoju.',
      blocks: [
        {
          table: {
            head: ['Cecha', 'Łatwy', 'Średni', 'Trudny'],
            rows: [
              ['Pierwsza fala', '120 min', '90 min', 'Od razu'],
              ['Limit armii', '60', '100', '150'],
              ['Katapulty', '0', 'do 8', 'do 15'],
              ['Gęsty pierścień wież', 'Nie', 'Tak', 'Tak'],
              ['Place budowy naraz', '1', '1, od 60 min 2', '2, od 45 min 3, od 90 min 4'],
            ],
            foot: 'Czasy to czas gry: przy ×3 mijają trzy razy szybciej. Żadna fala nie wyjdzie przed końcem "Czasu pokoju". Łatwy i Średni nie wcielają żołnierzy ponad limit armii.',
          },
        },
        {
          h: 'Fale',
        },
        {
          table: {
            head: ['Czas od startu fal', 'Ludzi w fali'],
            rows: [
              ['0', '5-10'],
              ['1 godz.', '20-40'],
              ['2 godz.', '35-70'],
              ['3 godz. i później', '50-100'],
            ],
            num: [1],
            foot: 'Fale startują w późniejszym z dwóch momentów: "Pierwsza fala" albo koniec pokoju. Wielkość losuje się z przedziału.',
          },
        },
        {
          list: [
            'Naraz idzie jedna fala. Następna zbiera się pod [[building:barracks|Koszarami]].',
            'Zbiórka trwa do 4 minut. Po niej rusza dolna granica przedziału, a gdy tylu nie ma, wszyscy, którzy mogą dojść.',
          ],
        },
        {
          h: 'Kiedy fala rusza',
        },
        {
          list: [
            'Fala czeka, gdy masz więcej punktów: żołnierz i bohater 1, łucznik na wieży 3. Komputer liczy 1 za każdego.',
            'Broń, pancerz, amulety, mikstury i doświadczenie się nie liczą.',
            'Czeka pod Koszarami, także po zbiórce.',
            'Armia komputera doszła do limitu: fala rusza mimo to.',
          ],
        },
        {
          h: 'Cele',
        },
        {
          steps: [
            'Najbliższa [[building:headquarters|Kwatera główna]].',
            'Wieże.',
            'Pozostałe budynki, także place budowy.',
            'Ludzie.',
          ],
        },
        {
          list: [
            'Palisada i [[building:work_pottery_02|Mur obronny]] nie są celem: [[article:walls|Palisady i bramy]].',
            'Komputer celuje też przez mgłę.',
          ],
        },
        {
          h: 'Woda',
        },
        {
          list: [
            'Cel musi stać na tym samym lądzie co Koszary komputera. Fala nie wsiada na statki.',
            'Gdy Kwatera główna rywala stoi na innym lądzie, komputer stawia nad brzegiem [[building:work_joinery_03|Warszt. ciesielski 4]] i buduje [[good:ship_small|Statki]], ale nie wozi nimi wojska.',
            'Twój budynek albo człowiek na lądzie komputera staje się celem.',
            'Desant z morza robi tryb mapy, na przykład Ragnarök.',
          ],
        },
        {
          h: 'Odbudowa',
        },
        {
          p: '"AI mapy" odbudowuje budynki, gdy wroga nie ma do 40 kroków. Kwatery głównej nie.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
