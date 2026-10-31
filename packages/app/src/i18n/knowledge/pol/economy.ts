import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Gospodarka',
  items: [
    {
      id: 'construction',
      name: 'Budowa, rozbudowa, naprawa',
      lead: 'Dom 1 stawia jeden Budowniczy w 150 s, z Żelaznym Narzędziem w 75 s.',
      blocks: [
        {
          h: 'Gdzie można budować',
        },
        {
          table: {
            head: ['Nie stanie', 'Zasada'],
            rows: [
              ['Teren', 'Ląd, piasek, plaża, kamienista pustynia. Góry, śnieg, woda i bagno odpadają.'],
              [
                '[[building:work_well_00|Studnia]], [[building:work_hive_00|Ul]]',
                'Co najmniej 1 punkt pod budynkiem na trawie',
              ],
              [
                'Miejsce',
                'Budynek od razu zajmuje obrys swojego ostatniego poziomu i margines wokół. Marginesy dwóch budynków nie mogą się nakładać.',
              ],
              ['Drzewo, skała, złoże, palisada', 'Muszą stać poza obrysem'],
              [
                'Wrogi żołnierz',
                'Odmowa do 18 kroków, po skosie około 12. Liczy się tylko widoczny, bez załogi na stanowisku w wieży.',
              ],
              [
                'Budynek gracza, z którym łączy cię pokój',
                'Odmowa do 60 kroków od niego, także od placu budowy, chyba że twój budynek stoi bliżej.',
              ],
              [
                'Teren rozbudowy',
                'Obrys wyższych poziomów stojącego budynku jest zajęty. Inny budynek tam nie stanie.',
              ],
              ['Teren pod mgłą', 'Miejsce musi być teraz widoczne'],
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
          table: {
            head: ['Ustępuje', 'Zasada'],
            rows: [
              ['Osadnik, pojazd, flaga robocza, drogowskaz, stos, truchło', 'Odsunięte na bok'],
              ['Krzew, pole, pniak, otwarta skrzynia', 'Zniszczone przy postawieniu placu'],
              ['Plac pod drogę', 'Anulowany, dostarczony Kamień ląduje obok'],
              [
                'Droga, palisada na terenie rozbudowy',
                'Omijają go. Klawisz przy wytyczaniu linii włącza "przez teren rozbudowy" i kładzie je na nim, a rozbudowa burzy je bez zwrotu.',
              ],
            ],
          },
        },
        {
          table: {
            head: ['Nie przeszkadza', 'Zasada'],
            rows: [
              ['Wrodzy cywile, zwierzęta', 'Plac stanie obok nich'],
              ['Ułożona droga', 'Zostaje pod budynkiem'],
              [
                'Zasięg drogowskazów',
                'Nie obowiązuje. Plac stanie też poza siecią, a Budowniczy dojdzie, gdy sieć tam sięgnie.',
              ],
            ],
          },
        },
        {
          h: 'Ile trwa budowa',
        },
        {
          table: {
            head: ['[[building:home_level_00|Dom 1]], 1 Budowniczy', 'Punkty na cios', 'Ciosy', 'Czas'],
            rows: [
              ['Nowicjusz, bez narzędzia', 1, 120, '150 s'],
              ['Nowicjusz, [[good:tool_iron|Żelazne Narzędzie]]', 2, 60, '75 s'],
              ['Mistrz, [[good:tool_iron|Żelazne Narzędzie]]', 4, 30, '37,5 s'],
            ],
            num: [1, 2, 3],
            foot: 'Sztuka materiału to 30 punktów budowy, Dom 1 to 4 sztuki, 120 punktów. Czas samych ciosów, bez noszenia materiału. 1 cios trwa 1,25 s.',
          },
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0-9%', 1, 1, 2],
              ['10-21%', 1, 2, 2],
              ['22-49%', 1, 2, 3],
              ['50-78%', 2, 2, 3],
              ['79-89%', 2, 2, 4],
              ['90-100%', 2, 3, 4],
            ],
            num: [1, 2, 3],
            foot: 'Punkty budowy na 1 cios. [[job:builder|Budowniczy]] ma 100% po 3240 ciosach, które coś dodały.',
          },
        },
        {
          list: [
            'Budynek bez kosztu wymaga 1 ciosu.',
            'Odcinek palisady i odcinek drogi to 1 cios po dostarczeniu materiału, 1 Budowniczy.',
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
            'Zdrowie stoi w trakcie, po ukończeniu jest pełne dla nowego poziomu.',
            'Start rozbudowy wyłącza tryb obrony.',
            'Palisady i drogi pod nowym budynkiem znikają, nic nie wraca.',
            'Anulowanie oddaje zapasy i towar z nich wzięty, dostarczony materiał przepada.',
          ],
        },
        {
          h: 'Naprawa',
        },
        {
          table: {
            head: ['Cel', 'Zdrowie na cios', 'Budowniczych naraz'],
            rows: [
              ['Budynek', '100-400', 5],
              ['Odcinek palisady', 5, 1],
              ['Brama', 5, 1],
            ],
            num: [1, 2],
            foot: 'Naprawa nie kosztuje materiału. Budynek dostaje 100 zdrowia na punkt budowy. Przy palisadzie i bramie doświadczenie i narzędzie nic nie zmieniają.',
          },
        },
        {
          list: [
            'Po ciosie wroga naprawa czeka 10 s, a w promieniu 40 kroków nikt nie może walczyć. Rozkaz gracza pomija oba warunki.',
            'Plac budowy i odcinek palisady w budowie nie mają naprawy, zdrowie rośnie z budową.',
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
              ['Wyburzenie lub zniszczenie budynku', 'Zawartość plus połowa kosztu, każda pozycja w górę'],
              [
                'Wyburzenie budynku w rozbudowie',
                'To samo dla obecnego poziomu, plus odłożone zapasy i materiał rozbudowy',
              ],
            ],
            foot: 'Towar układa się na ziemi do 32 kroków, na tym samym lądzie. Co się nie zmieści, przepada.',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Warsztaty i wybór produktu',
      lead: 'Licznik mówi, ile partii ma zrobić pracownik: 0 stop, ∞ bez końca. Partia to jedno wykonanie przepisu.',
      blocks: [
        {
          h: 'Wartości licznika',
        },
        {
          table: {
            head: ['Licznik', 'Warsztat', 'Zbieracz'],
            rows: [
              ['0', 'Produkt stoi', 'Towar pominięty'],
              ['1-100', 'Tyle partii, -1 przy starcie partii', 'Tyle sztuk, -1 za zdobytą sztukę'],
              ['∞', 'Bez końca, licznik nie spada', 'Bez końca, licznik nie spada'],
            ],
            foot: 'Warsztat liczy partie, nie sztuki. Partia daje więcej sztuk przy doświadczeniu i narzędziu: [[article:tools|Narzędzia]].',
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
              ['Mniej', '-1. Z 0 skok na ∞, z ∞ na 100', '-10', 'Na 0'],
              ['Więcej', '+1. Ze 100 skok na ∞, z ∞ na 0', '+10', 'Na ∞'],
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
                'Absolwent zawodu z kilkoma kursami, przydzielony przez Asystenta',
                'Wyroby poznane w Szkole ∞, reszta 0',
              ],
              ['Warsztat z 1 produktem', 'Ten produkt ∞'],
              ['[[job:collector|Zbieracz]]', 'Każdy towar ∞'],
            ],
          },
        },
        {
          h: 'Co dzieje się z licznikami',
        },
        {
          p: 'Przepadają przy każdej zmianie miejsca pracy lub zawodu, także po zburzeniu budynku. Rozbudowa je zostawia, a produkty dodane przez poziom dostają 0. Każdy pracownik ma własne liczniki: 2 ludzi w jednym warsztacie może robić 2 różne produkty.',
        },
        {
          h: 'Kilka produktów naraz',
        },
        {
          p: 'Produkty z licznikiem powyżej 0 idą na zmianę, po 1 partii, w kolejności z panelu.',
        },
        {
          table: {
            head: ['Sytuacja', 'Skutek'],
            rows: [
              [
                'Pełna półka produktu',
                'Kolej przechodzi dalej. Partie w toku liczą się jako zajęte miejsce.',
              ],
              ['Zero składnika w budynku', 'Kolej przechodzi dalej'],
              [
                'Część składnika w budynku',
                'Czeka na resztę składnika. Puszcza kolej, gdy reszty nie ma skąd wziąć.',
              ],
              ['Wszystkie liczniki na 0', 'Pracownik nic nie zaczyna'],
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
            'Pojazd to nie partia. Rzemieślnik stawia plac obok warsztatu, sam nosi materiał i buduje.',
            'Licznik pojazdu spada po ukończeniu pojazdu, nie na starcie.',
            'Gdy obok warsztatu nie ma miejsca na plac, kolej przechodzi na następny produkt.',
          ],
        },
        {
          h: 'Zbieracze',
        },
        {
          p: 'Ten sam panel służy Zbieraczowi. Przycisk towaru nazywa się tu "Tylko to dobro".',
        },
        {
          table: {
            head: ['Akcja', 'Skutek'],
            rows: [
              ['"Tylko to dobro"', 'Ten towar ∞, reszta 0'],
              ['Prawy klik na zasobie', '"Zbieraj": ten towar ∞, reszta 0, flaga robocza stoi, gdzie stała'],
              ['Ctrl i prawy klik na zasobie', 'To samo, a flaga idzie na zasób'],
              ['Wszystkie liczniki na 0', 'Stan "Towary na 0"'],
              ['Zbieracz z miejscem pracy', 'Do wyboru tylko towary, które budynek przechowuje'],
              ['Licznik na 0, a towar leży', 'Licznik dotyczy wydobycia. Pnie i stosy Zbieracz nosi dalej.'],
            ],
            foot: '[[job:hunter|Myśliwy]], [[job:scout|Zwiadowca]] i żołnierze nie mają liczników.',
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
      lead: 'Drzewo daje 3 sztuki Drewna po 10 ciosach nowicjusza.',
      blocks: [
        {
          h: 'Co daje zasób',
        },
        {
          table: {
            head: ['Zasób', 'Kto', 'Daje', 'Ciosy nowicjusza', 'Narzędzie'],
            rows: [
              ['Drzewo', '[[job:collector|Zbieracz]]', '3 [[good:wood|Drewna]]', '10 na drzewo', 'tak'],
              ['Skała', '[[job:collector|Zbieracz]]', '4-5 [[good:stone|Kamienia]]', '10 na sztukę', 'tak'],
              [
                'Złoże',
                '[[job:collector|Zbieracz]]',
                '5 [[good:mud|Gliny]], [[good:iron|Żelaza]] lub [[good:gold|Złota]]',
                '10 na sztukę',
                'tak',
              ],
              ['Grzyb', '[[job:collector|Zbieracz]]', '1 [[good:mushroom|Grzyb]]', '1 podniesienie', 'nie'],
              ['Pole zboża', '[[job:farmer|Farmer]]', '1 [[good:wheat|Pszenica]]', '2 na pole', 'tak'],
              [
                'Pole ziół',
                '[[job:herb_mush_guy|Zbieracz Ziół]]',
                '1 [[good:herb|Zioło]]',
                '10 na pole',
                'tak',
              ],
              ['Ławica', '[[job:fisher|Rybak]]', '1 [[good:fish|Ryba]]', '5 rzutów', 'tak'],
              ['Krzew z owocami', 'Głodny osadnik', '1 posiłek na miejscu', '1 zjedzenie', 'nie'],
            ],
          },
        },
        {
          list: [
            'Drzewo pada w całości, 3 sztuki leżą jako pień i Zbieracz nosi je po 1 sztuce.',
            'Sztuka ze skały lub złoża spada na ziemię obok złoża.',
          ],
        },
        {
          h: 'Żelazo i Złoto',
        },
        {
          table: {
            head: ['Droga', 'Warunek', 'Kogo dotyczy'],
            rows: [
              [
                'Praca',
                '10 sztuk [[good:mud|Gliny]] i [[good:stone|Kamienia]] razem',
                'Tego osadnika. Pierwszy odkrywa towar dla osady.',
              ],
              ['[[building:school|Szkoła]]', 'Kurs, gdy towar jest już odkryty', 'Absolwenta'],
            ],
            foot: 'Warunek dotyczy osobno [[good:iron|Żelaza]] i [[good:gold|Złota]], każdego osadnika z osobna. Do tego czasu towar jest w panelu "zablokowane".',
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
          table: {
            head: ['Etap', 'Co się dzieje'],
            rows: [
              ['1', 'Zasiane'],
              ['2-4', 'Każde podlanie dodaje 1 etap polu i 6 sąsiednim polom'],
              ['5', 'Dojrzałe, czeka na ścięcie'],
              ['Po ścięciu', '1 sztuka leży na ziemi, miejsce jest wolne pod siew'],
            ],
            foot: 'Pole rośnie tylko od podlewania, czas nie ma wpływu.',
          },
        },
        {
          table: {
            head: ['Budynek', 'Pola', 'Promień', 'Załoga', 'Zapas'],
            rows: [
              ['[[building:work_farm_00|Farma]]', 25, '16 kroków', '4 Farmerów, 1 Tragarz', 25],
              [
                '[[building:work_herb_hut|Chatka zielarza]]',
                25,
                '16 kroków',
                '3 Zbieraczy Ziół, 1 Tragarz',
                20,
              ],
            ],
            num: [1, 4],
            foot: 'Po skosie promień to około 11 kroków. Limit pól dotyczy budynku, więcej ludzi obraca polami szybciej.',
          },
        },
        {
          h: 'Kolejność pracy Farmera i Zbieracza Ziół',
        },
        {
          steps: [
            'Zanosi ściętą sztukę do budynku.',
            'Sieje, gdy budynek ma mniej niż 25 pól.',
            'Ścina najbliższe dojrzałe pole.',
            'Podlewa pole o najniższym etapie.',
            'Czeka w budynku.',
          ],
        },
        {
          p: 'Pole wymaga ziemi pod uprawę: piasek i droga odpadają. Dzikie pola z mapy w promieniu budynku liczą się do jego limitu.',
        },
        {
          p: 'Pole budynku, do którego przez 60 s nie ma dojścia z jego drzwi, znika i zwalnia miejsce w limicie.',
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
                '1 sztuka w budynku',
              ],
              [
                '[[building:work_hive_00|Ul]]',
                '+1 [[good:honey|Miód]] na sekundę, bez pracownika',
                '1 sztuka w budynku',
              ],
              ['Krzew z owocami', '100 s: 50 s do kwitnienia, 50 s do owoców', '1 posiłek'],
              ['Ławica', '+1 ryba co 180 s', '30 ryb'],
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
      lead: 'Narzędzie skraca ciosy i dokłada sztuk w warsztacie, a wytrzymuje 100 użyć.',
      blocks: [
        {
          h: 'Kto korzysta',
        },
        {
          table: {
            head: ['Kto', 'Co zyskuje'],
            rows: [
              ['Rzemieślnik w warsztacie', 'Więcej sztuk z partii'],
              ['[[job:collector|Zbieracz]]', 'Mniej ciosów, oprócz grzybów'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]', 'Mniej ciosów przy ścinaniu'],
              ['[[job:fisher|Rybak]]', 'Mniej rzutów'],
              ['[[job:builder|Budowniczy]]', 'Więcej punktów budowy na cios'],
              ['[[job:hunter|Myśliwy]], [[job:carrier|Tragarz]]', 'Nic'],
              ['Żołnierze, bohaterowie', 'Nie noszą narzędzi'],
            ],
          },
        },
        {
          h: 'Ciosy przy zbieraniu',
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', 10, 8, 5],
              ['20%', 9, 7, 4],
              ['40%', 8, 6, 3],
              ['60%', 7, 5, 2],
              ['80%', 6, 4, 1],
              ['100%', 5, 3, 1],
            ],
            num: [1, 2, 3],
            foot: 'Zasób za 10 ciosów: drzewo, skała, złoże, pole ziół.',
          },
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', 5, 4, 2],
              ['20%', 4, 3, 1],
              ['40%', 3, 2, 1],
              ['60%', 2, 1, 1],
              ['80-100%', 1, 1, 1],
            ],
            num: [1, 2, 3],
            foot: 'Połów, 5 rzutów na rybę.',
          },
        },
        {
          p: '[[good:wheat|Pszenica]] kosztuje 2 ciosy na pole bez narzędzia i 1 cios z narzędziem lub od 20% doświadczenia.',
        },
        {
          h: 'Sztuki z partii w warsztacie',
        },
        {
          table: {
            head: ['Doświadczenie', 'Bez narzędzia', 'Drewniane', 'Żelazne'],
            rows: [
              ['0%', '1,0', '1,2', '1,7'],
              ['20%', '1,3', '1,5', '2,0'],
              ['40%', '1,6', '1,8', '2,3'],
              ['60%', '1,9', '2,1', '2,6'],
              ['80%', '2,2', '2,4', '2,9'],
              ['100%', '2,5', '2,7', '3,2'],
            ],
            num: [1, 2, 3],
            foot: 'Dla przepisu dającego 1 sztukę. Przepis na 2 sztuki: premia ×2. Składniki i czas partii zostają takie same. Doświadczenie działa też na towary z uboju.',
          },
        },
        {
          p: 'Ułamki zbierają się w warsztacie. Pełna sztuka trafia na półkę, także ponad pojemność.',
        },
        {
          h: 'Zużycie',
        },
        {
          table: {
            head: ['Praca', 'Użycie narzędzia'],
            rows: [
              ['Partia w warsztacie', '1 za ukończoną partię'],
              ['Cios przy zbieraniu', '1 za cios, także niekończący sztuki'],
              ['Rzut wędką', '1 za rzut, także nieudany'],
              ['Cios Budowniczego', '1 za cios, także przy naprawie i gdy cios nic nie dodał'],
              ['Podlewanie', '1 za podlanie'],
              ['Sianie, podnoszenie grzybów', '0'],
            ],
            foot: 'Po 100 użyciach narzędzie znika, osadnik pracuje gołymi rękami do czasu nowego.',
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
      lead: 'Tragarz bez wózka nosi 1 sztukę, a na ziemi leży do 5 sztuk jednego towaru w jednym miejscu.',
      blocks: [
        {
          h: 'Pojemność',
        },
        {
          table: {
            head: ['Budynek', 'Sztuk jednego towaru'],
            rows: [
              ['[[building:stock_00|Magazyn 1]]', 45],
              ['[[building:stock_01|Magazyn 2]]', 70],
              ['[[building:stock_02|Magazyn 3]]', 120],
              ['[[building:headquarters|Kwatera główna]]', 150],
            ],
            num: [1],
            foot: 'Każdy z tych budynków przyjmuje po 3 [[job:carrier|Tragarzy]], Zbieraczy, Rybaków i Myśliwych.',
          },
        },
        {
          h: 'Priorytet i minimum',
        },
        {
          table: {
            head: ['Cecha', 'Priorytet', 'Minimum w magazynach'],
            rows: [
              [
                'Dotyczy',
                'Jednego budynku: magazynu, Kwatery głównej, Koszar, wieży',
                'Wszystkich magazynów gracza i Kwatery głównej razem',
              ],
              ['Kto zwozi', 'Tragarze tego budynku', 'Tragarze magazynów, Kwatery głównej, Studni i Uli'],
              ['Skąd', 'Inne magazyny, wyroby warsztatów, stosy', 'Wyroby warsztatów, Studnie, Ule, stosy'],
              ['Do kiedy', 'Dopóki budynek ma miejsce', 'Dopóki suma jest poniżej minimum'],
              ['Limit', 'Pojemność budynku', '999 sztuk towaru'],
              ['Blokada', 'Brak', 'Nikt nie weźmie towaru z magazynu poniżej minimum'],
            ],
            foot: 'Magazyn oddaje towar magazynowi z priorytetem tylko ponad minimum.',
          },
        },
        {
          p: 'Minimum obowiązuje też przy jedzeniu. Gdy całe jedzenie mieści się w minimum, nikt nie zje z magazynu.',
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
            head: ['Tragarz', 'Sztuk na kurs', 'Utrata szybkości, pełny'],
            rows: [
              ['Bez wozu', 1, '-'],
              ['Z [[good:handcart|Wózkiem Ręcznym]]', 15, '60%'],
              ['Z [[good:oxcart|Zaprzęgiem]]', 30, '15%'],
            ],
            num: [1, 2],
            foot: 'Utrata szybkości rośnie z ładunkiem. Wozy [[job:trader|Kupca]] mają te same liczby.',
          },
        },
        {
          list: [
            'Wóz bierze tylko Tragarz z miejscem pracy i [[job:trader|Kupiec]]. Tragarz zachowuje miejsce pracy, a wóz traktuje jak narzędzie.',
            'Wóz musi być własny i wolny: bez załogi, bez innego woźnicy, na tym samym lądzie.',
            'Tragarz magazynu z miejscem na wozie dobiera ten sam towar ze stosów i gotowych wyrobów do 12 kroków od siebie, potem wraca.',
            'Po utracie miejsca pracy wóz zostaje na miejscu.',
          ],
        },
        {
          h: 'Stosy na ziemi',
        },
        {
          list: [
            'W jednym miejscu leży 1 towar, do 5 sztuk.',
            'Stos nie ma właściciela, bierze każdy.',
            'Tragarz bez flagi roboczej podnosi do 32 kroków od budynku, z flagą do 32 kroków od flagi.',
          ],
        },
        {
          h: 'Zasięg pracy',
        },
        {
          table: {
            head: ['Kto', 'Skąd liczony', 'Poziomo, pionowo', 'Po skosie'],
            rows: [
              ['[[job:collector|Zbieracz]]', 'Flaga robocza', '32', 'około 21'],
              ['Tragarz', 'Flaga robocza lub budynek', '32', 'około 21'],
              ['[[job:hunter|Myśliwy]]', 'Flaga robocza', '50', '50'],
              ['[[job:fisher|Rybak]]', 'Flaga robocza', '20', 'około 13'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]', 'Budynek', '16', 'około 11'],
            ],
            num: [2, 3],
            foot: 'W krokach. Obszar pracy kończy się na zasięgu drogowskazów, gdy zawód mu podlega.',
          },
        },
        {
          p: 'Flagi roboczej nie przyjmuje Tragarz Farmy, Chatki zielarza, Studni, Ula, wieży ani Koszar.',
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
      lead: 'Flaga wyznacza obszar pracy i nic nie przechowuje. Zbieracz bez miejsca pracy zostawia towar na ziemi.',
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
              ['Tragarz', 'Magazyn: stosy do 32 kroków od budynku'],
              ['Myśliwy', 'Wokół miejsca pracy'],
              ['Rybak', 'Szuka brzegu od miejsca, w którym stoi'],
            ],
            foot: 'Obszar z flagą: tabela "Zasięg pracy" w [[article:hauling|Tragarzach i magazynach]].',
          },
        },
        {
          h: 'Stos przy fladze',
        },
        {
          list: [
            'Towar spod flagi nie trafi do magazynu sam. Potrzebny jest Tragarz z miejscem pracy.',
            'Tragarz magazynu sięga do 32 kroków od budynku. Dalej daj mu własną flagę przy fladze Zbieracza.',
            'Tragarz z flagą bierze stosy i gotowe wyroby wokół niej i niesie je do swojego budynku.',
            'Przeniesienie flagi nie rusza stosów, zostają na miejscu.',
          ],
        },
        {
          h: 'Przyciski',
        },
        {
          table: {
            head: ['Przycisk', 'Skutek'],
            rows: [
              [
                '"Wbij chorągiewkę"',
                'Stawia flagę we wskazanym miejscu albo ją tam przenosi. Na zajętym polu szuka miejsca do 6 kroków, dalej rozkaz przepada.',
              ],
              ['"Zabierz chorągiewkę"', 'Tylko z miejscem pracy, usuwa flagę'],
              ['"Pokaż obszar roboczy"', 'Włącza okrąg obszaru. Działa, gdy flaga stoi.'],
              ['"Pokaż chorągiewkę"', 'Centruje widok na fladze'],
            ],
            foot: 'Ctrl i prawy klik też przenosi flagę zaznaczonego pracownika.',
          },
        },
        {
          p: 'Zbieracz przenosi flagę sam, gdy włączony jest przełącznik w [[article:assistant|Asystencie]]: 6-10 kroków od zasobu, a po wyczerpaniu obszaru do zasobu najbliżej własnego budynku. Flagi Myśliwego i Rybaka stoją.',
        },
        {
          h: 'Flaga poza zasięgiem drogowskazów',
        },
        {
          p: 'Flagę wolno wbić poza zasięgiem. Pracownik od razu dostaje stan "Zgubił się" i stoi, aż sieć tam dotrze. Myśliwego to nie dotyczy: [[article:roads|Drogi i drogowskazy]].',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: 'Drogi i drogowskazy',
      lead: 'Droga kosztuje 1 Kamień i skraca krok w butach na lądzie z 0,5 s do 0,33 s.',
      blocks: [
        {
          h: 'Drogowskaz',
        },
        {
          p: 'Drogowskaz stawia [[job:scout|Zwiadowca]], bez materiału. Sieć drogowskazów należy do jednego gracza.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Zasięg sieci',
          },
        },
        {
          table: {
            head: ['Zasięg, kroki', 'Osadnik', '[[job:carrier|Tragarz]]', 'Uwagi'],
            rows: [
              ['Chód', '50', '63', 'Od miejsca, w którym stoi'],
              ['Od osadnika do drogowskazu', 'mniej niż 50', 'mniej niż 63', 'Otwiera całą połączoną sieć'],
              ['Od drogowskazu do celu', 'mniej niż 50', 'mniej niż 63', 'Od każdego drogowskazu tej sieci'],
              [
                'Połączenie dwóch drogowskazów',
                'mniej niż 40',
                'mniej niż 40',
                'Trasa między nimi do 80 kroków',
              ],
              ['Odstęp od własnego drogowskazu', 'co najmniej 16', 'co najmniej 16', 'Bliżej nie stanie'],
              ['Szukanie towaru', 'mniej niż 40', 'mniej niż 40', 'Także od drogowskazów w tym zasięgu'],
              ['Budynek na drogowskazie', '16', '16', 'Drogowskaz odsuwa się, dalej przepada'],
            ],
            num: [1, 2],
          },
        },
        {
          table: {
            head: ['Teren', 'Szukanie towaru, kroki'],
            rows: [
              ['Droga, ląd', 'mniej niż 40'],
              ['Piasek', 'około 26'],
              ['Góry', 'około 20'],
              ['Śnieg', 'około 16'],
            ],
            num: [1],
          },
        },
        {
          p: 'Zasięg nie dotyczy Zwiadowcy, żołnierzy, bohaterów, [[job:hunter|Myśliwego]] i [[job:druid|Druida]].',
        },
        {
          p: 'Pracownik z miejscem pracy lub flagą roboczą poza zasięgiem stoi bezczynnie, aż sieć tam dotrze. Niesiony towar i tak odnosi.',
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
              ['"Drogowskazy: N"', 'Liczba połączonych drogowskazów, razem z tym'],
              ['"Wyburz"', 'Drogowskaz znika od razu, bez potwierdzenia i bez Zwiadowcy'],
              ['Sąsiednie drogowskazy', 'Tracą połączenie z wyburzonym'],
              ['Sieć', 'Rozpada się na części, gdy wyburzony drogowskaz był jedynym łącznikiem'],
              ['Pracownicy poza nowym zasięgiem', 'Stan "Zgubił się", stoją, aż sieć wróci'],
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
              ['Ląd', '0,50 s', '0,33 s', '33%'],
              ['Piasek', '0,67 s', '0,33 s', '50%'],
              ['Góry', '0,83 s', '0,33 s', '60%'],
              ['Śnieg', '1,00 s', '0,33 s', '67%'],
            ],
            num: [1, 2, 3],
            foot: 'Osadnik w butach, bez ładunku. Buty na drodze zużywają się 2 razy wolniej niż na lądzie.',
          },
        },
        {
          list: [
            'Odcinek kosztuje 1 [[good:stone|Kamień]] i 1 cios [[job:builder|Budowniczego]], po budynkach i palisadach.',
            'Kamień kładzie też do 6 sąsiednich odcinków, do których nikt nie idzie i na których nie ma kamienia.',
            'Anulowanie odcinka: dostarczony Kamień ląduje obok.',
            'Rozbudowa budynku na drodze: droga znika, Kamień nie wraca.',
            'Trasy osadników wybierają drogę same, gdy wychodzi taniej.',
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
      lead: 'Krok na lądzie trwa 0,5 s w butach i 0,67 s boso.',
      blocks: [
        {
          h: 'Krok według terenu',
        },
        {
          table: {
            head: ['Teren', 'W butach', 'Boso', 'Kroków z pary butów'],
            rows: [
              ['Droga, bruk', '0,33 s', '0,50 s', 10000],
              ['Ląd', '0,50 s', '0,67 s', 5000],
              ['Piasek, plaża, kamienista pustynia', '0,67 s', '0,83 s', 3334],
              ['Góry', '0,83 s', '1,00 s', 2500],
              ['Śnieg', '1,00 s', '1,17 s', 2000],
            ],
            num: [1, 2, 3],
            foot: 'Z ładunkiem w rękach buty zużywają się 2 razy szybciej. Energia za bosy krok: [[article:needs|Potrzeby]].',
          },
        },
        {
          h: 'Co zmienia krok',
        },
        {
          table: {
            head: ['Stan', 'Zmiana'],
            rows: [
              ['Ładunek w rękach', '+0,08 s'],
              ['Wytrzymałość do 20%', '+0,17 s'],
              ['Dziecko', '+0,17 s'],
              ['Niemowlę', 'krok × 2'],
              ['Ciężar broni i pancerza 2-3, bez bohaterów', '+0,08 s'],
              ['Ciężar broni i pancerza 4-5, bez bohaterów', '+0,17 s'],
              ['[[good:amulet_speed|Amulet Wiatru]]', '-0,17 s'],
              ['Egipcjanin', '-0,17 s'],
              ['Pełny [[good:handcart|Wózek Ręczny]]', '60% wolniej'],
              ['Pełny [[good:oxcart|Zaprzęg]]', '15% wolniej'],
            ],
            foot: 'Najszybszy krok trwa 0,25 s. Spowolnienie przy wozach rośnie z ładunkiem.',
          },
        },
        {
          h: 'Ciężar broni i pancerza',
        },
        {
          table: {
            head: ['Broń', 'Ciężar'],
            rows: [
              ['[[good:sword_shord|Krótki Miecz]], [[good:bow_short|Krótki Łuk]]', 0],
              ['[[good:spear_wooden|Drewniana Włócznia]], [[good:bow_long|Długi Łuk]]', 1],
              ['[[good:spear_iron|Żelazna Włócznia]], [[good:sword_long|Długi Miecz]]', 2],
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
              ['Tragarz, w butach, z towarem', 'Droga', '0,42 s'],
              ['Żołnierz, Długi Miecz, Zbroja Płytowa, w butach', 'Ląd', '0,67 s'],
              ['Kupiec, w butach, pełny Wózek Ręczny', 'Ląd', '1,25 s'],
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
      lead: 'Kupiec jeździ między 2 budynkami i bez wozu bierze 1 sztukę na kurs.',
      blocks: [
        {
          h: 'Czym wozi',
        },
        {
          table: {
            head: ['Ładownia', 'Podniesienie sztuki'],
            rows: [
              ['Ręce', '1,7 s'],
              ['[[good:handcart|Wózek Ręczny]]', '1,0 s'],
              ['[[good:oxcart|Zaprzęg]]', '2,2 s'],
            ],
            num: [1],
            foot: 'Czas podniesienia dotyczy też rozładunku. Pojemność i utrata szybkości: [[article:hauling|Tragarze i magazyny]].',
          },
        },
        {
          p: 'Przy 20-30 krokach w jedną stronę oba wozy przewożą tyle samo towaru w czasie. Krócej wygrywa Wózek Ręczny, dalej Zaprzęg.',
        },
        {
          h: 'Trasa',
        },
        {
          list: [
            'Trasa ma 2 gotowe budynki. Własny może być każdy budynek z zapasami, obcy najwyżej 1.',
            'Gdy budynek jest w rozbudowie, [[job:trader|Kupiec]] czeka na jej koniec.',
            'Z Domu Kupiec nie zabiera jedzenia.',
          ],
        },
        {
          h: 'Własne budynki',
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
                'Ładuje z całej osady: magazyn, potem magazyny i warsztaty w zasięgu jego sieci drogowskazów',
              ],
            ],
            foot: 'A i B to dwa budynki trasy. Opcja osada działa tylko dla magazynu lub Kwatery głównej, na jednym punkcie trasy. Minimum w magazynach też ogranicza załadunek.',
          },
        },
        {
          h: 'Handel z komputerem',
        },
        {
          list: [
            'Obcy budynek należy do gracza komputerowego, jest gotowy i ma ofertę zapisaną przez mapę.',
            'Dodanie do trasy wymaga stosunku przyjaznego po obu stronach, każdy kurs tylko po stronie plemienia Kupca: [[article:diplomacy|Dyplomacja]].',
            'Oferta to N sztuk jednego towaru za M sztuk drugiego, liczby ustala mapa. Trasa handluje jedną ofertą naraz. Magazyn komputera wraca do 5 sztuk towaru z oferty co 30 s.',
            'Kupiec bierze tyle pełnych partii, ile mieści ładownia z miejscem na towar powrotny. Przy małej ładowni partia dzieli się na kilka kursów.',
            'Oddaje partię, bierze zapłatę i powtarza, dopóki ma towar. Bez zapłaty w budynku czeka i nie oddaje towaru. "zostaw N" zostawia w budynku N sztuk towaru na sprzedaż. Limit powrotu N: stop, gdy budynek ma N sztuk zapłaty.',
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
