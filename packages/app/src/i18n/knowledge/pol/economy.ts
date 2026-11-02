import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Gospodarka',
  items: [
    {
      id: 'construction',
      name: 'Budowa, rozbudowa, naprawa',
      lead: 'Same uderzenia przy Domu 1 zajmują jednemu Budowniczemu {{build.noviceSeconds}} s, z Żelaznym Narzędziem {{build.noviceIronSeconds}} s. Noszenie materiału dolicza się osobno.',
      blocks: [
        {
          h: 'Gdzie można budować',
        },
        {
          table: {
            head: ['Co', 'Co się dzieje'],
            rows: [
              [
                'Teren',
                'Stawiasz na lądzie, piasku, plaży i kamienistej pustyni. Góry, śnieg, woda i bagno odpadają.',
              ],
              [
                '[[building:work_well_00|Studnia]], [[building:work_hive_00|Ul]]',
                'Choć skraj budynku musi stać na trawie.',
              ],
              [
                'Miejsce',
                'Budynek od razu rezerwuje miejsce na najwyższy poziom i wąski pas wokół. Te pasy dwóch budynków nie mogą na siebie zachodzić.',
              ],
              ['Drzewo, skała, złoże, palisada', 'Blokują. Muszą stać poza miejscem na najwyższy poziom.'],
              [
                'Wrogi żołnierz',
                'Nie zbudujesz do {{contest.radius}} hexów od niego, po skosie około {{contest.diagonal}}. Liczy się tylko żołnierz, którego widzisz. Załoga na stanowisku w wieży się nie liczy.',
              ],
              [
                'Budynek gracza, z którym łączy cię pokój',
                'Nie zbudujesz do {{peace.keepOut}} hexów od jego budynku lub placu, chyba że twój własny budynek stoi tam bliżej niż jego.',
              ],
              ['Teren pod mgłą', 'Blokuje. Miejsce musi być teraz widoczne.'],
              ['Osadnik, pojazd, flaga robocza, drogowskaz, stos, truchło', 'Zostaną odsunięte na bok.'],
              ['Krzew, pole, pniak, otwarta skrzynia', 'Znikają, gdy stanie plac.'],
              ['Plac pod drogę', 'Zostaje anulowany, dostarczony Kamień ląduje obok.'],
              [
                'Droga, palisada na miejscu pod rozbudowę',
                'Wytyczana linia omija to miejsce. Domyślnie klawisz G pozwala ją tam położyć, ale rozbudowa usunie ją bez zwrotu.',
              ],
              ['Wrodzy cywile, zwierzęta', 'Nie przeszkadzają. Plac stanie obok nich.'],
              ['Ułożona droga', 'Zostaje pod budynkiem.'],
              [
                'Zasięg drogowskazów',
                'Nie obowiązuje. Plac stanie też poza siecią, a Budowniczy dojdzie, gdy sieć tam sięgnie.',
              ],
            ],
          },
        },
        {
          figure: {
            id: 'step-diamond',
            caption: 'Czemu po skosie mniej',
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
            foot: 'Dom 1 kosztuje {{build.homeUnits}} sztuki materiału. Czas samych uderzeń, 1 uderzenie trwa {{build.swingSeconds}} s.',
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
            foot: 'Uderzeń na 1 sztukę materiału. [[job:builder|Budowniczy]] ma 100% po {{exp.build.repeatsFull}} uderzeniach. Liczą się tylko te, które coś wniosły.',
          },
        },
        {
          list: [
            'Budynek bez kosztu wymaga 1 uderzenia.',
            'Odcinek palisady lub drogi stawia 1 Budowniczy, 1 uderzeniem, gdy materiał jest na miejscu.',
            'Materiał nosi Budowniczy i pracownik przypisany do placu, po 1 sztuce.',
          ],
        },
        {
          h: 'Kolejność pracy Budowniczego',
        },
        {
          steps: [
            'Droga albo palisada, które gracz właśnie zlecił temu Budowniczemu.',
            'Naprawa: bramy, potem budynki, potem palisady.',
            'Place budynków, najpierw zaopatrzone i bliskie końca.',
            'Nowe odcinki palisady.',
            'Drogi.',
          ],
        },
        {
          p: 'Budowniczy przypisany przez gracza do placu zostaje przy nim, także gdy gdzie indziej jest praca.',
        },
        {
          h: 'Rozbudowa',
        },
        {
          list: [
            'Kosztuje materiały podnoszonych poziomów. Można przeskoczyć kilka poziomów naraz, jeśli każdy jest odblokowany.',
            'Towar z kosztu, który budynek ma w zapasie, idzie od razu na plac. Reszta zapasów wraca po ukończeniu.',
            'Pracownicy i mieszkańcy wychodzą, zachowują miejsce i wracają po ukończeniu.',
            'W czasie rozbudowy zdrowie nie rośnie. Po ukończeniu budynek ma pełne zdrowie nowego poziomu.',
            'Start rozbudowy wyłącza tryb obrony.',
            'Anulowanie oddaje zapasy i towar z nich wzięty, dostarczony materiał przepada.',
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
          list: [
            'Budowniczy sam nie idzie naprawiać przez {{repair.calmSeconds}} s od ostatniego trafienia ani gdy do {{alert.standTo}} hexów trwa walka. Twój rozkaz omija oba warunki.',
            'Placu budowy i palisady w budowie się nie naprawia. Ich zdrowie rośnie razem z budową.',
            'Uszkodzony budynek w rozbudowie: najpierw naprawa, potem rozbudowa.',
          ],
        },
        {
          h: 'Co przepada, a co wraca',
        },
        {
          table: {
            head: ['Sytuacja', 'Skutek'],
            rows: [
              ['Wyburzenie placu', 'Dostarczony materiał ląduje na ziemi'],
              [
                'Wyburzenie lub zniszczenie budynku',
                'Zawartość i połowa kosztu, każdy towar zaokrąglony w górę',
              ],
              [
                'Wyburzenie budynku w rozbudowie',
                'To samo dla obecnego poziomu, plus odłożone zapasy i materiał rozbudowy',
              ],
            ],
            foot: 'Towar układa się na ziemi do {{reach.spill}} hexów, na tym samym lądzie. Co się nie zmieści, przepada.',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Warsztaty i wybór produktu',
      lead: 'Licznik przy produkcie mówi, ile cykli ma wykonać pracownik: 0 to stop, ∞ bez końca. Cykl to jedno wykonanie przepisu.',
      blocks: [
        {
          h: 'Wartości licznika',
        },
        {
          table: {
            head: ['Licznik', 'Warsztat', 'Zbieracz'],
            rows: [
              ['0', 'Produkt stoi', 'Towar pominięty'],
              [
                '1-{{workshop.counterMax}}',
                'Tyle cykli, -1 przy starcie cyklu',
                'Tyle sztuk, -1 za zdobytą sztukę',
              ],
              ['∞', 'Bez końca, licznik nie spada', 'Bez końca, licznik nie spada'],
            ],
            foot: 'Warsztat liczy cykle, Zbieracz sztuki. Doświadczenie i narzędzie dokładają sztuk z cyklu: [[article:tools|Narzędzia]].',
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
                'Ten towar: z 0 na ∞, z każdej innej wartości na 0. Reszta bez zmian.',
              ],
              ['Mniej', '-1. Z 0 skok na ∞, z ∞ na {{workshop.counterMax}}', '-10', 'Na 0'],
              ['Więcej', '+1. Ze {{workshop.counterMax}} skok na ∞, z ∞ na 0', '+10', 'Na ∞'],
            ],
          },
        },
        {
          h: 'Start nowego pracownika',
        },
        {
          table: {
            head: ['Kto', 'Liczniki na start'],
            rows: [
              ['Rzemieślnik', 'Pierwszy produkt warsztatu ∞, reszta 0'],
              ['[[job:breeder|Hodowca]] na [[building:work_animal_farm|Fermie bydła]]', 'Wół ∞, Owca 0'],
              [
                'Absolwent przydzielony przez Asystenta, gdy Szkoła uczy tego zawodu kilku wyrobów',
                'Wyroby poznane w Szkole ∞, reszta 0',
              ],
              ['[[job:collector|Zbieracz]]', 'Każdy towar ∞'],
            ],
          },
        },
        {
          h: 'Co dzieje się z licznikami',
        },
        {
          p: 'Liczniki przepadają przy zmianie miejsca pracy lub zawodu, także gdy budynek zostanie zburzony. Rozbudowa ich nie rusza, a nowe produkty z wyższego poziomu dostają 0. Każdy pracownik ma własne liczniki: 2 ludzi w jednym warsztacie może robić 2 różne produkty.',
        },
        {
          h: 'Kilka produktów naraz',
        },
        {
          p: 'Pracownik robi na zmianę produkty z licznikiem powyżej 0, po 1 cyklu, w kolejności z panelu.',
        },
        {
          table: {
            head: ['Sytuacja', 'Skutek'],
            rows: [
              [
                'Pełny zapas produktu',
                'Pracownik bierze następny produkt. Cykle w toku liczą się jako zajęte miejsce.',
              ],
              ['Brak składnika w budynku', 'Pracownik bierze następny produkt'],
              [
                'Część składnika w budynku',
                'Czeka na resztę. Gdy reszty nie ma skąd wziąć, bierze następny produkt.',
              ],
              [
                'Produkt bez wymaganego doświadczenia',
                'Napis "zablokowane" zamiast licznika, pomijany w kolejce',
              ],
              [
                'Zablokowane wszystkie produkty z licznikiem',
                'Pracownik robi to, co już umie, także produkty na 0',
              ],
            ],
          },
        },
        {
          h: 'Pojazdy',
        },
        {
          list: [
            'Pojazd powstaje poza warsztatem: rzemieślnik stawia obok plac, sam nosi materiał i buduje.',
            'Licznik pojazdu spada po ukończeniu pojazdu, nie na starcie.',
            'Gdy obok warsztatu nie ma miejsca na plac, pracownik bierze następny produkt.',
          ],
        },
        {
          h: 'Zbieracze',
        },
        {
          table: {
            head: ['Akcja', 'Skutek'],
            rows: [
              ['"Tylko to dobro"', 'Ten towar ∞, reszta 0'],
              ['Prawy klik na zasobie', '"Zbieraj": ten towar ∞, reszta 0, flaga robocza stoi, gdzie stała'],
              ['Ctrl i prawy klik na zasobie', 'To samo, a flaga idzie na zasób'],
              ['Wszystkie liczniki na 0', 'Stan "Towary na 0"'],
              [
                'Licznik na 0, a towar leży',
                'Licznik dotyczy tylko wydobycia. Leżące pnie i stosy Zbieracz nosi dalej.',
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
      lead: 'Drzewo daje {{gather.treeYield}} sztuki Drewna po {{gather.strokes}} uderzeniach. Skała tyle samo uderzeń bierze na 1 sztukę, więc Drewno idzie około {{gather.treeYield}} razy szybciej.',
      blocks: [
        {
          h: 'Co daje zasób',
        },
        {
          table: {
            head: ['Zasób', 'Kto', 'Daje', 'Uderzeń bez doświadczenia', 'Czas', 'Narzędzie'],
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
                '1 podniesienie',
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
            foot: 'Czas samej pracy, bez doświadczenia i narzędzia, bez chodzenia.',
          },
        },
        {
          list: [
            'Ścięte drzewo leży jako pień z {{gather.treeYield}} sztukami. Zbieracz nosi je po 1 sztuce.',
            'Sztuka ze skały lub złoża spada obok, na ziemię.',
          ],
        },
        {
          h: 'Żelazo i Złoto',
        },
        {
          table: {
            head: ['Sposób', 'Warunek', 'Kogo dotyczy'],
            rows: [
              [
                'Praca',
                '{{gather.oreNeed}} sztuk [[good:mud|Gliny]] i [[good:stone|Kamienia]] razem',
                'Tego osadnika. Pierwszy odkrywa towar dla osady.',
              ],
              ['[[building:school|Szkoła]]', 'Kurs, gdy towar jest już odkryty', 'Absolwenta'],
            ],
            foot: 'Osadnik musi spełnić warunek sam, osobno dla [[good:iron|Żelaza]] i [[good:gold|Złota]]. Do tego czasu panel pokazuje "zablokowane".',
          },
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
          p: 'Pole rośnie tylko od podlewania, czas nie ma wpływu. Każde podlanie dodaje 1 etap temu polu i 6 sąsiednim, więc pole potrzebuje najwyżej {{field.waterings}} podlania. Po ścięciu leży 1 sztuka, a miejsce wraca pod siew.',
        },
        {
          p: 'Sianie i podlewanie nic nie kosztują, Woda nie jest potrzebna.',
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
            foot: 'Po skosie promień to około {{field.diagonal}} hexów. Limit pól dotyczy budynku, nie pracownika. Więcej ludzi to szybsze zbiory.',
          },
        },
        {
          h: 'Kolejność pracy Farmera i Zbieracza Ziół',
        },
        {
          steps: [
            'Zanosi ściętą sztukę do budynku.',
            'Sieje, gdy budynek ma mniej niż {{field.max}} pól.',
            'Ścina najbliższe dojrzałe pole.',
            'Podlewa pole o najniższym etapie.',
            'Czeka w budynku.',
          ],
        },
        {
          p: 'Pola nie zasiejesz na piasku ani na drodze. Dzikie pola z mapy w zasięgu budynku liczą się do jego limitu.',
        },
        {
          p: 'Pole odcięte od drzwi budynku na {{field.reclaimSeconds}} s znika i zwalnia miejsce w limicie.',
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
      lead: 'Narzędzie zmniejsza liczbę uderzeń, dokłada sztuk w warsztacie i wytrzymuje {{tool.uses}} użyć.',
      blocks: [
        {
          h: 'Skąd osadnik ma narzędzie',
        },
        {
          p: 'Narzędzia rozdaje [[article:assistant|Asystent]], włączony od startu, albo twój rozkaz. Osadnik idzie po nie do magazynu tylko z pustym miejscem na narzędzie, Żelazne przed Drewnianymi. Lepszego nie weźmie sam.',
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
            foot: 'Drzewo, skała, złoże, pole ziół.',
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
          p: 'Ścięcie pola [[good:wheat|Pszenicy]] to {{gather.wheatStrokes}} uderzenia bez narzędzia, a 1 z narzędziem lub od 20% doświadczenia.',
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
            foot: 'Dla przepisu na 1 sztukę, przy przepisie na 2 sztuki dodatek jest podwójny. Składniki i czas się nie zmieniają. Doświadczenie działa też przy uboju.',
          },
        },
        {
          p: 'Ułamki zbierają się w warsztacie. Pełna sztuka trafia do zapasu, nawet ponad pojemność.',
        },
        {
          h: 'Zużycie',
        },
        {
          table: {
            head: ['Praca', 'Użycie narzędzia'],
            rows: [
              ['Cykl w warsztacie', '1 za ukończony cykl'],
              ['Uderzenie przy zbieraniu', '1 za uderzenie, także bez efektu'],
              ['Rzut wędką', '1 za rzut, także nieudany'],
              ['Uderzenie Budowniczego', '1 za uderzenie, także przy naprawie i gdy nic nie wniosło'],
              ['Podlewanie', '1 za podlanie'],
              ['Sianie, podnoszenie grzybów', '0'],
            ],
            foot: 'Po {{tool.uses}} użyciach narzędzie znika. Osadnik pracuje gołymi rękami, aż dostanie nowe. Żelazne Narzędzie starcza osadnikowi bez doświadczenia na {{tool.ironTrees}} drzew.',
          },
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
      lead: 'Tragarz bez wozu nosi {{haul.carry}} sztukę. W jednym miejscu na ziemi leży do {{haul.groundStack}} sztuk jednego towaru.',
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
          p: 'Priorytet ustawiasz w jednym budynku: magazynie, Kwaterze głównej, Koszarach lub wieży. Jego Tragarze zwożą towar z innych magazynów, warsztatów i stosów, dopóki jest miejsce.',
        },
        {
          h: 'Minimum',
        },
        {
          p: 'Minimum liczy razem wszystkie magazyny i Kwaterę główną, do {{haul.minimumMax}} sztuk towaru. Dopóki suma jest niższa, Tragarze magazynów, Kwatery głównej, Studni i Uli zwożą towar z warsztatów, Studni, Uli i stosów, a nikt nie weźmie go z magazynu.',
        },
        {
          p: 'To dotyczy też jedzenia: gdy całe jedzenie mieści się w minimum, nikt nie zje z magazynu. Magazyn oddaje towar magazynowi z priorytetem tylko ponad minimum.',
        },
        {
          h: 'Kolejność pracy Tragarza w magazynie',
        },
        {
          steps: [
            'Odnosi to, co ma w rękach.',
            'Zwozi towar oznaczony jako priorytet w swoim budynku.',
            'W magazynie i Kwaterze głównej zwozi towar poniżej minimum.',
            'Podnosi najbliższy stos z towarem dla swojego budynku.',
            'Zabiera gotowe wyroby z warsztatów do swojego budynku.',
          ],
        },
        {
          table: {
            head: ['Tragarz pracuje w', 'Co robi'],
            rows: [
              [
                '[[building:work_farm_00|Farma]], [[building:work_herb_hut|Chatka zielarza]]',
                'Najpierw wywozi plon do magazynu, potem stosy',
              ],
              ['Warsztat', 'Najpierw dowozi składniki, potem wywozi wyroby'],
              ['[[building:work_well_00|Studnia]], [[building:work_hive_00|Ul]]', 'Wywozi zawartość'],
            ],
          },
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
            foot: 'Im mniejszy ładunek, tym mniej zwalnia. Wozy [[job:trader|Kupca]] mają te same liczby.',
          },
        },
        {
          list: [
            'Wóz bierze tylko Tragarz z miejscem pracy i [[job:trader|Kupiec]]. Tragarz zachowuje miejsce pracy.',
            'Wóz musi być własny i wolny: bez załogi, bez innego dowódcy, na tym samym lądzie.',
            'Gdy na wozie zostało miejsce, Tragarz magazynu dobiera ten sam towar ze stosów i warsztatów do {{haul.cartTopUp}} hexów od siebie, potem wraca.',
            'Po utracie miejsca pracy wóz zostaje na miejscu.',
          ],
        },
        {
          h: 'Stosy na ziemi',
        },
        {
          list: [
            'Stos nie ma właściciela, bierze każdy.',
            'Tragarz bez flagi roboczej podnosi do {{flag.radius}} hexów od budynku, z flagą do {{flag.radius}} hexów od flagi.',
          ],
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
      lead: 'Flaga robocza (na przyciskach chorągiewka) wyznacza obszar roboczy i nic nie przechowuje. Zbieracz bez miejsca pracy zostawia towar na ziemi.',
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
              ['Skąd flaga', 'Staje sama pod nogami przy objęciu zawodu', 'Tylko z "Wbij chorągiewkę"'],
              ['Gdzie pracuje', 'Wokół flagi', 'Wokół flagi, bez flagi według tabeli niżej'],
              ['Jakie towary', 'Każdy, który zawód zbiera', 'Tylko te, które budynek przechowuje'],
              ['Dokąd idzie ładunek', 'Stos na ziemi przy fladze', 'Do budynku pracownika'],
              ['Zabranie flagi', 'Nie można, można tylko przenieść', '"Zabierz chorągiewkę"'],
              [
                'Utrata miejsca pracy',
                '-',
                'Zbieracz, Rybak i Myśliwy pracują dalej od swojej flagi. Bez flagi dostają nową pod nogami. Tragarz traci flagę.',
              ],
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
              ['Tragarz', 'Magazyn: stosy do {{flag.radius}} hexów od budynku'],
              ['Myśliwy', 'Wokół miejsca pracy'],
              ['Rybak', 'Szuka brzegu od miejsca, w którym stoi'],
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
            foot: 'W hexach. Zawód zależny od drogowskazów pracuje tylko w ich zasięgu.',
          },
        },
        {
          p: 'Flagi roboczej nie przyjmuje Tragarz Farmy, Chatki zielarza, Studni, Ula, wieży ani Koszar.',
        },
        {
          h: 'Stos przy fladze',
        },
        {
          list: [
            'Stos spod flagi zabierze tylko Tragarz z miejscem pracy.',
            'Dalej niż {{flag.radius}} hexów od magazynu daj Tragarzowi własną flagę przy fladze Zbieracza.',
            'Tragarz z flagą bierze stosy i gotowe wyroby wokół niej i niesie je do swojego budynku.',
            'Przeniesienie flagi nie przenosi stosów.',
          ],
        },
        {
          h: 'Stawianie flagi',
        },
        {
          p: '"Wbij chorągiewkę" stawia flagę we wskazanym miejscu albo ją tam przenosi. Na zajętym miejscu szuka wolnego do {{flag.snap}} hexów, dalej rozkaz przepada. To samo robi Ctrl i prawy klik.',
        },
        {
          p: 'Przełącznik w [[article:assistant|Asystencie]] pozwala Zbieraczowi przenosić flagę samemu: stawia ją {{assistant.flagMin}}-{{assistant.flagMax}} hexów od zasobu. Gdy obszar się wyczerpie, idzie do zasobu najbliżej swojego budynku. Myśliwego i Rybaka to nie dotyczy.',
        },
        {
          p: 'Flagę wolno wbić poza zasięgiem, ale pracownik stoi, aż sieć tam dotrze: [[article:roads|Drogi i drogowskazy]].',
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
          p: 'Drogowskaz stawia [[job:scout|Zwiadowca]], bez materiału.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Zasięg sieci',
          },
        },
        {
          p: 'Osadnik dojdzie sam do celu w zasięgu {{reach.walk}} hexów, [[job:carrier|Tragarz]] {{reach.carrier}}. Dalej prowadzi drogowskaz: gdy stoi bliżej niż ten zasięg, otwiera całą połączoną sieć, a cel musi leżeć w tym samym zasięgu od któregoś drogowskazu tej sieci.',
        },
        {
          list: [
            'Dwa drogowskazy łączą się bliżej niż {{reach.link}} hexów, trasa między nimi do {{reach.linkRoute}} hexów.',
            'Własny drogowskaz stanie co najmniej {{reach.spacing}} hexów od innego.',
            'Towaru osadnik szuka bliżej niż {{reach.goods}} hexów, także od drogowskazów w tym zasięgu.',
            'Budynek postawiony na drogowskazie odsuwa go do {{reach.displace}} hexów, dalej drogowskaz przepada.',
          ],
        },
        {
          table: {
            head: ['Teren', 'Szukanie towaru, hexy'],
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
          p: 'Zasięg nie dotyczy Zwiadowcy, żołnierzy, bohaterów, [[job:hunter|Myśliwego]] i [[job:druid|Druida]].',
        },
        {
          p: 'Pracownik, którego miejsce pracy lub flaga wypadnie poza zasięg, dostaje stan "Zgubił się" i stoi, aż sieć tam dotrze. Niesiony towar jeszcze odnosi.',
        },
        {
          h: 'Panel drogowskazu',
        },
        {
          table: {
            head: ['Element', 'Znaczenie'],
            rows: [
              [
                '"Towary w sieci"',
                'Towar w zasięgu całej połączonej sieci: budynki, stosy, wozy, ręce. Każda sztuka liczona raz.',
              ],
              [
                '"Wyburz"',
                'Drogowskaz znika od razu, bez potwierdzenia i bez Zwiadowcy. Jeśli był jedynym łącznikiem, sieć rozpada się na części.',
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
            'Ten sam Kamień brukuje też do 6 sąsiednich odcinków, jeśli żaden Budowniczy ich nie wziął i nie leży na nich Kamień.',
            'Anulowanie odcinka: dostarczony Kamień ląduje obok.',
            'Osadnik sam wybiera drogę, gdy tak dojdzie szybciej.',
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
            foot: 'Z ładunkiem w rękach buty zużywają się {{shoes.carryWear}} razy szybciej. Energia za bosy krok: [[article:needs|Potrzeby]].',
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
              ['Wytrzymałość do {{need.drivePct}}%', '+{{step.tiredExtra}} s'],
              ['Dziecko', '+{{step.childExtra}} s'],
              ['Niemowlę', 'krok × 2'],
              ['Broń i pancerz ważą razem 2-3', '+{{step.weightLowExtra}} s'],
              ['Broń i pancerz ważą razem 4-5', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Amulet Wiatru]]', '-{{step.amuletSaved}} s'],
              ['Pełny [[good:handcart|Wózek Ręczny]]', '{{haul.handcartLossPct}}% wolniej'],
              ['Pełny [[good:oxcart|Zaprzęg]]', '{{haul.oxcartLossPct}}% wolniej'],
            ],
            foot: 'Najszybszy krok trwa {{step.shortest}} s. Im mniejszy ładunek, tym mniej wóz zwalnia. Bohaterowie nie zwalniają od ciężaru.',
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
            foot: 'Taki sam dla wszystkich plemion. Ciężar broni dodaj do ciężaru pancerza z tabeli niżej.',
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
      lead: 'Kupiec jeździ między {{trade.stops}} budynkami i bez wozu bierze {{haul.carry}} sztukę na kurs.',
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
          p: 'W butach, gdy wóz jedzie pełny w jedną stronę i pusty z powrotem, oba wozy przewożą tyle samo na trasie około {{trade.cartParLand}} hexów po lądzie albo {{trade.cartParRoad}} hexów drogą. Na krótszej wygrywa Wózek Ręczny, na dłuższej Zaprzęg.',
        },
        {
          h: 'Trasa',
        },
        {
          list: [
            'Trasa łączy {{trade.stops}} gotowe budynki z zapasami. Obcy może być najwyżej 1.',
            'Gdy budynek jest w rozbudowie, [[job:trader|Kupiec]] czeka na jej koniec.',
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
              ['Towar oznaczony w budynku B', 'Ładuje w A, rozładowuje w B'],
              ['Towar oznaczony w obu budynkach', 'Wyrównuje zapasy między nimi'],
              ['Żaden budynek nic nie oznacza', 'Kupiec stoi'],
              ['do N', 'Zatrzymuje dowóz, gdy budynek docelowy ma N razem z ładunkiem'],
              ['zostaw N', 'W budynku źródłowym zostaje N sztuk'],
              [
                'osada',
                'Ładuje z całej osady: najpierw z tego magazynu, potem z magazynów i warsztatów w jego sieci drogowskazów',
              ],
            ],
            foot: 'Opcja osada działa tylko dla magazynu lub Kwatery głównej, tylko na jednym z dwóch budynków trasy. Minimum w magazynach też ogranicza załadunek.',
          },
        },
        {
          h: 'Handel z komputerem',
        },
        {
          list: [
            'Handlować można tylko z gotowym budynkiem gracza komputerowego, który ma ofertę z mapy.',
            'Żeby dodać budynek do trasy, obie strony muszą być przyjazne. Później wystarczy, że plemię Kupca jest przyjazne: [[article:diplomacy|Dyplomacja]].',
            'Oferta to N sztuk jednego towaru za M sztuk drugiego, liczby ustala mapa. Trasa handluje jedną ofertą naraz.',
            'Co {{trade.refillSeconds}} s magazyn komputera wraca do {{trade.refillLevel}} sztuk towaru z oferty.',
            'Kupiec ładuje tyle pełnych wymian, ile zmieści wóz, z miejscem na zapłatę. Na małym wozie jedna wymiana dzieli się na kilka kursów.',
            'Oddaje towar, bierze zapłatę i powtarza, dopóki ma towar. Gdy w budynku nie ma zapłaty, czeka i nie oddaje towaru.',
            '"zostaw N" zostawia w budynku N sztuk towaru na sprzedaż. Limit powrotu N: Kupiec kończy, gdy budynek ma N sztuk zapłaty.',
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
