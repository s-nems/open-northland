import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Gospodarka',
  items: [
    {
      id: 'construction',
      name: 'Budowa, rozbudowa, naprawa',
      lead: 'Jeden Budowniczy stawia Dom 1 w {{build.noviceSeconds}} s, a z Żelaznym Narzędziem w {{build.noviceIronSeconds}} s. Do tego dochodzi noszenie materiału.',
      blocks: [
        {
          h: 'Gdzie można budować',
        },
        {
          table: {
            head: ['Co', 'Zasada'],
            rows: [
              [
                'Teren',
                'Budujesz na lądzie, piasku, plaży i kamienistej pustyni. Na górach, śniegu, wodzie i bagnie się nie da.',
              ],
              [
                '[[building:work_well_00|Studnia]], [[building:work_hive_00|Ul]]',
                'Przynajmniej skraj budynku musi stać na trawie.',
              ],
              [
                'Miejsce',
                'Budynek od razu zajmuje miejsce potrzebne na najwyższy poziom, plus wąski pas wokół. Pasy dwóch budynków nie mogą na siebie zachodzić.',
              ],
              ['Drzewo, skała, złoże, palisada', 'Muszą stać poza miejscem na najwyższy poziom budynku.'],
              [
                'Wrogi żołnierz',
                'Nie zbudujesz w promieniu {{contest.radius}} hexów od niego, po skosie około {{contest.diagonal}}. Liczą się tylko żołnierze, których widzisz, ale nie załoga wieży.',
              ],
              [
                'Budynek gracza, z którym masz pokój',
                'Nie zbudujesz w promieniu {{peace.keepOut}} hexów od jego budynku lub placu, chyba że twój budynek stoi tam bliżej niż jego.',
              ],
              ['Teren pod mgłą', 'Nie zbudujesz tam. Miejsce musi być w tej chwili widoczne.'],
              [
                'Zasięg drogowskazów',
                'Nie ma znaczenia. Plac możesz postawić poza siecią, ale Budowniczy dojdzie dopiero, gdy sieć tam sięgnie.',
              ],
            ],
          },
        },
        {
          h: 'Ile trwa budowa',
        },
        {
          table: {
            head: ['[[building:home_level_00|Dom 1]], 1 Budowniczy', 'Uderzeń', 'Czas'],
            rows: [
              ['Bez doświadczenia i narzędzia', '{{build.noviceSwings}}', '{{build.noviceSeconds}} s'],
              [
                'Bez doświadczenia, [[good:tool_iron|Żelazne Narzędzie]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Mistrz, [[good:tool_iron|Żelazne Narzędzie]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2],
            foot: 'Dom 1 kosztuje {{build.homeUnits}} sztuki materiału. Liczony jest sam czas uderzeń, 1 uderzenie trwa {{build.swingSeconds}} s.',
          },
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0-9%', '{{build.perUnit.0.bare}}', '{{build.perUnit.0.wooden}}', '{{build.perUnit.0.iron}}'],
              [
                '10-21%',
                '{{build.perUnit.10.bare}}',
                '{{build.perUnit.10.wooden}}',
                '{{build.perUnit.10.iron}}',
              ],
              [
                '22-49%',
                '{{build.perUnit.22.bare}}',
                '{{build.perUnit.22.wooden}}',
                '{{build.perUnit.22.iron}}',
              ],
              [
                '50-78%',
                '{{build.perUnit.50.bare}}',
                '{{build.perUnit.50.wooden}}',
                '{{build.perUnit.50.iron}}',
              ],
              [
                '79-89%',
                '{{build.perUnit.79.bare}}',
                '{{build.perUnit.79.wooden}}',
                '{{build.perUnit.79.iron}}',
              ],
              [
                '90-100%',
                '{{build.perUnit.90.bare}}',
                '{{build.perUnit.90.wooden}}',
                '{{build.perUnit.90.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Uderzenia na 1 sztukę materiału. [[job:builder|Budowniczy]] dochodzi do 100% po {{exp.build.repeatsFull}} uderzeniach, ale liczą się tylko te, które posunęły budowę.',
          },
        },
        {
          p: 'Materiał na plac noszą Budowniczowie i pracownicy przypisani do placu, po 1 sztuce.',
        },
        {
          h: 'Co Budowniczy robi najpierw',
        },
        {
          p: 'Budowniczy najpierw naprawia, potem stawia budynki, a palisady i drogi zostawia na koniec. Jeśli przypiszesz go do placu, zostaje przy nim, nawet gdy gdzie indziej czeka praca.',
        },
        {
          h: 'Rozbudowa',
        },
        {
          list: [
            'Kosztuje materiały kolejnych poziomów. Możesz przeskoczyć kilka poziomów naraz, jeśli wszystkie są odblokowane.',
            'Towar potrzebny do rozbudowy, który budynek ma już w zapasie, od razu idzie na budowę.',
            'Pracownicy i mieszkańcy wychodzą na czas rozbudowy, a potem wracają na swoje miejsca.',
            'Po ukończeniu budynek ma pełne zdrowie nowego poziomu.',
            'Gdy anulujesz rozbudowę, budynek odzyskuje swoje zapasy, ale dostarczony materiał przepada.',
          ],
        },
        {
          h: 'Naprawa',
        },
        {
          table: {
            head: ['Cel', 'Zdrowie na uderzenie', 'Budowniczych naraz'],
            rows: [
              ['Budynek', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['Odcinek palisady', '{{wall.segmentRepair}}', '{{repair.wallCrew}}'],
              ['Brama', '{{wall.gateRepair}}', '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: 'Naprawa nie kosztuje materiału. Przy palisadzie i bramie doświadczenie i narzędzie nic nie zmieniają.',
          },
        },
        {
          p: 'Budowniczy sam nie naprawia przez {{repair.calmSeconds}} s od ostatniego trafienia ani wtedy, gdy w promieniu {{alert.standTo}} hexów trwa walka. Na twój rozkaz pójdzie od razu.',
        },
        {
          h: 'Co przepada, a co wraca',
        },
        {
          table: {
            head: ['Sytuacja', 'Co zostaje'],
            rows: [
              ['Wyburzenie placu', 'Dostarczony materiał zostaje na ziemi'],
              ['Wyburzenie lub zniszczenie budynku', 'Zawartość i połowa kosztu, zaokrąglona w górę'],
            ],
            foot: 'Towar ląduje na ziemi do {{reach.spill}} hexów od budynku. Co się nie zmieści, przepada.',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Warsztaty i wybór produktu',
      lead: 'Licznik przy produkcie mówi, ile cykli zrobi pracownik: 0 to stop, ∞ to bez końca. Jeden cykl to jedno wykonanie przepisu.',
      blocks: [
        {
          h: 'Wartości licznika',
        },
        {
          table: {
            head: ['Licznik', 'Warsztat', 'Zbieracz'],
            rows: [
              ['0', 'Nie robi tego produktu', 'Nie zbiera tego towaru'],
              [
                '1-{{workshop.counterMax}}',
                'Tyle cykli, licznik spada o 1 na starcie każdego',
                'Tyle sztuk, licznik spada o 1 za każdą zdobytą',
              ],
              ['∞', 'Bez końca, licznik nie spada', 'Bez końca, licznik nie spada'],
            ],
            foot: 'Doświadczenie i narzędzie dają więcej sztuk z cyklu: [[article:tools|Narzędzia]].',
          },
        },
        {
          h: 'Przyciski',
        },
        {
          table: {
            head: ['Przycisk', 'Kliknięcie', 'Shift', 'Ctrl'],
            rows: [
              [
                'Ikona towaru, "Tylko ten produkt"',
                'Ten towar ∞, reszta 0',
                '-',
                'Przełącza ten towar między 0 a ∞, reszta bez zmian',
              ],
              ['Mniej', '-1. Z 0 skok na ∞, z ∞ na {{workshop.counterMax}}', '-10', 'Na 0'],
              ['Więcej', '+1. Ze {{workshop.counterMax}} skok na ∞, z ∞ na 0', '+10', 'Na ∞'],
            ],
          },
        },
        {
          h: 'Co dzieje się z licznikami',
        },
        {
          p: 'Każdy pracownik ma własne liczniki, więc 2 ludzi w jednym warsztacie może robić 2 różne produkty. Liczniki znikają, gdy pracownik zmieni miejsce pracy lub zawód, także po zburzeniu budynku. Rozbudowa ich nie zmienia, a produkty z nowego poziomu startują od 0.',
        },
        {
          h: 'Kilka produktów naraz',
        },
        {
          p: 'Pracownik robi na zmianę wszystkie produkty z licznikiem powyżej 0, po 1 cyklu każdy, w kolejności z panelu.',
        },
        {
          table: {
            head: ['Kiedy', 'Co robi pracownik'],
            rows: [
              ['Zapas produktu jest pełny', 'Bierze się za następny produkt'],
              ['Brakuje składnika', 'Bierze się za następny produkt'],
              [
                'Jest tylko część składników',
                'Czeka na resztę. Gdy nie ma jej skąd wziąć, bierze się za następny produkt.',
              ],
              [
                'Ma za mało doświadczenia na produkt',
                'Panel pokazuje "zablokowane" zamiast licznika, a pracownik ten produkt pomija',
              ],
              [
                'Wszystkie produkty z licznikiem są zablokowane',
                'Robi to, co już umie, nawet produkty z licznikiem 0',
              ],
            ],
          },
        },
        {
          h: 'Pojazdy',
        },
        {
          p: 'Pojazd nie powstaje w warsztacie. Rzemieślnik stawia obok plac, sam nosi na niego materiał i buduje. Gdy obok warsztatu brakuje miejsca na plac, bierze się za następny produkt.',
        },
        {
          h: 'Zbieracze',
        },
        {
          table: {
            head: ['Sytuacja', 'Skutek'],
            rows: [
              ['"Tylko to dobro"', 'Ten towar ∞, reszta 0'],
              [
                'Prawy klik na zasobie',
                'Rozkaz "Zbieraj": ten towar ∞, reszta 0. Flaga robocza zostaje na miejscu.',
              ],
              ['Ctrl i prawy klik na zasobie', 'To samo, ale flaga przenosi się na zasób'],
              ['Wszystkie liczniki na 0', 'Zbieracz ma stan "Towary na 0" i nic nie zbiera'],
              [
                'Towar już leży na ziemi',
                'Licznik dotyczy tylko wydobycia. Ścięte pnie i stosy Zbieracz nosi dalej, nawet przy 0.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:work-flag',
        'article:tools',
        'article:gathering',
        'article:exp-work',
        'article:vehicles',
      ],
    },
    {
      id: 'gathering',
      name: 'Zbieranie i uprawa',
      lead: 'Drzewo daje {{gather.treeYield}} sztuki Drewna po {{gather.strokes}} uderzeniach. Skała potrzebuje tylu uderzeń na każdą sztukę, więc Drewno zbiera się około {{gather.treeYield}} razy szybciej niż Kamień.',
      blocks: [
        {
          h: 'Co daje zasób',
        },
        {
          table: {
            head: ['Zasób', 'Kto', 'Daje', 'Uderzenia bez doświadczenia', 'Czas', 'Narzędzie pomaga'],
            rows: [
              [
                'Drzewo',
                '[[job:collector|Zbieracz]]',
                '{{gather.treeYield}} [[good:wood|Drewna]]',
                '{{gather.strokes}} na drzewo',
                '{{gather.treeSeconds}} s',
                'tak',
              ],
              [
                'Skała',
                '[[job:collector|Zbieracz]]',
                '4-5 [[good:stone|Kamienia]]',
                '{{gather.strokes}} na sztukę',
                '{{gather.stoneSeconds}} s',
                'tak',
              ],
              [
                'Złoże',
                '[[job:collector|Zbieracz]]',
                '5 [[good:mud|Gliny]], [[good:iron|Żelaza]] lub [[good:gold|Złota]]',
                '{{gather.strokes}} na sztukę',
                '{{gather.oreSeconds}} s',
                'tak',
              ],
              [
                'Grzyb',
                '[[job:collector|Zbieracz]]',
                '1 [[good:mushroom|Grzyb]]',
                '1 schylenie',
                '{{gather.mushroomSeconds}} s',
                'nie',
              ],
              [
                'Pole zboża',
                '[[job:farmer|Farmer]]',
                '1 [[good:wheat|Pszenica]]',
                '{{gather.wheatStrokes}} na pole',
                '{{gather.wheatSeconds}} s',
                'tak',
              ],
              [
                'Pole ziół',
                '[[job:herb_mush_guy|Zbieracz Ziół]]',
                '1 [[good:herb|Zioło]]',
                '{{gather.herbStrokes}} na pole',
                '{{gather.herbSeconds}} s',
                'tak',
              ],
              [
                'Ławica',
                '[[job:fisher|Rybak]]',
                '1 [[good:fish|Ryba]]',
                '{{gather.casts}} rzutów',
                '{{gather.fishSeconds}} s',
                'tak',
              ],
            ],
            foot: 'Czas samej pracy bez doświadczenia i narzędzia, bez dojścia.',
          },
        },
        {
          p: 'Ścięte drzewo zostaje jako pień z {{gather.treeYield}} sztukami, a Zbieracz odnosi je po 1. Każda sztuka ze skały lub złoża spada na ziemię obok.',
        },
        {
          h: 'Żelazo i Złoto',
        },
        {
          p: 'Żeby wydobywać [[good:iron|Żelazo]] albo [[good:gold|Złoto]], Zbieracz musi najpierw sam zebrać {{gather.oreNeed}} sztuk [[good:mud|Gliny]] i [[good:stone|Kamienia]] razem, osobno dla każdego z tych dwóch towarów. Pierwszy, któremu się to uda, odkrywa towar dla całej osady, a potem można go też nauczyć w [[building:school|Szkole]]. Do tego czasu panel pokazuje "zablokowane".',
        },
        {
          h: 'Pole',
        },
        {
          figure: {
            id: 'field-stages',
            caption: 'Od siewu do ścięcia',
          },
        },
        {
          p: 'Pole rośnie tylko wtedy, gdy ktoś je podlewa, samo z czasem nie urośnie. Każde podlanie podnosi o 1 etap to pole i 6 sąsiednich, więc jedno pole potrzebuje najwyżej {{field.waterings}} podlań. Po ścięciu zostaje 1 sztuka plonu, a w tym miejscu można znowu siać.',
        },
        {
          p: 'Sianie i podlewanie nic nie kosztują, nawet Wody.',
        },
        {
          table: {
            head: ['Budynek', 'Pola', 'Promień', 'Załoga', 'Zapas'],
            rows: [
              [
                '[[building:work_farm_00|Farma]]',
                '{{field.max}}',
                '{{field.radius}} hexów',
                '{{farm.farmers}} Farmerów, {{farm.carriers}} Tragarz',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|Chatka zielarza]]',
                '{{field.max}}',
                '{{field.radius}} hexów',
                '{{herbHut.herbalists}} Zbieraczy Ziół, {{herbHut.carriers}} Tragarz',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: 'Po skosie promień to około {{field.diagonal}} hexów. Limit pól jest na budynek, nie na pracownika, więc więcej ludzi daje szybsze zbiory, ale nie więcej pól.',
          },
        },
        {
          p: 'Pola nie zasiejesz na piasku ani na drodze. Dzikie pola z mapy w zasięgu budynku liczą się do jego limitu. Pole, do którego przez {{field.reclaimSeconds}} s nie da się dojść od drzwi budynku, znika i zwalnia miejsce w limicie.',
        },
        {
          h: 'Co odrasta',
        },
        {
          table: {
            head: ['Źródło', 'Tempo', 'Limit'],
            rows: [
              [
                '[[building:work_well_00|Studnia]]',
                '+1 [[good:water|Woda]] na sekundę, bez pracownika',
                '{{well.stock}} sztuka w budynku',
              ],
              [
                '[[building:work_hive_00|Ul]]',
                '+1 [[good:honey|Miód]] na sekundę, bez pracownika',
                '{{hive.stock}} sztuka w budynku',
              ],
              [
                'Krzew z owocami',
                '{{bush.regrowSeconds}} s: {{bush.stageSeconds}} s do kwitnienia, {{bush.stageSeconds}} s do owoców',
                '1 posiłek',
              ],
              ['Ławica', '+1 ryba co {{fish.regrowSeconds}} s', '{{fish.swarmMax}} ryb'],
              ['Drzewo, skała, złoże, grzyb', 'Nie odrastają', '-'],
            ],
          },
        },
      ],
      see: [
        'article:tools',
        'article:hauling',
        'article:workshops',
        'article:work-flag',
        'article:exp-work',
        'job:collector',
        'job:farmer',
        'job:fisher',
      ],
    },
    {
      id: 'tools',
      name: 'Narzędzia',
      lead: 'Narzędzie zmniejsza liczbę uderzeń, daje więcej sztuk w warsztacie i starcza na {{tool.uses}} użyć.',
      blocks: [
        {
          h: 'Skąd osadnik ma narzędzie',
        },
        {
          p: 'Narzędzia rozdaje [[article:assistant|Asystent]], który jest włączony od początku gry, albo ty swoim rozkazem. Osadnik bez narzędzia sam idzie po nie do magazynu i bierze Żelazne, a jeśli ich nie ma, Drewniane. Drewnianego sam nie wymieni na lepsze.',
        },
        {
          h: 'Kto korzysta',
        },
        {
          table: {
            head: ['Kto', 'Co zyskuje'],
            rows: [
              ['Rzemieślnik w warsztacie', 'Więcej sztuk z cyklu'],
              ['[[job:collector|Zbieracz]]', 'Mniej uderzeń, oprócz grzybów'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]', 'Mniej uderzeń przy ścinaniu'],
              ['[[job:fisher|Rybak]]', 'Mniej rzutów'],
              ['[[job:builder|Budowniczy]]', 'Mniej uderzeń na sztukę materiału'],
              ['[[job:hunter|Myśliwy]], [[job:carrier|Tragarz]]', 'Nic'],
              ['Żołnierze, bohaterowie', 'Nie noszą narzędzi'],
            ],
          },
        },
        {
          h: 'Uderzenia przy zbieraniu',
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', '{{tool.strokes.0.bare}}', '{{tool.strokes.0.wooden}}', '{{tool.strokes.0.iron}}'],
              ['20%', '{{tool.strokes.20.bare}}', '{{tool.strokes.20.wooden}}', '{{tool.strokes.20.iron}}'],
              ['40%', '{{tool.strokes.40.bare}}', '{{tool.strokes.40.wooden}}', '{{tool.strokes.40.iron}}'],
              ['60%', '{{tool.strokes.60.bare}}', '{{tool.strokes.60.wooden}}', '{{tool.strokes.60.iron}}'],
              ['80%', '{{tool.strokes.80.bare}}', '{{tool.strokes.80.wooden}}', '{{tool.strokes.80.iron}}'],
              [
                '100%',
                '{{tool.strokes.100.bare}}',
                '{{tool.strokes.100.wooden}}',
                '{{tool.strokes.100.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Przy drzewie, skale, złożu i polu ziół.',
          },
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', '{{tool.casts.0.bare}}', '{{tool.casts.0.wooden}}', '{{tool.casts.0.iron}}'],
              ['20%', '{{tool.casts.20.bare}}', '{{tool.casts.20.wooden}}', '{{tool.casts.20.iron}}'],
              ['40%', '{{tool.casts.40.bare}}', '{{tool.casts.40.wooden}}', '{{tool.casts.40.iron}}'],
              ['60%', '{{tool.casts.60.bare}}', '{{tool.casts.60.wooden}}', '{{tool.casts.60.iron}}'],
              ['80-100%', '{{tool.casts.80.bare}}', '{{tool.casts.80.wooden}}', '{{tool.casts.80.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Rzutów na 1 rybę.',
          },
        },
        {
          p: 'Pole [[good:wheat|Pszenicy]] wymaga {{gather.wheatStrokes}} uderzeń bez narzędzia, a z narzędziem albo od 20% doświadczenia wystarczy 1.',
        },
        {
          h: 'Sztuki z cyklu w warsztacie',
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', '{{tool.output.0.bare}}', '{{tool.output.0.wooden}}', '{{tool.output.0.iron}}'],
              ['20%', '{{tool.output.20.bare}}', '{{tool.output.20.wooden}}', '{{tool.output.20.iron}}'],
              ['40%', '{{tool.output.40.bare}}', '{{tool.output.40.wooden}}', '{{tool.output.40.iron}}'],
              ['60%', '{{tool.output.60.bare}}', '{{tool.output.60.wooden}}', '{{tool.output.60.iron}}'],
              ['80%', '{{tool.output.80.bare}}', '{{tool.output.80.wooden}}', '{{tool.output.80.iron}}'],
              ['100%', '{{tool.output.100.bare}}', '{{tool.output.100.wooden}}', '{{tool.output.100.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Dla przepisu na 1 sztukę, przy przepisie na 2 sztuki premia jest podwójna. Składniki i czas pracy się nie zmieniają. Doświadczenie działa też przy uboju.',
          },
        },
        {
          p: 'Ułamki sztuk się sumują. Gdy uzbiera się pełna sztuka, trafia do zapasu, nawet ponad jego pojemność.',
        },
        {
          h: 'Zużycie',
        },
        {
          p: 'Każde uderzenie, rzut wędką, podlanie i ukończony cykl w warsztacie zużywa jedno użycie, także te nieudane. Sianie i zbieranie grzybów nic nie zużywają. Po {{tool.uses}} użyciach narzędzie znika i osadnik pracuje gołymi rękami, aż dostanie nowe. Żelazne Narzędzie starcza osadnikowi bez doświadczenia na {{tool.ironTrees}} drzew.',
        },
      ],
      see: [
        'good:tool_wooden',
        'good:tool_iron',
        'article:exp-work',
        'article:construction',
        'article:gathering',
      ],
    },
    {
      id: 'hauling',
      name: 'Tragarze i magazyny',
      lead: 'Tragarz bez wozu niesie {{haul.carry}} sztukę naraz. Na jednym miejscu na ziemi zmieści się do {{haul.groundStack}} sztuk jednego towaru.',
      blocks: [
        {
          h: 'Pojemność',
        },
        {
          table: {
            head: ['Budynek', 'Sztuk jednego towaru'],
            rows: [
              ['[[building:stock_00|Magazyn 1]]', '{{haul.store1}}'],
              ['[[building:stock_01|Magazyn 2]]', '{{haul.store2}}'],
              ['[[building:stock_02|Magazyn 3]]', '{{haul.store3}}'],
              ['[[building:headquarters|Kwatera główna]]', '{{haul.hq}}'],
            ],
            num: [1],
            foot: 'Każdy z tych budynków przyjmuje po {{haul.storeSeats}} [[job:carrier|Tragarzy]], Zbieraczy, Rybaków i Myśliwych.',
          },
        },
        {
          h: 'Priorytet',
        },
        {
          p: 'Priorytet ustawiasz w magazynie, Kwaterze głównej, Koszarach lub wieży. Tragarze tego budynku zwożą wtedy dany towar z innych magazynów, warsztatów i stosów, dopóki jest na niego miejsce.',
        },
        {
          h: 'Minimum',
        },
        {
          p: 'Minimum, do {{haul.minimumMax}} sztuk towaru, liczy razem wszystkie magazyny i Kwaterę główną. Dopóki suma jest niższa, Tragarze zwożą ten towar z warsztatów, Studni, Uli i stosów, a nikt nie weźmie go z magazynu.',
        },
        {
          p: 'Dotyczy to też jedzenia: jeśli całe jedzenie mieści się w minimum, nikt nie zje go z magazynu. Magazyn z priorytetem dostanie z innego magazynu tylko to, co jest ponad minimum.',
        },
        {
          h: 'Wóz',
        },
        {
          table: {
            head: ['Tragarz', 'Sztuk na kurs', 'Wolniej, gdy pełny'],
            rows: [
              ['Bez wozu', '{{haul.carry}}', '-'],
              ['Z [[good:handcart|Wózkiem Ręcznym]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['Z [[good:oxcart|Zaprzęgiem]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: 'Im mniejszy ładunek, tym mniej wóz zwalnia. Wozy [[job:trader|Kupca]] działają tak samo.',
          },
        },
        {
          list: [
            'Wóz weźmie tylko Tragarz, który ma miejsce pracy, i [[job:trader|Kupiec]].',
            'Wóz musi być twój, wolny i stać na tym samym lądzie.',
            'Jeśli na wozie zostało miejsce, Tragarz magazynu dobiera ten sam towar ze stosów i warsztatów w promieniu {{haul.cartTopUp}} hexów, zanim wróci.',
          ],
        },
        {
          h: 'Stosy na ziemi',
        },
        {
          p: 'Stos na ziemi jest niczyj, może go wziąć każdy. Tragarz podnosi stosy do {{flag.radius}} hexów od swojego budynku, a jeśli ma flagę roboczą, do {{flag.radius}} hexów od flagi.',
        },
      ],
      see: [
        'article:work-flag',
        'article:roads',
        'article:vehicles',
        'article:construction',
        'job:carrier',
        'building:stock_00',
      ],
    },
    {
      id: 'work-flag',
      name: 'Flaga robocza',
      lead: 'Flaga robocza (na przyciskach: chorągiewka) wyznacza, gdzie pracownik pracuje. Nic nie przechowuje, więc Zbieracz bez miejsca pracy zostawia towar na ziemi.',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: 'Droga towaru spod flagi',
          },
        },
        {
          h: 'Bez miejsca pracy i z miejscem pracy',
        },
        {
          table: {
            head: ['Cecha', 'Bez miejsca pracy', 'Z miejscem pracy'],
            rows: [
              [
                'Kto',
                '[[job:collector|Zbieracz]], [[job:fisher|Rybak]], [[job:hunter|Myśliwy]]',
                'Ci sami, plus [[job:carrier|Tragarz]] magazynu, Kwatery głównej lub warsztatu',
              ],
              [
                'Skąd się bierze flaga',
                'Staje sama pod nogami, gdy osadnik obejmuje zawód',
                'Tylko z rozkazu "Wbij chorągiewkę"',
              ],
              ['Gdzie pracuje', 'Wokół flagi', 'Wokół flagi, a bez niej jak w tabeli niżej'],
              ['Jakie towary', 'Wszystko, co zbiera jego zawód', 'Tylko te, które budynek przechowuje'],
              ['Dokąd idzie ładunek', 'Na stos przy fladze', 'Do jego budynku'],
              ['Zabranie flagi', 'Nie da się, można ją tylko przenieść', '"Zabierz chorągiewkę"'],
            ],
          },
        },
        {
          h: 'Po zabraniu flagi',
        },
        {
          table: {
            head: ['Kto', 'Bez flagi'],
            rows: [
              ['Zbieracz', 'Cały zasięg drogowskazów'],
              ['Tragarz magazynu', 'Stosy do {{flag.radius}} hexów od budynku'],
              ['Myśliwy', 'Wokół miejsca pracy'],
              ['Rybak', 'Łowi od miejsca, w którym stoi'],
            ],
          },
        },
        {
          h: 'Obszar roboczy',
        },
        {
          table: {
            head: ['Kto', 'Skąd liczony', 'Poziomo, pionowo', 'Po skosie'],
            rows: [
              ['[[job:collector|Zbieracz]]', 'Flaga robocza', '{{flag.radius}}', 'około {{flag.diagonal}}'],
              ['Tragarz', 'Flaga robocza lub budynek', '{{flag.radius}}', 'około {{flag.diagonal}}'],
              ['[[job:hunter|Myśliwy]]', 'Flaga robocza', '{{flag.hunter}}', '{{flag.hunter}}'],
              ['[[job:fisher|Rybak]]', 'Flaga robocza', '{{flag.fisher}}', 'około {{flag.fisherDiagonal}}'],
              [
                '[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]',
                'Budynek',
                '{{field.radius}}',
                'około {{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: 'W hexach. Kto potrzebuje drogowskazów, pracuje tylko w ich zasięgu.',
          },
        },
        {
          p: 'Tragarzowi Farmy, Chatki zielarza, Studni, Ula, wieży i Koszar nie wbijesz flagi roboczej.',
        },
        {
          h: 'Stos przy fladze',
        },
        {
          list: [
            'Stos spod flagi zabierze tylko Tragarz, który ma miejsce pracy.',
            'Gdy flaga Zbieracza stoi dalej niż {{flag.radius}} hexów od magazynu, wbij Tragarzowi magazynu flagę obok niej.',
            'Gdy przeniesiesz flagę, stosy zostają tam, gdzie były.',
          ],
        },
        {
          h: 'Stawianie flagi',
        },
        {
          p: '"Wbij chorągiewkę" stawia flagę we wskazanym miejscu albo ją tam przenosi, tak samo jak Ctrl z prawym kliknięciem. Jeśli miejsce jest zajęte, flaga stanie na wolnym do {{flag.snap}} hexów obok, a jak takiego nie ma, rozkaz przepada.',
        },
        {
          p: 'W [[article:assistant|Asystencie]] możesz pozwolić Zbieraczom samym przenosić flagę. Zbieracz stawia ją wtedy {{assistant.flagMin}}-{{assistant.flagMax}} hexów od zasobu, a gdy w okolicy wszystko się skończy, przenosi się do zasobu najbliżej swojego budynku. Myśliwi i Rybacy tego nie robią.',
        },
        {
          p: 'Flagę możesz wbić poza zasięgiem sieci, ale pracownik będzie stał, aż sieć tam dotrze: [[article:roads|Drogi i drogowskazy]].',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: 'Drogi i drogowskazy',
      lead: 'Droga kosztuje 1 Kamień i skraca krok w butach na lądzie z {{step.landBrief}} s do {{step.road}} s.',
      blocks: [
        {
          h: 'Drogowskaz',
        },
        {
          p: 'Drogowskazy stawia [[job:scout|Zwiadowca]] i nie kosztują materiału.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Zasięg sieci',
          },
        },
        {
          p: 'Bez drogowskazów osadnik dojdzie do celu oddalonego najwyżej o {{reach.walk}} hexów, [[job:carrier|Tragarz]] o {{reach.carrier}}. Dalej prowadzą drogowskazy: jeśli któryś stoi w tym zasięgu, osadnik korzysta z całej połączonej z nim sieci, a cel musi leżeć w tym samym zasięgu od któregoś jej drogowskazu.',
        },
        {
          list: [
            'Dwa drogowskazy łączą się, gdy stoją bliżej niż {{reach.link}} hexów, a droga między nimi ma najwyżej {{reach.linkRoute}} hexów.',
            'Twój nowy drogowskaz musi stać co najmniej {{reach.spacing}} hexów od innego.',
            'Towaru osadnik szuka bliżej niż {{reach.goods}} hexów od siebie albo od drogowskazów w tym zasięgu.',
            'Budynek postawiony na drogowskazie przesuwa go najwyżej o {{reach.displace}} hexów, a jeśli się nie da, drogowskaz znika.',
          ],
        },
        {
          table: {
            head: ['Teren', 'Zasięg szukania towaru, hexy'],
            rows: [
              ['Droga, ląd', 'mniej niż {{reach.goods}}'],
              ['Piasek', 'około {{reach.goodsSand}}'],
              ['Góry', 'około {{reach.goodsMountain}}'],
              ['Śnieg', 'około {{reach.goodsSnow}}'],
            ],
            num: [1],
            foot: 'Im gorszy teren, tym bliżej osadnik szuka towaru.',
          },
        },
        {
          p: 'Zwiadowcy, żołnierze, bohaterowie, [[job:hunter|Myśliwi]] i [[job:druid|Druidzi]] chodzą bez względu na drogowskazy.',
        },
        {
          p: 'Pracownik, którego miejsce pracy lub flaga wypadnie poza zasięg, ma stan "Zgubił się" i czeka, aż sieć tam dotrze. Towar, który niesie, jeszcze odnosi.',
        },
        {
          h: 'Panel drogowskazu',
        },
        {
          table: {
            head: ['W panelu', 'Znaczenie'],
            rows: [
              [
                '"Towary w sieci"',
                'Wszystkie towary w zasięgu połączonej sieci: w budynkach, na stosach, wozach i w rękach.',
              ],
              [
                '"Wyburz"',
                'Drogowskaz znika od razu, bez pytania. Jeśli łączył dwie części sieci, sieć się rozpada.',
              ],
            ],
            foot: 'Nakładka "Drogowskazy" na mapie pokazuje sieci.',
          },
        },
        {
          h: 'Droga',
        },
        {
          table: {
            head: ['Teren pod drogą', 'Krok bez drogi', 'Krok drogą', 'Oszczędność'],
            rows: [
              ['Ląd', '{{step.land}} s', '{{step.road}} s', '{{step.roadSavedOnLandPct}}%'],
              ['Piasek', '{{step.sand}} s', '{{step.road}} s', '{{step.roadSavedOnSandPct}}%'],
              ['Góry', '{{step.mountain}} s', '{{step.road}} s', '{{step.roadSavedOnMountainPct}}%'],
              ['Śnieg', '{{step.snow}} s', '{{step.road}} s', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1, 2, 3],
            foot: 'Osadnik w butach, bez ładunku. Buty na drodze zużywają się {{shoes.roadWear}} razy wolniej niż na lądzie.',
          },
        },
        {
          list: [
            'Odcinek kosztuje 1 [[good:stone|Kamień]] i 1 uderzenie [[job:builder|Budowniczego]].',
            'Jeden Kamień brukuje też do 6 sąsiednich odcinków, o ile żaden Budowniczy ich jeszcze nie wziął i nie leży na nich Kamień.',
            'Osadnicy sami idą drogą, jeśli tak dojdą szybciej.',
          ],
        },
      ],
      see: [
        'article:walking',
        'article:hauling',
        'article:work-flag',
        'article:construction',
        'job:scout',
        'good:stone',
      ],
    },
    {
      id: 'walking',
      name: 'Szybkość chodu',
      lead: 'Krok na lądzie trwa {{step.landBrief}} s w butach i {{step.landBare}} s boso.',
      blocks: [
        {
          h: 'Krok według terenu',
        },
        {
          table: {
            head: ['Teren', 'W butach', 'Boso', 'Kroków z pary butów'],
            rows: [
              ['Droga, bruk', '{{step.road}} s', '{{step.roadBare}} s', '{{shoes.road}}'],
              ['Ląd', '{{step.land}} s', '{{step.landBare}} s', '{{shoes.land}}'],
              [
                'Piasek, plaża, kamienista pustynia',
                '{{step.sand}} s',
                '{{step.sandBare}} s',
                '{{shoes.sand}}',
              ],
              ['Góry', '{{step.mountain}} s', '{{step.mountainBare}} s', '{{shoes.mountain}}'],
              ['Śnieg', '{{step.snow}} s', '{{step.snowBare}} s', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: 'Z ładunkiem w rękach buty zużywają się {{shoes.carryWear}} razy szybciej. Ile energii kosztuje chodzenie boso: [[article:needs|Potrzeby]].',
          },
        },
        {
          h: 'Co zmienia krok',
        },
        {
          table: {
            head: ['Stan', 'Zmiana'],
            rows: [
              ['Ładunek w rękach', '+{{step.carryExtra}} s'],
              ['Wytrzymałość najwyżej {{need.drivePct}}%', '+{{step.tiredExtra}} s'],
              ['Dziecko', '+{{step.childExtra}} s'],
              ['Niemowlę', 'krok × 2'],
              ['Broń i pancerz ważą razem 2-3', '+{{step.weightLowExtra}} s'],
              ['Broń i pancerz ważą razem 4-5', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Amulet Wiatru]]', '-{{step.amuletSaved}} s'],
              ['Pełny [[good:handcart|Wózek Ręczny]]', '{{haul.handcartLossPct}}% wolniej'],
              ['Pełny [[good:oxcart|Zaprzęg]]', '{{haul.oxcartLossPct}}% wolniej'],
            ],
            foot: 'Krok nigdy nie trwa krócej niż {{step.shortest}} s. Im mniejszy ładunek, tym mniej wóz zwalnia. Bohaterów ciężar nie spowalnia.',
          },
        },
        {
          h: 'Ciężar broni i pancerza',
        },
        {
          table: {
            head: ['Broń', 'Ciężar'],
            rows: [
              ['[[good:sword_shord|Krótki Miecz]], [[good:bow_short|Krótki Łuk]]', '{{weight.shortSword}}'],
              [
                '[[good:spear_wooden|Drewniana Włócznia]], [[good:bow_long|Długi Łuk]]',
                '{{weight.woodenSpear}}',
              ],
              [
                '[[good:spear_iron|Żelazna Włócznia]], [[good:sword_long|Długi Miecz]]',
                '{{weight.ironSpear}}',
              ],
            ],
            num: [1],
            foot: 'Tak samo u wszystkich plemion. Dodaj ciężar broni do ciężaru pancerza z tabeli niżej.',
          },
        },
        {
          data: 'armour',
        },
        {
          h: 'Przykłady',
        },
        {
          table: {
            head: ['Kto', 'Teren', 'Krok'],
            rows: [
              ['Tragarz, w butach, z towarem', 'Droga', '{{step.carrierOnRoad}} s'],
              ['Żołnierz, Długi Miecz, Zbroja Płytowa, w butach', 'Ląd', '{{step.plateSoldierOnLand}} s'],
              ['Kupiec, w butach, pełny Wózek Ręczny', 'Ląd', '{{step.traderFullCart}} s'],
            ],
            num: [2],
          },
        },
      ],
      see: ['good:shoes', 'good:amulet_speed', 'article:roads', 'article:needs', 'article:vehicles'],
    },
    {
      id: 'trade',
      name: 'Handel',
      lead: 'Kupiec kursuje między {{trade.stops}} budynkami, a bez wozu bierze {{haul.carry}} sztukę naraz.',
      blocks: [
        {
          h: 'Czym wozi',
        },
        {
          table: {
            head: ['Czym wozi', 'Załadunek lub rozładunek sztuki'],
            rows: [
              ['Ręce', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Wózek Ręczny]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Zaprzęg]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'Pojemność i spowolnienie: [[article:hauling|Tragarze i magazyny]].',
          },
        },
        {
          p: 'Gdy wóz jedzie pełny w jedną stronę i pusty z powrotem, oba wozy przewożą tyle samo na trasie około {{trade.cartParLand}} hexów po lądzie albo {{trade.cartParRoad}} hexów drogą. Na krótszej trasie lepszy jest Wózek Ręczny, na dłuższej Zaprzęg.',
        },
        {
          h: 'Trasa',
        },
        {
          list: [
            'Trasa łączy {{trade.stops}} gotowe budynki z zapasami. Najwyżej 1 z nich może należeć do kogoś innego.',
            'Gdy budynek jest w rozbudowie, [[job:trader|Kupiec]] czeka, aż się skończy.',
            'Z Domu Kupiec nie zabiera jedzenia.',
          ],
        },
        {
          h: 'Własne budynki',
        },
        {
          p: 'A i B to dwa budynki trasy.',
        },
        {
          table: {
            head: ['Ustawienie', 'Skutek'],
            rows: [
              ['Towar oznaczony w budynku B', 'Bierze go z A i zawozi do B'],
              ['Towar oznaczony w obu budynkach', 'Wyrównuje zapasy między nimi'],
              ['W żadnym budynku nic nie oznaczono', 'Kupiec nic nie wozi'],
              ['do N', 'Przestaje dowozić, gdy w budynku docelowym będzie N sztuk, licząc z ładunkiem'],
              ['zostaw N', 'W budynku źródłowym zostaje N sztuk'],
              [
                'osada',
                'Bierze towar z całej osady: najpierw z tego magazynu, potem z innych magazynów i warsztatów w jego sieci drogowskazów',
              ],
            ],
            foot: 'Opcję osada włączysz tylko w magazynie lub Kwaterze głównej i tylko w jednym z dwóch budynków trasy. Kupiec nie zabierze towaru poniżej minimum w magazynach.',
          },
        },
        {
          h: 'Handel z komputerem',
        },
        {
          list: [
            'Handlować możesz tylko z gotowym budynkiem gracza komputerowego, który ma ofertę ustaloną przez mapę.',
            'Żeby dodać budynek do trasy, obie strony muszą być wobec siebie przyjazne. Później wystarczy, że przyjazne jest plemię Kupca: [[article:diplomacy|Dyplomacja]].',
            'Oferta to N sztuk jednego towaru za M sztuk innego, a liczby ustala mapa. Trasa obsługuje jedną ofertę naraz.',
            'Co {{trade.refillSeconds}} s komputer uzupełnia towar z oferty w swoim magazynie do {{trade.refillLevel}} sztuk.',
            'Gdy w budynku komputera nie ma zapłaty, Kupiec czeka i nie oddaje towaru.',
            '"zostaw N" zostawia w twoim budynku N sztuk towaru na sprzedaż. Limit powrotu N kończy handel, gdy twój budynek ma już N sztuk zapłaty.',
          ],
        },
      ],
      see: [
        'article:diplomacy',
        'article:vehicles',
        'article:hauling',
        'article:roads',
        'job:trader',
        'good:handcart',
      ],
    },
  ],
};
