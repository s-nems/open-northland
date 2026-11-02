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
              ['[[good:amulet_strength|Amulet Siły]] atakującego', '×{{amulet.strengthFactor}}'],
              [
                '[[good:amulet_crithit|Amulet Precyzji]] atakującego',
                '{{amulet.critChancePct}}% szans na ×{{amulet.critFactor}}',
              ],
              ['[[good:amulet_defense|Amulet Obrony]] celu', '×{{amulet.defenseFactor}}'],
            ],
            foot: 'Cios z przodu i w bok z przodu nie zmienia obrażeń.',
          },
        },
        {
          list: [
            'Doświadczenie nie działa na strzały, kamienie, pojazdy i palisady.',
            'Kierunek i Amulet Obrony działają tylko na ludzi. Dla strzały liczy się miejsce, z którego padł strzał.',
            'Amulety dowódcy nie działają na kamień z Katapulty.',
            'Palisada liczy obrażenia inaczej: [[article:walls|Palisady i bramy]].',
            'Cios za 0 nie rani i nie daje doświadczenia.',
            'Dziecka nie da się zranić.',
          ],
        },
        {
          h: 'Różnice plemion',
        },
        {
          list: [
            'Saracen: [[good:bow_short|Krótki Łuk]] zadaje Tunice {{saracen.bowOnWool}} zamiast {{viking.bowOnWool}}, Kolczudze i Płytowej {{saracen.bowOnChain}} zamiast {{viking.bowOnChain}}.',
            'Bizantyjczyk: Smok z mapy walczy własną [[good:spear_wooden|Drewnianą Włócznią]]: {{dragon.hitpoints}} zdrowia, zasięg {{dragon.min}}-{{dragon.max}}, {{dragon.blows}} ciosów co {{dragon.seconds}} s, {{dragon.bare}} obrażeń bez pancerza. Tabela pokazuje go w tym wierszu. Wyszkolony Włócznik walczy jak w innych plemionach.',
            'Reszta broni jest taka sama we wszystkich plemionach.',
          ],
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
      lead: 'Wojsko uzbrajasz licznikami w oknie Asystent. Jedną osobę przebierasz w jej panelu.',
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
            'Dopóki żołnierz bez broni czeka, licznik nie szkoli nowego, nawet gdy broni na razie nie ma.',
            'Żołnierz bez broni idzie po nią, gdy broń tego rodzaju leży w jego zasięgu i nikt inny na nią nie czeka.',
            'Gdy zmniejszysz licznik, czekający na broń przestają czekać.',
          ],
        },
        {
          h: 'Paski Broń i Zbroja',
        },
        {
          p: 'Każdy rodzaj żołnierza ma swoje paski. Żołnierz bierze pierwszą od lewej rzecz, która jest w magazynie, i pomija przekreślone. Na starcie najmocniejsza stoi po lewej. Kliknięcie przekreśla, przytrzymanie i przesunięcie zmienia kolejność.',
        },
        {
          list: [
            'Nie ma broni do wzięcia: czeka, okno pokazuje "czeka na broń".',
            'Nie ma zbroi do wzięcia: idzie bez zbroi. Później założy ją tylko na rozkaz.',
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
            foot: 'Gdy lepsza rzecz z paska leży w magazynie w zasięgu, rekrut idzie po nią i nie bierze gorszej z Koszar. Potem wraca pod Koszary. Tak samo żołnierz uzbrojony z licznika.',
          },
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
                '{{barracks.gearStock}}',
              ],
              ['Żywność', '{{barracks.foodStock}}'],
              ['[[good:coin|Moneta]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: 'Koszary mają {{barracks.carriers}} miejsca dla Tragarzy. Towar oznaczony priorytetem zwożą sami z magazynów: [[article:hauling|Tragarze i magazyny]].',
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
            'Gdy nigdzie nie znajdzie tej rzeczy, wraca z pustymi rękami.',
            'Broń od razu zmienia rodzaj żołnierza. Po zdjęciu broni zostaje [[job:soldier_unarmed|Żołnierzem]].',
            'Używane Buty, narzędzia i napoczęte butelki przepadają przy wymianie i zdjęciu. Nieużywane wracają do magazynu.',
            'Broń, pancerz i amulety się nie zużywają, więc wracają do magazynu.',
            'Rozkaz dla jednej osoby ma pierwszeństwo przed Asystentem.',
          ],
        },
        {
          h: 'Kto może nosić lepszą broń',
        },
        {
          p: 'Każdy żołnierz weźmie każdą broń z magazynu, trafienia tego nie ograniczają. Ograniczenie jest przy wyrobie: [[good:spear_iron|Żelazną Włócznię]] i [[good:sword_long|Długi Miecz]] zrobi doświadczony [[job:smith|Kowal]], [[good:bow_long|Długi Łuk]] doświadczony [[job:armorer|Płatnerz]]. Tabela: [[article:exp-combat|Doświadczenie w walce]].',
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
              [
                '[[good:bow_short|Krótki Łuk]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.standoff}}',
                '{{shortBow.seconds}} s',
              ],
              [
                '[[good:bow_long|Długi Łuk]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.standoff}}',
                '{{longBow.seconds}} s',
              ],
              [
                '[[job:hunter|Myśliwy]]',
                '{{hunterBow.min}}-{{hunterBow.max}}',
                '-',
                '-',
                '{{hunterBow.seconds}} s',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.standoff}}',
                '{{heroBow.seconds}} s',
              ],
              [
                '[[building:catapult|Katapulta]]',
                '{{catapult.min}}-{{catapult.max}}',
                '-',
                '{{catapult.bandMin}}-{{catapult.max}}',
                '{{catapult.seconds}} s',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: 'Zasięg w hexach. Bliżej niż dolna liczba zasięgu łucznik nie strzela. Podchodzi na: z jakiej odległości zaczyna strzelać, gdy sam idzie do celu.',
          },
        },
        {
          h: 'Celność',
        },
        {
          table: {
            head: ['Trafienia', 'Celny strzał'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', 'Zawsze w cel'],
            ],
            num: [0, 1],
            foot: 'Każde trafienie to +1%. Od {{aim.noSpreadHits}} trafień nawet niecelna strzała spada w cel. Krótki i Długi Łuk mają wspólny licznik trafień, [[article:catapult|Katapulta]] własny, według tej samej tabeli. Bohater zawsze strzela celnie.',
          },
        },
        {
          h: 'Rozrzut niecelnej strzały',
        },
        {
          list: [
            'Niecelna strzała spada blisko celu: z [[good:bow_short|Krótkiego Łuku]] do {{aim.spreadShort}} hexów, z [[good:bow_long|Długiego Łuku]] do {{aim.spreadLong}}, z Długiego Łuku na wieży do {{aim.spreadTower}}. Rozrzut rośnie z odległością.',
            'Niecelna strzała rani pierwszego wroga w miejscu upadku. Najpierw człowieka, zwierzę albo pojazd, potem budynek, na końcu palisadę.',
            'Strzała przelatuje nad swoimi, sojusznikami i neutralnymi.',
            'Łucznik celuje przed idącego wroga. Budynek strzela tam, gdzie wróg właśnie stoi.',
          ],
        },
        {
          h: 'Posterunek na wieży',
        },
        {
          list: [
            'Dłuższy zasięg łucznik ma dopiero na posterunku, nie w drodze na niego.',
            'Wróg nie może strzelać do łucznika na posterunku, tylko do wieży.',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: 'Postawy',
      lead: 'Postawa mówi, czy żołnierz sam szuka wroga i jak daleko za nim idzie. Żołnierz i bohater zaczynają w Obronie.',
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
              [
                'Atak',
                'Wokół siebie',
                '{{stance.search}}',
                'Cel padnie albo jest nieosiągalny',
                'Idzie na napastnika',
              ],
              [
                'Obrona',
                'Wokół miejsca postoju',
                '{{stance.search}}',
                'Cel ponad {{stance.defendLeash}} od miejsca postoju',
                'Idzie na napastnika',
              ],
              [
                'Ignorowanie',
                'Tylko w zasięgu broni, nie podchodzi',
                'Zasięg broni',
                'Cel ponad {{stance.ignoreLeash}} od miejsca postoju',
                'Zostaje na miejscu',
              ],
            ],
            foot: 'Promienie w hexach. Miejsce postoju to tam, gdzie żołnierz stał przy zmianie postawy. Po rozkazie ruchu albo ataku zmienia się na nowe.',
          },
        },
        {
          list: [
            'Żołnierz w Ataku wraca do miejsca postoju, gdy skończy walkę dalej niż {{stance.attackReturn}} hexów od niego.',
            'Żołnierz znajdzie wroga także we [[article:fog|mgle]].',
            'Rozkaz ataku działa w każdej postawie.',
            'Łucznik na posterunku strzela do tego, co ma w zasięgu, w każdej postawie.',
            'Po zwykłym rozkazie ruchu żołnierz idzie dalej, nawet gdy go biją. Po rozkazie "Atakuj po drodze" odwraca się do napastnika.',
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
            head: ['Kto', 'Do rannego, hexów', 'Reakcja'],
            rows: [
              ['Żołnierze i bohaterowie w Ataku lub Obronie', '{{stance.soldierAlarm}}', 'Idą na napastnika'],
              ['Żołnierze i bohaterowie w Ignorowaniu', '-', 'Biją tylko to, co w zasięgu broni'],
              [
                'Cywile i Zwiadowcy',
                '{{stance.peopleAlarm}}',
                'Uciekają {{stance.fleeMin}}-{{stance.fleeMax}} hexów i wracają do pracy',
              ],
              ['Ludzie w budynkach', '-', 'Nie reagują, poza łucznikiem na posterunku'],
              ['Cywil śpiący na otwartym terenie', '-', 'Śpi, ucieka tylko uderzony'],
            ],
            num: [1],
            foot: 'Liczy się tylko cios w człowieka. Uderzony budynek albo zwierzę nikogo nie zaalarmuje.',
          },
        },
        {
          h: 'Cywile',
        },
        {
          list: [
            'Cywil nie walczy. Postawę ustawiasz tylko żołnierzom i bohaterom.',
            'Widok wroga nie rusza cywila.',
            'Uciekający zrzuca niesiony towar. Tragarz zostawia wózek.',
          ],
        },
        {
          h: 'Przełącznik "Jedzenie i sen"',
        },
        {
          p: 'Przy "Zabronione" żołnierz sam nie idzie do jedzenia, łóżka ani na modlitwę, nie je z rąk ani z zapasu wieży, a głód nie przerywa długiego rozkazu. Bez napojów kończy się to głodem. Ratuje rozkaz Jedz albo powrót na "Dozwolone".',
        },
        {
          p: 'Napoje, amulety i rozkazy Jedz, Śpij, Módl się działają w obu stanach. W menu rozkazów stany to "Zezwól na przerwy" i "Bez przerw na potrzeby". Przełącznik ma tylko żołnierz, zaczyna od "Dozwolone" i wraca do niego po zmianie zawodu.',
        },
        {
          h: 'Stoi na alarmie',
        },
        {
          p: 'To stan żołnierza w Ataku lub Obronie blisko walki, nie [[article:defence|alarm osady]], który włącza gracz.',
        },
        {
          table: {
            head: ['Co jest w pobliżu', 'Hexy', 'Skutek'],
            rows: [
              ['Walka', 'do {{alert.restClearance}}', 'Nie śpi, nie modli się, nie rozmawia.'],
              ['Widoczny wróg w Ataku lub Obronie', 'do {{alert.standTo}}', 'To samo.'],
              ['Walka przy śpiącym na otwartym terenie', 'do {{alert.standTo}}', 'Wstaje.'],
            ],
            foot: 'Na jedzenie idzie dopiero przy {{need.criticalPct}}% Energii. Dzikie zwierzęta liczą się dopiero, gdy toczy się z nimi walka. W Ignorowaniu reguła nie działa, a rozkaz potrzeby ma pierwszeństwo.',
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
              ['Zasięg widzenia, hexy', '{{vision.soldier}}', '{{vision.hero}}'],
              ['Celność łuku', 'Rośnie z trafieniami', 'Zawsze celny'],
              ['Doświadczenie w walce', 'Rośnie', 'Nie rośnie, chyba że pozwala na to misja'],
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
            head: ['Bohater', 'Broń', 'Pancerz', 'Zasięg'],
            rows: [
              [
                '[[job:hero_spear_siegfried|Sigurd]]',
                'Włócznia',
                '[[good:armor_plate|Zbroja Płytowa]]',
                '{{hero.spearMin}}-{{hero.spearMax}}',
              ],
              [
                '[[job:hero_sword_bjarni|Bjarni]]',
                'Miecz',
                '[[good:armor_chain|Kolczuga]]',
                '{{hero.swordReach}}',
              ],
              [
                '[[job:hero_saber_hatschi|Hatchie]]',
                'Szabla',
                '[[good:armor_chain|Kolczuga]]',
                '{{hero.saberReach}}',
              ],
              [
                '[[job:heroine_bow_xena|Cyra]]',
                'Łuk',
                '[[good:armor_leather|Skórzana Zbroja]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
            ],
            num: [3],
            foot: 'Cios co {{hero.blowSeconds}} s. Obrażenia: włącz Bohaterów w tabeli [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        {
          h: 'Różnice plemion',
        },
        {
          table: {
            head: ['Bohater', 'Plemię', 'Różnica'],
            rows: [
              ['Sigurd', 'Egipcjanin', 'Kolczuga {{hero.sigurdEgyptChain}}'],
              [
                'Hatchie',
                'Saracen',
                '{{hero.hatchieSaracenBlows}} ciosy co {{hero.hatchieSaracenSeconds}} s',
              ],
              [
                'Cyra',
                'Frank',
                'Zasięg {{frankHeroBow.min}}-{{frankHeroBow.max}}, strzał co {{frankHeroBow.seconds}} s, bez pancerza {{hero.frankBowBare}}, Tunika i Skórzana {{hero.frankBowWool}}, Kolczuga i Płytowa {{hero.frankBowChain}}, Budynek i Pojazd {{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: 'Torba',
        },
        {
          list: [
            'Bierze tylko: [[good:amulet_strength|Amulet Siły]], [[good:amulet_defense|Amulet Obrony]], [[good:amulet_crithit|Amulet Precyzji]], [[good:amulet_speed|Amulet Wiatru]], [[good:potion_heal_small|Mała Lecznicza Mikstura]], [[good:potion_heal_big|Duża Lecznicza Mikstura]].',
          ],
        },
        {
          h: 'Po śmierci',
        },
        {
          p: 'Broń znika. Pancerz, Buty i nieużyte rzeczy z torby zostają na ziemi.',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: 'Wieże i alarm',
      lead: 'Budynek na alarmie strzela sam. Każda osoba w środku to {{shelter.shotsPerSeat}} strzału na sekundę.',
      blocks: [
        {
          h: 'Alarm',
        },
        {
          list: [
            '"Bij na alarm" działa na jeden budynek, "Cała osada" na wszystkie budynki obronne.',
            'Alarm włączasz sam. Atak na osadę go nie włączy.',
            'Budynek w budowie nie podnosi alarmu.',
            'Alarm sam się nie wyłącza. Trwa do "Odwołaj alarm" albo zniszczenia budynku.',
          ],
        },
        {
          h: 'Kto się chowa',
        },
        {
          list: [
            'Cywile, kobiety i dzieci biegną do najbliższego budynku z wolnym miejscem. Budynek musi być w zasięgu chodu.',
            'Żołnierze, bohaterowie i [[job:scout|Zwiadowca]] zostają na zewnątrz.',
            'Kto nie znajdzie miejsca, pracuje dalej.',
            'Na alarm osadnik rzuca jedzenie i sen. W środku nie pracuje, je tylko to, co ma przy sobie.',
            'Schowanego nie można zaatakować.',
            'Gdy budynek padnie, schowani wychodzą na zewnątrz.',
          ],
        },
        {
          h: 'Budynki obronne',
        },
        {
          table: {
            head: ['Budynek', 'Miejsca', 'Strzały na sekundę', 'Posterunki'],
            rows: [
              ['[[building:headquarters|Kwatera główna]]', '{{shelter.hq}}', '{{shelter.hqShots}}', '-'],
              [
                '[[building:tower_01|Wieża obronna 2]]',
                '{{shelter.tower2}}',
                '{{shelter.tower2Shots}}',
                '{{tower2.posts}} Krótki Łuk, {{tower2.longPosts}} Długi Łuk',
              ],
              [
                '[[building:tower_00|Wieża obronna 1]]',
                '{{shelter.tower1}}',
                '{{shelter.tower1Shots}}',
                '{{tower1.posts}} Krótki Łuk, {{tower1.longPosts}} Długi Łuk',
              ],
              ['[[building:barracks|Koszary]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}', '-'],
            ],
            num: [1, 2],
            foot: 'Strzały na sekundę przy pełnym budynku. Posterunek nie zabiera miejsca w budynku. Łucznik zatrudniony w wieży strzela sam, bez alarmu: [[article:aim|Trafienie i strzelanie]].',
          },
        },
        {
          h: 'Strzały z budynku',
        },
        {
          table: {
            head: ['Cel', 'Strzała'],
            rows: [
              ['Bez pancerza', '{{arrow.bare}}'],
              ['Tunika', '{{arrow.wool}}'],
              ['Skórzana', '{{arrow.leather}}'],
              ['Kolczuga, Płytowa', '{{arrow.chain}}'],
              ['Pojazd', '{{arrow.vehicle}}'],
              ['Budynek', '{{arrow.building}}'],
            ],
            num: [1],
            foot: 'Tak samo w każdym plemieniu. Kierunek ciosu i Amulet Obrony mogą to zmienić: [[article:damage|Broń, pancerz i obrażenia]].',
          },
        },
        {
          list: [
            'Budynek strzela na {{shelter.range}} hexów od najbliższej ściany, także do wroga pod samymi murami.',
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
            head: ['Wieża', 'Miejsca Tragarzy', 'Miód Pitny', 'Żywność', 'Broń, każdej sztuk'],
            rows: [
              [
                '[[building:tower_00|Wieża obronna 1]]',
                '{{tower1.carriers}}',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|Wieża obronna 2]]',
                '{{tower2.carriers}}',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          list: [
            'Posterunek przyjmuje tylko swojego łucznika: [[job:soldier_bow_short|Łucznika z krót. łukiem]] albo [[job:soldier_bow_long|Łucznika z dł. łukiem]]. Przydziela się go jak miejsce pracy.',
            'Łucznik, który weźmie inną broń, traci posterunek.',
            'Załoga je z zapasu wieży i śpi na posterunku, nie schodzi. Gdy zapas się skończy, idzie po jedzenie.',
            'Asystent nie ściąga łuczników z wieży, nawet po wyposażenie.',
            '"Wyprowadź załogę": łucznicy opuszczają wieżę i zostają zaznaczeni do następnego rozkazu. Rozkaz ruchu też zdejmuje łucznika z posterunku.',
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
            head: ['Element', 'Zdrowie', 'Naprawa na uderzenie', 'Koszt'],
            rows: [
              ['Odcinek palisady', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1 [[good:wood|Drewno]]'],
              ['Brama', '{{wall.gateHp}}', '{{wall.gateRepair}}', 'Darmowa, powstaje z odcinków'],
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
            caption: 'Gdzie stanie brama',
          },
        },
        {
          list: [
            'Brama zajmuje {{wall.gateSegments}} Twoich gotowych odcinków w prostej linii. Każdy musi mieć co najmniej {{wall.gateMinHealthPct}}% zdrowia i stać na równym terenie, a w przejściu nikt nie może stać.',
            'Brama powstaje od razu i jest zamknięta. Ma pełne zdrowie, także gdy odcinek był uszkodzony.',
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
                'Otwarta. Zamyka się, gdy wróg jest do {{wall.gateEnemyNear}} hexów od bramy, potem znów się otwiera',
              ],
            ],
            foot: 'Bramę zamyka każdy człowiek albo pojazd gracza, z którym masz wojnę, także cywil. Zwierzęta jej nie zamykają.',
          },
        },
        {
          list: [
            'Brama zamyka się dopiero, gdy nikt nie stoi w przejściu.',
            'Komputer ustawia swoje bramy na tryb automatyczny.',
          ],
        },
        {
          h: 'Jak szybko pada palisada',
        },
        {
          table: {
            head: ['Broń', 'Zdrowia za cios', 'Ciosów na odcinek', 'Ciosów na bramę', 'Czas na odcinek'],
            rows: [
              [
                '[[building:catapult|Katapulta]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}} s',
              ],
              [
                'Bohater wręcz',
                '{{wall.hero.blow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}} s',
              ],
              [
                '[[good:spear_iron|Żelazna Włócznia]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}} s',
              ],
              [
                '[[good:sword_long|Długi Miecz]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}} s',
              ],
              [
                '[[good:sword_shord|Krótki Miecz]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}} s',
              ],
              [
                '[[good:spear_wooden|Drewniana Włócznia]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}} s',
              ],
              [
                '[[good:bow_short|Krótki Łuk]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}} s',
              ],
              [
                '[[good:bow_long|Długi Łuk]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}} s',
              ],
              ['Pięści, strzały z budynku', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Czas dla jednego żołnierza. Cyra zabiera {{wall.heroBow.blow}}, u Franków {{wall.frankHeroBow.blow}}.',
          },
        },
        {
          list: [
            'Doświadczenie w walce nie podnosi ciosu w palisadę.',
            'Amulet Siły podnosi tę liczbę: {{wall.ironSpear.blow}} daje {{wall.ironSpear.strongBlow}}, {{wall.shortSword.blow}} daje {{wall.shortSword.strongBlow}}, {{wall.shortBow.blow}} zostaje {{wall.shortBow.strongBlow}}.',
            'Żołnierz nie wybiera palisady sam. Bije ją na rozkaz albo wtedy, gdy zagradza mu drogę do wroga.',
            'Gdy odcinek padnie, żołnierze idą przez wyłom i zostawiają sąsiednie odcinki.',
          ],
        },
        {
          h: 'Mur obronny',
        },
        {
          p: '[[building:work_pottery_02|Mur obronny]] to zwykły budynek: {{wall.defenceHp}} zdrowia, obrażenia z kolumny Budynek. Żołnierz traktuje go jak palisadę.',
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
          table: {
            head: ['Cecha', 'Wartość'],
            rows: [
              ['Zasięg', '{{catapult.min}}-{{catapult.max}} hexy'],
              ['Strzał co', '{{catapult.seconds}} s'],
              ['Zdrowie', '{{catapult.hitpoints}}'],
              ['Załoga', '1 żołnierz albo bohater, z dowolną bronią'],
              [
                'Koszt',
                '[[building:catapult|Katapulta]]: {{catapult.wood}} [[good:wood|Drewno]], {{catapult.iron}} [[good:iron|Żelazo]]',
              ],
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
              ['Bez pancerza', '{{stone.bare}}', '{{stone.bareKills}}'],
              ['Skórzana', '{{stone.leather}}', '{{stone.leatherKills}}'],
              ['Tunika', '{{stone.wool}}', '{{stone.woolKills}}'],
              ['Kolczuga, Płytowa', '{{stone.chain}}', '{{stone.chainKills}}'],
              ['Katapulta', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              ['Budynek', '{{stone.building}}', '{{stone.tower1}}-{{stone.frankHq}}'],
            ],
            num: [2],
            foot: 'Obrażenia człowieka z przodu, bez amuletów. Palisada: [[article:walls|Palisady i bramy]].',
          },
        },
        {
          table: {
            head: ['Budynek', 'Zdrowie', 'Kamienie', 'Czas'],
            rows: [
              [
                '[[building:tower_00|Wieża obronna 1]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}} s',
              ],
              [
                '[[building:tower_01|Wieża obronna 2]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}} s',
              ],
              [
                '[[building:headquarters|Kwatera główna]], Wiking',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}} s',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Kwatera główna Franków: {{hp.frankHq}} zdrowia, {{stone.frankHq}} kamieni, {{stone.frankHqSeconds}} s.',
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
              ['Gracz, z którym masz pokój z lobby', 'Omija'],
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
          p: 'Celność rośnie jak u łucznika: [[article:aim|Trafienie i strzelanie]]. Na {{catapult.max}} hexach niecelny kamień spada do {{stone.spread.0}} hexów od celu przy 0 trafień, {{stone.spread.25}} przy 25, {{stone.spread.50}} przy 50. Od {{aim.noSpreadHits}} trafień spada w cel. Doświadczenie zbiera dowódca: 1 trafienie za kamień, który coś uszkodził, także budynek. Kamień, który trafił kilka celów, liczy się raz.',
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
                'Tak, do {{catapult.leash}} od pozycji',
              ],
              ['Ignorowanie', 'Wokół swojej pozycji', '{{catapult.min}}-{{catapult.max}}', 'Nie'],
            ],
            foot: 'Nowa Katapulta stoi w Ignorowaniu. Sama wybiera tylko cel, który widzi. Rozkaz ataku działa w każdej postawie.',
          },
        },
        {
          list: [
            'Cel bliżej niż {{catapult.min}} hexów: Katapulta odjeżdża. Cel dalej niż {{catapult.max}}: podjeżdża na {{catapult.bandMin}}-{{catapult.max}} hexy.',
            'Strzela tylko, gdy stoi i nie styka się z innym pojazdem.',
            'Możesz kazać jej strzelać w miejsce na ziemi. Palisadę bije tylko na rozkaz.',
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
    {
      id: 'computer',
      name: 'Przeciwnicy komputerowi',
      lead: 'Poziom ustawia się w lobby. Trudny może wysłać pierwszą falę zaraz po końcu pokoju.',
      blocks: [
        {
          table: {
            head: ['Cecha', 'Łatwy', 'Średni', 'Trudny'],
            rows: [
              [
                'Pierwsza fala',
                '{{ai.easy.firstWaveMinutes}} min',
                '{{ai.medium.firstWaveMinutes}} min',
                'Od razu',
              ],
              ['Limit armii', '{{ai.easy.armyCap}}', '{{ai.medium.armyCap}}', '{{ai.hard.armyCap}}'],
              [
                'Katapulty',
                '{{ai.easy.catapults}}',
                'do {{ai.medium.catapults}}',
                'do {{ai.hard.catapults}}',
              ],
              ['Gęsty pierścień wież', 'Nie', 'Tak', 'Tak'],
              [
                'Place budowy naraz',
                '{{ai.easy.sites}}',
                '{{ai.medium.sites}}, od {{ai.medium.grownMinutes}} min {{ai.medium.grownSites}}',
                '{{ai.hard.sites}}, od {{ai.hard.midMinutes}} min {{ai.hard.midSites}}, od {{ai.hard.lateMinutes}} min {{ai.hard.lateSites}}',
              ],
            ],
            foot: 'Czasy to czas gry: przy ×3 mijają trzy razy szybciej. Żadna fala nie wyjdzie przed końcem "Czasu pokoju". Łatwy i Średni nie szkolą żołnierzy ponad limit armii.',
          },
        },
        {
          h: 'Fale',
        },
        {
          table: {
            head: ['Czas od startu fal', 'Ludzi w fali'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1 godz.', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2 godz.', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3 godz. i później', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: 'Czas liczy się od późniejszego z dwóch momentów: "Pierwszej fali" albo końca pokoju. Wielkość fali jest losowana z tego zakresu.',
          },
        },
        {
          list: [
            'Naraz idzie jedna fala. Następna zbiera się pod [[building:barracks|Koszarami]].',
            'Zbiórka trwa do {{ai.gatherMinutes}} minut. Potem rusza tylu, ile wynosi dolna liczba z tabeli, a gdy tylu nie ma, wszyscy, którzy mogą dojść.',
          ],
        },
        {
          h: 'Kiedy fala rusza',
        },
        {
          list: [
            'Komputer porównuje siłę swojej armii z siłą Twojej. Liczy broń, pancerz, amulety, zdrowie i mikstury lecznicze. Doświadczenia nie liczy.',
            'Twój łucznik na wieży liczy się za {{ai.towerPostWeight}}.',
            'Każdy komputer losuje na początku plan. Agresywny rusza, gdy ma {{ai.planAggressivePct}}% Twojej siły, obronny dopiero przy {{ai.planDefensivePct}}%, pozostałe przy {{ai.planBalancedPct}}%.',
            'We mgle liczy to, co widział. Gdy nic o Tobie nie wie, uznaje, że jesteś równie silny.',
            'Póki siły nie ma, fala czeka pod Koszarami, także po zbiórce.',
            'Gdy armia komputera dojdzie do limitu, fala rusza mimo to.',
            'Gdy atakujesz jego osadę albo jesteś od niego {{ai.defendRatio}} raza silniejszy, trzyma wojsko w domu, a idąca fala zawraca.',
          ],
        },
        {
          h: 'Najazdy',
        },
        {
          list: [
            'Mały oddział, {{ai.raidMen}} ludzi, idzie na Twoich zbieraczy i budynki gospodarcze. Omija zasięg wież, a gdy drogi bez wież nie ma, nie rusza.',
            'Trudny komputer robi tak w {{ai.raidChancePct}}% gier, chyba że startuje na wyspie. Plan nękania robi tak zawsze, na każdym poziomie.',
            'Pierwszy najazd wychodzi {{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}} minut po końcu pokoju, następne w podobnych odstępach.',
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
            'We mgle komputer zna budynki ze startu mapy i te, które już widział. O nowych dowie się, gdy je zobaczy.',
          ],
        },
        {
          h: 'Woda',
        },
        {
          list: [
            'Fala piesza idzie tylko po lądzie, na którym stoją Koszary komputera. Twój budynek albo człowiek na tym lądzie staje się celem.',
            'Gdy Kwatera główna rywala stoi na innym lądzie, komputer stawia nad brzegiem [[building:work_joinery_03|Warszt. ciesielski 4]], buduje [[good:ship_small|Statki]] i przewozi nimi wojsko.',
            'Desant wypływa, gdy przy brzegu stoją {{ai.landingShips}} Statki, u słabszego komputera mniej, a wojsko jest {{ai.landingEdge}} raza silniejsze od obrońców. Statek wiezie {{vehicle.shipSeats}} żołnierzy.',
            'Przybija poza zasięgiem Twoich wież i budynków na alarmie, jak najbliżej Kwatery głównej, i idzie na nią.',
            'Gdy straci na lądzie {{ai.landingRetreatPct}}% ludzi, reszta wraca na Statki. Następny desant rusza najwcześniej po {{ai.landingCooldownMinutes}} minutach.',
          ],
        },
        {
          h: 'Odbudowa',
        },
        {
          p: 'Gracz ustawiony w lobby na "AI mapy" odbudowuje budynki, gdy do {{ai.rebuildNear}} hexów nie ma wroga, a jest jego cywil. Kwatery głównej nie odbudowuje.',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
