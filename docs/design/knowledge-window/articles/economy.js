export const GROUP = {
  group: 'Gospodarka',
  items: [
    {
      id: 'construction',
      name: 'Budowa, rozbudowa, naprawa',
      lead: 'Sztuka materiału to 30 punktów budowy, a jeden cios daje 1-4 punkty.',
      blocks: [
        { h: 'Ile trwa budowa' },
        {
          table: {
            head: ['[[building:home_level_00|Dom 1]], 1 Budowniczy', 'Punkty na cios', 'Ciosy', 'Czas'],
            rows: [
              ['Nowicjusz, bez narzędzia', 1, 120, '150 s'],
              ['Nowicjusz, [[good:tool_iron|Żelazne Narzędzie]]', 2, 60, '75 s'],
              ['Mistrz, [[good:tool_iron|Żelazne Narzędzie]]', 4, 30, '37,5 s'],
            ],
            num: [1, 2, 3],
            foot: 'Dom 1 to 4 sztuki materiału, 120 punktów budowy. Czas samych ciosów, bez noszenia materiału. 1 cios trwa 1,25 s.',
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
        { h: 'Kolejność pracy Budowniczego' },
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
        { h: 'Rozbudowa' },
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
        { h: 'Naprawa' },
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
        { h: 'Co przepada, a co wraca' },
        {
          table: {
            head: ['Sytuacja', 'Skutek'],
            rows: [
              ['Cios ponad dostarczony materiał', 'Nadmiar punktów przepada, narzędzie zużywa się tak samo'],
              ['Materiał na placu', 'Znika z zapasu przy ukończeniu, wcześniej leży na placu'],
              ['Zdrowie placu', 'Rośnie razem z postępem, nowy plac ma 1 zdrowia'],
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
      id: 'gathering',
      name: 'Zbieranie i uprawa',
      lead: 'Drzewo daje 3 sztuki Drewna po 10 ciosach nowicjusza.',
      blocks: [
        { h: 'Co daje zasób' },
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
              ['Ławica', '[[job:fisher|Rybak]]', '1 [[good:bread|Żywność]]', '5 rzutów', 'tak'],
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
        { h: 'Pole' },
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
            foot: 'Promień 16 kroków poziomo lub pionowo, około 11 po skosie. Limit pól dotyczy budynku, więcej ludzi obraca polami szybciej.',
          },
        },
        { h: 'Kolejność pracy Farmera i Zbieracza Ziół' },
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
        { h: 'Co odrasta' },
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
            foot: 'Pełna ławica co 180 s oddaje 1 rybę najbliższej niepełnej ławicy na tej samej wodzie, bliżej niż 16 kroków. Pusta ławica rośnie tylko od takiej ryby.',
          },
        },
      ],
      see: [
        'article:tools',
        'article:hauling',
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
        { h: 'Kto korzysta' },
        {
          table: {
            head: ['Kto', 'Mniej ciosów', 'Więcej towaru'],
            rows: [
              ['Rzemieślnik w warsztacie', '-', 'tak'],
              ['[[job:collector|Zbieracz]]', 'tak, oprócz grzybów', 'nie'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Zbieracz Ziół]]', 'tak, przy ścinaniu', 'nie'],
              ['[[job:fisher|Rybak]]', 'tak', 'nie'],
              ['[[job:builder|Budowniczy]]', 'więcej punktów budowy na cios', 'nie'],
              ['[[job:hunter|Myśliwy]], [[job:carrier|Tragarz]]', 'nie', 'nie'],
              ['Żołnierze, bohaterowie', 'Nie noszą narzędzi', '-'],
            ],
          },
        },
        { h: 'Ciosy przy zbieraniu' },
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
        { h: 'Sztuki z partii w warsztacie' },
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
            foot: 'Dla przepisu dającego 1 sztukę, przy przepisie na więcej sztuk premia rośnie tyle samo razy. Składniki i czas partii zostają takie same. Doświadczenie działa też na towary z uboju.',
          },
        },
        { p: 'Ułamki zbierają się w warsztacie. Pełna sztuka trafia na półkę, także ponad pojemność.' },
        { h: 'Zużycie' },
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
        { h: 'Pojemność' },
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
        { h: 'Kolejność pracy Tragarza w magazynie' },
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
        { h: 'Priorytet i minimum' },
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
        { h: 'Stosy na ziemi' },
        {
          list: [
            'W jednym miejscu leży 1 towar, do 5 sztuk.',
            'Stos nie ma właściciela, bierze każdy.',
            'Tragarz bez flagi roboczej podnosi do 32 kroków od budynku, z flagą do 32 kroków od flagi.',
          ],
        },
        { h: 'Zasięg pracy' },
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
        { p: 'Flagi roboczej nie przyjmuje Tragarz Farmy, Chatki zielarza, Studni, Ula, wieży ani Koszar.' },
      ],
      see: ['article:roads', 'article:vehicles', 'article:construction', 'job:carrier', 'building:stock_00'],
    },
    {
      id: 'roads',
      name: 'Drogi i drogowskazy',
      lead: 'Droga kosztuje 1 Kamień i skraca krok w butach na lądzie z 0,5 s do 0,33 s.',
      blocks: [
        { h: 'Droga' },
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
        { h: 'Drogowskaz' },
        {
          p: 'Drogowskaz stawia [[job:scout|Zwiadowca]], bez materiału. Sieć drogowskazów należy do jednego gracza.',
        },
        {
          table: {
            head: ['Zasięg', 'Kroki', 'Uwagi'],
            rows: [
              ['Chód osadnika', 50, 'Od miejsca, w którym stoi'],
              ['Chód [[job:carrier|Tragarza]]', 63, 'Od miejsca, w którym stoi'],
              ['Od osadnika do drogowskazu', 'mniej niż 50 lub 63', 'Otwiera całą połączoną sieć'],
              ['Od drogowskazu do celu', 'mniej niż 50 lub 63', 'Od każdego drogowskazu tej sieci'],
              ['Połączenie dwóch drogowskazów', 'mniej niż 40', 'Trasa między nimi do 80 kroków'],
              ['Odstęp od własnego drogowskazu', 'co najmniej 16', 'Bliżej nie stanie'],
              ['Szukanie towaru', 'mniej niż 40', 'Także od drogowskazów w tym zasięgu'],
              ['Budynek na drogowskazie', '16', 'Drogowskaz odsuwa się, dalej przepada'],
            ],
            num: [1],
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
      ],
      see: ['article:walking', 'article:hauling', 'article:construction', 'job:scout', 'good:stone'],
    },
    {
      id: 'walking',
      name: 'Szybkość chodu',
      lead: 'Krok na lądzie trwa 0,5 s w butach i 0,67 s boso.',
      blocks: [
        { h: 'Krok według terenu' },
        {
          table: {
            head: ['Teren', 'W butach', 'Boso', 'Kroków z pary butów', 'Energia na krok boso'],
            rows: [
              ['Droga, bruk', '0,33 s', '0,50 s', 10000, '0,01%'],
              ['Ląd', '0,50 s', '0,67 s', 5000, '0,02%'],
              ['Piasek, plaża, kamienista pustynia', '0,67 s', '0,83 s', 3334, '0,03%'],
              ['Góry', '0,83 s', '1,00 s', 2500, '0,04%'],
              ['Śnieg', '1,00 s', '1,17 s', 2000, '0,05%'],
            ],
            num: [1, 2, 3, 4],
            foot: 'Z ładunkiem w rękach buty zużywają się 2 razy szybciej, a bosy krok zabiera 2 razy więcej Energii.',
          },
        },
        { h: 'Co zmienia krok' },
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
              ['Pełny [[good:handcart|Wózek Ręczny]]', 'krok × 2,5'],
              ['Pełny [[good:oxcart|Zaprzęg]]', 'krok × 1,18'],
            ],
            foot: 'Najkrótszy krok trwa 0,25 s. Wydłużenie przy wozach rośnie z ładunkiem.',
          },
        },
        { h: 'Ciężar broni i pancerza' },
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
        { data: 'armour' },
        { h: 'Przykłady' },
        {
          table: {
            head: ['Kto', 'Teren', 'Krok'],
            rows: [
              ['Tragarz, boso, z towarem', 'Ląd', '0,75 s'],
              ['Tragarz, w butach, z towarem', 'Droga', '0,42 s'],
              ['Żołnierz, Długi Miecz, Zbroja Płytowa, w butach', 'Ląd', '0,67 s'],
              ['Zmęczony, boso, z towarem', 'Góry', '1,25 s'],
              ['Kupiec, w butach, pełny Wózek Ręczny', 'Ląd', '1,25 s'],
              ['Kupiec, w butach, pełny Zaprzęg', 'Ląd', '0,58 s'],
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
        { h: 'Czym wozi' },
        {
          table: {
            head: ['Ładownia', 'Sztuk na kurs', 'Utrata szybkości, pełny', 'Podniesienie sztuki'],
            rows: [
              ['Ręce', 1, '-', '1,7 s'],
              ['[[good:handcart|Wózek Ręczny]]', 15, '60%', '1,0 s'],
              ['[[good:oxcart|Zaprzęg]]', 30, '15%', '2,2 s'],
            ],
            num: [1, 2, 3],
            foot: 'Utrata szybkości rośnie z ładunkiem. Czas podniesienia dotyczy też rozładunku.',
          },
        },
        {
          p: 'Przy 20-30 krokach w jedną stronę oba wozy przewożą tyle samo towaru w czasie. Krócej wygrywa Wózek Ręczny, dalej Zaprzęg.',
        },
        { h: 'Trasa' },
        {
          list: [
            'Trasa ma 2 gotowe budynki. Własny może być każdy budynek z zapasami, obcy najwyżej 1.',
            'Gdy budynek jest w rozbudowie, [[job:trader|Kupiec]] czeka na jej koniec.',
            'Z Domu Kupiec nie zabiera jedzenia.',
          ],
        },
        { h: 'Własne budynki' },
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
            foot: 'Opcja osada działa tylko dla magazynu lub Kwatery głównej, na jednym punkcie trasy. Minimum w magazynach też ogranicza załadunek.',
          },
        },
        { h: 'Handel z komputerem' },
        {
          list: [
            'Obcy budynek należy do gracza komputerowego, jest gotowy i ma ofertę zapisaną przez mapę.',
            'Dodanie do trasy wymaga stosunku przyjaznego po obu stronach, każdy kurs tylko po stronie plemienia Kupca: [[article:diplomacy|Dyplomacja]].',
            'Oferta to N sztuk jednego towaru za M sztuk drugiego, liczby ustala mapa. Trasa handluje jedną ofertą naraz.',
            'Kupiec bierze tyle pełnych partii, ile mieści ładownia z miejscem na towar powrotny. Przy małej ładowni partia dzieli się na kilka kursów.',
            'Oddaje partię, bierze zapłatę i powtarza, dopóki ma towar. Bez zapłaty w budynku czeka i nie oddaje towaru.',
            'Magazyn komputera wraca do 5 sztuk towaru z oferty co 30 s.',
            '"zostaw N" zostawia w budynku N sztuk towaru na sprzedaż.',
            'Limit powrotu: nowa partia nie rusza, gdy w budynku jest już tyle towaru z zapłaty.',
            'Oferta na posiłek przyjmuje każde danie tej samej klasy.',
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
