import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: 'Wojsko',
  items: [
    {
      id: 'damage',
      name: 'Broń, pancerz i obrażenia',
      lead: 'Człowiek ma {{health.human}} zdrowia. Tabela pokazuje, ile zabiera jeden cios.',
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
          h: 'Co zmienia obrażenia',
        },
        {
          table: {
            head: ['Mnożnik', 'Wartość'],
            rows: [
              [
                '[[article:exp-combat|Doświadczenie z tą bronią]] (tylko wręcz)',
                'do ×{{combat.fightCapFactor}}',
              ],
              ['Cios w bok z tyłu', '×{{combat.backSideFactor}}'],
              ['Cios od tyłu', '×{{combat.behindFactor}}'],
            ],
            foot: 'Cios z przodu i w bok z przodu nie zmienia obrażeń. Amulety Siły, Precyzji i Obrony: [[article:draughts|Napoje i amulety]].',
          },
        },
        {
          list: [
            'Doświadczenie nie działa na strzały, kamienie, pojazdy i palisady.',
            'Kierunek ciosu i Amulet Obrony liczą się tylko przy ludziach. Przy strzale kierunek liczy się od miejsca, z którego strzelano.',
            'Amulety dowódcy Katapulty nie wzmacniają kamieni.',
            'Palisada liczy obrażenia inaczej: [[article:walls|Palisady i bramy]].',
            'Dziecka nie da się zranić.',
          ],
        },
        {
          h: 'Różnice plemion',
        },
        {
          p: 'Tabela liczy broń plemienia, którego herb wybierzesz u góry okna. Smok, którego u Bizantyjczyków pokazuje wiersz [[good:spear_wooden|Drewnianej Włóczni]], ma {{dragon.hitpoints}} zdrowia.',
        },
        {
          h: 'Pancerze',
        },
        {
          data: 'armour',
        },
        {
          p: 'Ciężka broń i pancerz spowalniają chód: [[article:walking|Szybkość chodu]].',
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
      lead: 'Wojsko uzbrajasz licznikami w oknie Asystenta. Pojedynczemu osadnikowi zmieniasz wyposażenie w jego panelu.',
      blocks: [
        {
          p: 'Liczniki wojska i pobór do Koszar opisuje [[article:assistant|Asystent]].',
        },
        {
          h: 'Paski Broń i Zbroja',
        },
        {
          p: 'Każdy rodzaj żołnierza ma własne paski. Żołnierz bierze pierwszą od lewej rzecz, która jest w magazynie, a przekreślone pomija. Na początku najmocniejsze rzeczy stoją po lewej. Kliknięcie przekreśla rzecz, a przeciągnięcie zmienia kolejność.',
        },
        {
          list: [
            'Gdy nie ma broni, żołnierz czeka, a okno pokazuje "czeka na broń".',
            'Gdy nie ma zbroi, idzie bez niej i później założy ją tylko na Twój rozkaz.',
          ],
        },
        {
          h: 'Rekrut po szkoleniu',
        },
        {
          table: {
            head: ['Koszary mają', 'Rekrut'],
            rows: [
              ['Broń i zbroję', 'Wychodzi w pełnym wyposażeniu'],
              ['Tylko broń albo tylko zbroję', 'Bierze to, co jest, a po resztę idzie do magazynu'],
              ['Nic', 'Idzie po broń, potem po zbroję'],
            ],
            foot: 'Gdy lepsza rzecz z paska leży w magazynie w zasięgu, rekrut idzie po nią zamiast brać gorszą z Koszar.',
          },
        },
        {
          h: 'Co trzymają Koszary',
        },
        {
          table: {
            head: ['Towar', 'Ile sztuk'],
            rows: [
              [
                'Każda broń, zbroja, [[good:shoes|Buty]], [[good:mead|Miód Pitny]], każda mikstura i amulet',
                '{{barracks.gearStock}}',
              ],
              ['Żywność', '{{barracks.foodStock}}'],
              ['[[good:coin|Moneta]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'Towar, któremu nadasz priorytet, Tragarze Koszar sami przywożą z magazynów: [[article:hauling|Tragarze i magazyny]].',
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
            'Nowa broń od razu zmienia rodzaj żołnierza. Po zdjęciu broni zostaje zwykłym [[job:soldier_unarmed|Żołnierzem]].',
            'Przy wymianie albo zdjęciu znoszone Buty, używane narzędzia i napoczęte butelki przepadają. Nieużywane wracają do magazynu.',
            'Broń, pancerz i amulety się nie zużywają i zawsze wracają do magazynu.',
          ],
        },
        {
          h: 'Kto może nosić lepszą broń',
        },
        {
          p: 'Każdy żołnierz weźmie z magazynu każdą broń, bez względu na doświadczenie. Ograniczenie dotyczy wyrobu: [[good:spear_iron|Żelazną Włócznię]] i [[good:sword_long|Długi Miecz]] zrobi tylko doświadczony [[job:smith|Kowal]], a [[good:bow_long|Długi Łuk]] tylko doświadczony [[job:armorer|Płatnerz]]. Ile doświadczenia potrzeba, podaje karta każdej z tych broni.',
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
      lead: 'Cios wręcz chybia tylko wtedy, gdy cel zdążył odejść poza zasięg broni. Łucznik strzela tym celniej, im więcej razy już trafił.',
      blocks: [
        {
          h: 'Broń dystansowa',
        },
        {
          table: {
            head: ['Broń', 'Zasięg zwykły', 'Zasięg na wieży', 'Staje do strzału w odległości'],
            rows: [
              [
                '[[good:bow_short|Krótki Łuk]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.min}}-{{shortBow.standoff}}',
              ],
              [
                '[[good:bow_long|Długi Łuk]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.min}}-{{longBow.standoff}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.min}}-{{heroBow.standoff}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Zasięg w hexach. Łucznik, który idzie do celu, staje trochę bliżej, niż sięga, żeby cel nie uciekł mu z zasięgu. Do celu bliżej niż dolna granica zasięgu nie strzela, chyba że stoi na wieży. Tempo strzałów, także Łuku myśliwego i Katapulty, pokazuje tabela w [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        {
          h: 'Celność',
        },
        {
          table: {
            head: ['Trafień', 'Szansa na celny strzał'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', 'Zawsze w cel'],
            ],
            num: [0, 1],
            foot: 'Każde trafienie dodaje 1%. Od {{aim.noSpreadHits}} trafień nawet niecelna strzała spada w cel. Krótki i Długi Łuk liczą trafienia wspólnie, [[article:catapult|Katapulta]] osobno, ale według tej samej tabeli. Bohater zawsze trafia.',
          },
        },
        {
          h: 'Rozrzut niecelnej strzały',
        },
        {
          list: [
            'Niecelna strzała spada niedaleko celu: z [[good:bow_short|Krótkiego Łuku]] do {{aim.spreadShort}} hexów, z [[good:bow_long|Długiego Łuku]] do {{aim.spreadLong}}, z Długiego Łuku na wieży do {{aim.spreadTower}}. Rozrzut rośnie z odległością.',
            'Niecelna strzała może zranić innego wroga tam, gdzie spadnie.',
            'Strzała nie rani swoich, sojuszników ani neutralnych.',
            'Łucznik bierze poprawkę na ruch wroga, a budynek strzela tam, gdzie wróg jest w chwili strzału.',
          ],
        },
        {
          h: 'Posterunek na wieży',
        },
        {
          list: ['Łucznika na posterunku nie da się trafić. Wróg może strzelać tylko do wieży.'],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Postawy',
      lead: 'Postawa mówi, czy żołnierz sam szuka wroga i jak daleko za nim idzie. Nowy żołnierz i bohater stoją w Obronie.',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: 'Jak daleko goni',
          },
        },
        {
          p: 'W Ignorowaniu żołnierz puszcza cel, który odszedł dalej niż {{stance.ignoreLeash}} hexów od miejsca postoju.',
        },
        {
          table: {
            head: ['Postawa', 'Szuka wroga', 'Promień', 'Rezygnuje, gdy', 'Gdy go uderzą'],
            rows: [
              [
                'Atak',
                'Wokół siebie',
                '{{stance.search}}',
                'Cel zginie albo nie da się do niego dojść',
                'Idzie na napastnika',
              ],
              [
                'Obrona',
                'Wokół miejsca postoju',
                '{{stance.search}}',
                'Cel odejdzie dalej niż {{stance.defendLeash}} od miejsca postoju',
                'Idzie na napastnika',
              ],
              [
                'Ignorowanie',
                'Tylko w zasięgu broni, nie podchodzi',
                'Zasięg broni',
                'Cel odejdzie dalej niż {{stance.ignoreLeash}} od miejsca postoju',
                'Zostaje na miejscu',
              ],
            ],
            foot: 'Odległości w hexach. Miejsce postoju to miejsce, w którym żołnierz stał, gdy zmieniłeś postawę. Rozkaz ruchu albo ataku ustawia je na nowo.',
          },
        },
        {
          list: [
            'Żołnierz w Ataku wraca do miejsca postoju, gdy skończy walkę dalej niż {{stance.attackReturn}} hexów od niego.',
            'Żołnierz wypatrzy wroga także we [[article:fog|mgle]].',
            'Rozkaz ataku działa w każdej postawie.',
            'Łucznik na posterunku w każdej postawie strzela do wszystkiego, co ma w zasięgu.',
            'Po zwykłym rozkazie ruchu żołnierz idzie dalej, nawet gdy ktoś go bije. Po rozkazie "Atakuj po drodze" staje do walki z napastnikiem.',
          ],
        },
        {
          h: 'Kogo atakuje najpierw',
        },
        {
          p: 'Żołnierz najpierw bije tych, którzy mogą oddać: żołnierzy, bohaterów, katapulty, wieże i strzelające budynki. Cywilów, pozostałe budynki i nieuzbrojone pojazdy zostawia na później.',
        },
        {
          p: 'Palisady ani Muru obronnego żołnierz sam nie atakuje: [[article:walls|Palisady i bramy]].',
        },
        {
          h: 'Kto reaguje na cios',
        },
        {
          table: {
            head: ['Kto', 'Odległość od rannego', 'Co robi'],
            rows: [
              ['Żołnierze i bohaterowie w Ataku lub Obronie', '{{stance.soldierAlarm}}', 'Idą na napastnika'],
              ['Żołnierze i bohaterowie w Ignorowaniu', '-', 'Biją tylko to, co w zasięgu broni'],
              [
                'Cywile i Zwiadowcy',
                '{{stance.peopleAlarm}}',
                'Uciekają {{stance.fleeMin}}-{{stance.fleeMax}} hexów i wracają do pracy',
              ],
            ],
            num: [1],
            foot: 'Odległość w hexach. Alarmuje tylko cios w człowieka, nie w budynek ani zwierzę.',
          },
        },
        {
          h: 'Cywile',
        },
        {
          list: [
            'Cywil nie walczy. Postawę ustawiasz tylko żołnierzom i bohaterom.',
            'Cywil nie ucieka na sam widok wroga.',
            'Uciekając, cywil rzuca niesiony towar, a Tragarz zostawia wózek.',
          ],
        },
        {
          h: 'Przełącznik "Jedzenie i sen"',
        },
        {
          p: 'Przy "Zabronione" żołnierz sam nie idzie jeść, spać ani się modlić. Nie je nawet tego, co niesie, ani z zapasu wieży, a głód nie przerywa mu długiego rozkazu. Jeśli nie dostaje napojów, w końcu zacznie głodować. Pomoże rozkaz Jedz albo powrót na "Dozwolone".',
        },
        {
          p: 'Napoje, amulety i rozkazy Jedz, Śpij, Módl się działają przy obu ustawieniach. W menu rozkazów te ustawienia nazywają się "Zezwól na przerwy" i "Bez przerw na potrzeby".',
        },
        {
          h: 'Odpoczynek blisko walki',
        },
        {
          table: {
            head: ['Co jest blisko', 'Hexów', 'Żołnierz'],
            rows: [
              ['Walka', 'do {{alert.restClearance}}', 'Nie śpi, nie modli się i nie rozmawia'],
              ['Wrogi żołnierz w Ataku lub Obronie, widoczny na mapie', 'do {{alert.standTo}}', 'Tak samo'],
            ],
            foot: 'Jeść idzie dopiero, gdy Energia spadnie do {{need.criticalPct}}%. W Ignorowaniu żołnierz odpoczywa normalnie.',
          },
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
              ['Zasięg wzroku w hexach', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Celność łuku', 'Rośnie z trafieniami', 'Zawsze celny'],
              ['Doświadczenie w walce', 'Rośnie', 'Rośnie tylko, gdy pozwala na to misja'],
              ['Jedzenie i sen', 'Potrzebuje', 'Nie potrzebuje'],
              ['Broń, pancerz, Buty', 'Można zmienić, Buty się zużywają', 'Stałe, Buty się nie zużywają'],
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
            head: ['Bohater', 'Broń', 'Pancerz'],
            rows: [
              ['[[job:hero_spear_siegfried|Sigurd]]', 'Włócznia', '[[good:armor_plate|Zbroja Płytowa]]'],
              ['[[job:hero_sword_bjarni|Bjarni]]', 'Miecz', '[[good:armor_chain|Kolczuga]]'],
              ['[[job:hero_saber_hatschi|Hatchie]]', 'Szabla', '[[good:armor_chain|Kolczuga]]'],
              ['[[job:heroine_bow_xena|Cyra]]', 'Łuk', '[[good:armor_leather|Skórzana Zbroja]]'],
            ],
            foot: 'Zasięg, tempo ciosów i obrażenia pokazuje tabela w [[article:damage|Broń, pancerz i obrażenia]] po włączeniu Bohaterów. Bohaterowie innego plemienia walczą trochę inaczej: wybierz jego herb u góry okna.',
          },
        },
        {
          h: 'Torba',
        },
        {
          list: [
            'Do torby bohater bierze tylko [[good:amulet_strength|Amulet Siły]], [[good:amulet_defense|Amulet Obrony]], [[good:amulet_crithit|Amulet Precyzji]], [[good:amulet_speed|Amulet Wiatru]], [[good:potion_heal_small|Mała Lecznicza Mikstura]], [[good:potion_heal_big|Duża Lecznicza Mikstura]].',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Wieże i alarm',
      lead: 'Budynek na alarmie sam strzela do wrogów. Każda osoba schowana w środku dodaje {{shelter.shotsPerSeat}} strzału na sekundę.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Bij na alarm" działa na jeden budynek, "Cała osada" na wszystkie budynki obronne.',
            'Alarm włączasz sam, atak na osadę go nie włącza.',
            'Alarm nie wyłącza się sam. Trwa, dopóki nie klikniesz "Odwołaj alarm" albo budynek nie zostanie zniszczony.',
          ],
        },
        {
          h: 'Kto się chowa',
        },
        {
          list: [
            'Cywile, kobiety i dzieci biegną do najbliższego budynku z wolnym miejscem, do którego mogą dojść.',
            'Żołnierze, bohaterowie i [[job:scout|Zwiadowca]] zostają na zewnątrz.',
            'Kto nie znajdzie miejsca, pracuje dalej.',
            'Na alarm osadnik przerywa jedzenie i sen. W środku nie pracuje i je tylko to, co ma przy sobie.',
            'Schowanego osadnika nie da się zaatakować.',
            'Gdy budynek zostanie zniszczony, schowani wychodzą.',
          ],
        },
        {
          h: 'Budynki obronne',
        },
        {
          table: {
            head: ['Budynek', 'Miejsca', 'Strzały na sekundę'],
            rows: [
              ['[[building:headquarters|Kwatera główna]]', '{{shelter.hq}}', '{{shelter.hqShots}}'],
              ['[[building:tower_01|Wieża obronna 2]]', '{{shelter.tower2}}', '{{shelter.tower2Shots}}'],
              ['[[building:tower_00|Wieża obronna 1]]', '{{shelter.tower1}}', '{{shelter.tower1Shots}}'],
              ['[[building:barracks|Koszary]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}'],
            ],
            num: [1, 2],
            foot: 'Strzały na sekundę przy pełnym budynku. Posterunki łuczników, które pokazuje karta wieży, nie zajmują miejsc dla schowanych. Łucznik zatrudniony w wieży strzela sam, bez alarmu: [[article:aim|Trafienie i strzelanie]].',
          },
        },
        {
          h: 'Strzały z budynku',
        },
        {
          p: 'Ile zabiera jedna strzała, pokazuje wiersz "Strzały z budynku" w tabeli [[article:damage|Broń, pancerz i obrażenia]].',
        },
        {
          list: [
            'Budynek strzela na {{shelter.range}} hexów od najbliższej ściany, także do wroga pod samymi murami.',
            'Budynek strzela także do wroga we mgle.',
            'Strzały nic nie kosztują i nie dają doświadczenia.',
            'Najpierw strzela do żołnierzy i bohaterów, do cywilów na samym końcu.',
          ],
        },
        {
          h: 'Zapas wieży',
        },
        {
          table: {
            head: ['Wieża', 'Mieści Miodu Pitnego', 'Mieści Żywności', 'Mieści każdej broni'],
            rows: [
              [
                '[[building:tower_00|Wieża obronna 1]]',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Wieża obronna 2]]',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Posterunki i miejsca Tragarzy pokazuje karta wieży.',
          },
        },
        {
          h: 'Załoga wieży',
        },
        {
          list: [
            'Na posterunek wejdzie tylko właściwy łucznik: [[job:soldier_bow_short|Łucznika z krót. łukiem]] albo [[job:soldier_bow_long|Łucznika z dł. łukiem]]. Przydzielasz go tak jak do miejsca pracy.',
            'Łucznik, który weźmie inną broń, traci posterunek.',
            'Załoga je z zapasu wieży i śpi na posterunku. Schodzi po jedzenie dopiero, gdy zapas się skończy.',
            'Asystent nie zabiera łuczników z wieży, nawet po nowe wyposażenie.',
            'Przycisk "Wyprowadź załogę" wyprowadza łuczników z wieży i zaznacza ich, żebyś od razu mógł wydać im rozkaz. Rozkaz ruchu też zdejmuje łucznika z posterunku.',
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
      lead: 'Palisada traci 1 zdrowia za każde pełne {{wall.damagePerPoint}} obrażeń z kolumny Budynek. Słabszy cios nic jej nie robi.',
      blocks: [
        {
          table: {
            head: ['Element', 'Zdrowie', 'Naprawa za uderzenie', 'Koszt'],
            rows: [
              ['Odcinek palisady', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1 [[good:wood|Drewno]]'],
              ['Brama', '{{wall.gateHp}}', '{{wall.gateRepair}}', 'Darmowa, powstaje z odcinków'],
            ],
            num: [1, 2],
            foot: 'Naprawa nic nie kosztuje. Jeden odcinek naprawia naraz tylko jeden Budowniczy.',
          },
        },
        {
          h: 'Budowa bramy',
        },
        {
          list: [
            'Brama zajmuje {{wall.gateSegments}} Twoich gotowych odcinków w prostej linii. Każdy musi mieć co najmniej {{wall.gateMinHealthPct}}% zdrowia i stać na równym terenie, a w przejściu nikt nie może stać.',
            'Brama staje od razu, zamknięta i z pełnym zdrowiem, nawet jeśli odcinki były uszkodzone.',
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
                'Otwarta. Zamyka się, gdy wróg podejdzie na {{wall.gateEnemyNear}} hexów, i otwiera, gdy odejdzie',
              ],
            ],
            foot: 'Bramę zamyka każdy człowiek i pojazd gracza, z którym jesteś w stanie wojny, także cywil. Zwierzęta nie.',
          },
        },
        {
          list: ['Brama zamyka się dopiero, gdy nikt nie stoi w przejściu.'],
        },
        {
          h: 'Jak szybko pada palisada',
        },
        {
          table: {
            head: [
              'Broń',
              'Zdrowia za cios',
              'Z Amuletem Siły',
              'Ciosów na odcinek',
              'Ciosów na bramę',
              'Czas na odcinek',
            ],
            rows: [
              [
                '[[building:catapult|Katapulta]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.strongBlow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}}',
              ],
              [
                'Bohater wręcz',
                '{{wall.hero.blow}}',
                '{{wall.hero.strongBlow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}}',
              ],
              [
                '[[good:spear_iron|Żelazna Włócznia]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.strongBlow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}}',
              ],
              [
                '[[good:sword_long|Długi Miecz]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.strongBlow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}}',
              ],
              [
                '[[good:sword_shord|Krótki Miecz]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.strongBlow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}}',
              ],
              [
                '[[good:spear_wooden|Drewniana Włócznia]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.strongBlow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}}',
              ],
              [
                '[[good:bow_short|Krótki Łuk]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.strongBlow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}}',
              ],
              [
                '[[good:bow_long|Długi Łuk]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.strongBlow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}}',
              ],
              ['Pięści, strzały z budynku', '0', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Czas dla jednego żołnierza. Amulet dowódcy nie wzmacnia kamieni Katapulty. Cyra zabiera {{wall.heroBow.blow}} zdrowia palisady na strzał, Cyra Franków {{wall.frankHeroBow.blow}}.',
          },
        },
        {
          list: [
            'Doświadczenie w walce nie wzmacnia ciosów w palisadę.',
            'Żołnierz sam nie atakuje palisady. Bije ją na rozkaz albo wtedy, gdy zagradza mu drogę do wroga.',
            'Gdy padnie jeden odcinek, żołnierze idą przez wyłom i nie burzą sąsiednich.',
          ],
        },
        {
          h: 'Mur obronny',
        },
        {
          p: '[[building:work_pottery_02|Mur obronny]] to zwykły budynek i dostaje obrażenia z kolumny Budynek. Żołnierz traktuje go jak palisadę.',
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
      lead: 'Kamień rani wszystko na hexie upadku i sześciu hexach dookoła, także Twoich ludzi.',
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: 'Gdzie spada kamień',
          },
        },
        {
          p: 'Katapultę prowadzi 1 żołnierz albo bohater, z dowolną bronią. Bez dowódcy nie rusza się i nie strzela. Kamienie nic nie kosztują. Zdrowie, zasięg, tempo strzałów i koszt pokazuje karta [[building:catapult|Katapulty]].',
        },
        {
          h: 'Kamień',
        },
        {
          p: 'Ile kamień zabiera ludziom, pojazdom i budynkom, pokazuje wiersz Katapulty w tabeli [[article:damage|Broń, pancerz i obrażenia]]. Palisada liczy to inaczej: [[article:walls|Palisady i bramy]].',
        },
        {
          table: {
            head: ['Budynek', 'Zdrowie', 'Kamieni do zniszczenia', 'Czas dla 1 Katapulty'],
            rows: [
              [
                '[[building:tower_00|Wieża obronna 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}}',
              ],
              [
                '[[building:tower_01|Wieża obronna 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}}',
              ],
              [
                '[[building:headquarters|Kwatera główna]], Wiking',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Kwatera główna Franków: {{hp.frankHq}} zdrowia, {{stone.frankHq}} kamieni, {{stone.frankHqSeconds}}.',
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
              ['Gracz, z którym masz pokój ustawiony w lobby', 'Omija'],
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
          p: 'Celność rośnie jak u łucznika: [[article:aim|Trafienie i strzelanie]]. Na {{catapult.max}} hexach niecelny kamień spada do {{stone.spread.0}} hexów od celu przy 0 trafień, {{stone.spread.25}} przy 25, {{stone.spread.50}} przy 50. Od {{aim.noSpreadHits}} trafień spada w cel. Trafienia zbiera dowódca: liczy się każdy kamień, który coś uszkodził, także budynek, ale tylko raz, nawet gdy trafił kilka celów.',
        },
        {
          h: 'Postawy Katapulty',
        },
        {
          table: {
            head: ['Postawa', 'Szuka wroga', 'Promień', 'Rusza się'],
            rows: [
              ['Atak', 'Wokół siebie', '{{catapult.searchRadius}}', 'Tak'],
              [
                'Obrona',
                'Wokół swojej pozycji',
                '{{catapult.searchRadius}}',
                'Tak, do {{catapult.leash}} hexów od pozycji',
              ],
              ['Ignorowanie', 'Wokół swojej pozycji', '{{catapult.min}}-{{catapult.max}}', 'Nie'],
            ],
            foot: 'Nowa Katapulta stoi w Ignorowaniu. Sama atakuje tylko cel, który widzi. Rozkaz ataku działa w każdej postawie.',
          },
        },
        {
          list: [
            'Gdy cel jest bliżej niż {{catapult.min}} hexów, Katapulta odjeżdża. Gdy jest dalej niż {{catapult.max}}, podjeżdża na {{catapult.bandMin}}-{{catapult.max}} hexy.',
            'Strzela tylko, gdy stoi i nie styka się z innym pojazdem.',
            'Możesz kazać jej strzelać w dowolne miejsce na ziemi. Palisadę ostrzeliwuje tylko na rozkaz.',
          ],
        },
        {
          h: 'Co niszczy Katapultę',
        },
        {
          table: {
            head: ['Broń', 'Obrażenia', 'Trafień do zniszczenia'],
            rows: [
              ['Druga Katapulta', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                'Włócznie, [[good:sword_long|Długi Miecz]], [[good:bow_long|Długi Łuk]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|Krótki Miecz]], [[good:bow_short|Krótki Łuk]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['Pięści', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['Strzała z budynku', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: 'Doświadczenie nie działa na pojazdy, amulety atakującego działają.',
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
  ],
};
