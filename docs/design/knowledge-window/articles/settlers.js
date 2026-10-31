export const GROUP = {
  group: 'Osadnicy',
  items: [
    {
      id: 'needs',
      name: 'Potrzeby',
      lead: 'Przy 20% paska osadnik rzuca pracę i idzie uzupełnić potrzebę.',
      blocks: [
        { h: 'Paski' },
        {
          table: {
            head: ['Pasek', 'Spada sam', 'Spada przy pracy', 'Uzupełnia', 'Przy 0%'],
            rows: [
              ['Energia', '100% w 15 min', 'tak', '[[article:food|posiłek]]', 'traci 24 zdrowia na sekundę'],
              ['Wytrzymałość', '100% w 15 min', 'tak', 'sen', 'zdrowie bez zmian'],
              ['Towarzystwo', '100% w 15 min', 'nie', 'rozmowa', 'bez kary'],
              [
                'Religia',
                'nie',
                'tylko broń i zbroje',
                '[[article:religion|modlitwa]]',
                'nie zacznie partii, która kosztuje Religię',
              ],
            ],
            foot: 'Na starcie mapy każdy pasek ma losowo 50-100%.',
          },
        },
        { h: 'Progi' },
        {
          table: {
            head: ['Poziom', 'Co się dzieje'],
            rows: [
              ['150%', 'Górna granica. Posiłek w domu i sen na Meblach odkładają zapas ponad 100%.'],
              ['80%', 'Osadnik w domu dopełnia Wytrzymałość, potem Energię do tego poziomu i wychodzi.'],
              ['20%', 'Kończy czynność i rzuca pracę. Przy Wytrzymałości krok jest dłuższy o 0,17 s.'],
              ['10%', 'Powiadomienie o Energii, Wytrzymałości lub Religii.'],
            ],
            foot: 'Sami idą się modlić [[job:armorer|Płatnerz]] i [[job:smith|Kowal]]. [[job:sewer|Krawiec]] zużywa Religię, ale modli się tylko na rozkaz.',
          },
        },
        { h: 'Co osadnik robi najpierw' },
        {
          steps: [
            'Alarm: schronienie.',
            '[[article:draughts|Napoje i amulety]], w miejscu.',
            'Energia: jedzenie.',
            'Wytrzymałość: sen.',
            'Religia: modlitwa.',
            'Rozkazy gracza: Koszary, wyposażenie, wieża.',
            'Towarzystwo: rozmowa.',
            'Praca.',
          ],
        },
        {
          p: 'Gdy nie ma czego zjeść ani gdzie się modlić, osadnik wraca do pracy, a pasek spada dalej. Bez domu w zasięgu 50 kroków śpi na otwartym terenie.',
        },
        {
          p: 'Żołnierz w walce je tylko to, co niesie, albo z zapasu wieży. Rozkaz jedzenia przerywa walkę.',
        },
        { h: 'Ile kosztuje praca' },
        {
          table: {
            head: ['Czynność', 'Czas', 'Energia', 'Wytrzymałość'],
            rows: [
              ['Cios [[job:builder|Budowniczego]]', '1,25 s', '-1%', '-0,5%'],
              ['Cios [[job:collector|Zbieracza]] w drzewo', '2,5 s', '-1%', '-0,5%'],
              ['Oprawianie truchła przez [[job:hunter|Myśliwego]]', '2,9 s', '-5%', '-0,5%'],
              ['Wyciągnięcie Wody ze [[building:work_well_00|Studni]]', '4,2 s', '-5%', '-2,5%'],
              ['Partia w warsztacie', 'wg wyrobu', '-1%', '-0,5% lub -1%'],
              ['Cios żołnierza', 'wg broni', '-0,2%', '-0,2%'],
            ],
            num: [1, 2, 3],
            foot: 'Wytrzymałość w tabeli to już połowa, bo praca idzie poza domem. Żołnierz, [[job:trader|Kupiec]] i [[job:scout|Zwiadowca]] płacą całość.',
          },
        },
        {
          p: 'Bez [[good:shoes|Butów]] każdy krok zabiera 0,01-0,05% Energii zależnie od podłoża, z ładunkiem dwa razy tyle.',
        },
        { h: 'Sen' },
        {
          table: {
            head: ['Kto', 'Czas snu', 'Poza domem', 'W domu', 'W domu z Meblami'],
            rows: [
              ['Mężczyzna z domem', '19,8 s', '+40%', '+80%', '+160%'],
              ['[[job:woman|Kobieta]]', '8,3 s', '+20%', '+40%', '+80%'],
              ['Kupiec, Zwiadowca', '19,8 s', '+80%', '-', '-'],
              ['Żołnierz', '19,8 s', '+160%', '-', '-'],
            ],
            num: [1, 2, 3, 4],
          },
        },
        { h: 'Religia i Towarzystwo' },
        {
          table: {
            head: ['Czynność', 'Czas', 'Daje'],
            rows: [
              [
                'Modlitwa',
                '8,3 s',
                '+40% Religii. Powtarza do 100%, chyba że Energia lub Wytrzymałość spadnie do 20%.',
              ],
              ['Rozmowa', '8,3-20,6 s', 'Do +40% Towarzystwa.'],
              ['Dopełnianie pasków w domu, w małżeństwie', '-', 'Towarzystwo 100%.'],
            ],
            num: [1],
          },
        },
        { h: 'Kto nie ma pasków' },
        {
          table: {
            head: ['Kto', 'Paski'],
            rows: [
              ['Niemowlę, dziecko', 'Brak. Dorosły zaczyna ze 100% na każdym pasku.'],
              ['[[article:heroes|Bohater]]', 'Brak.'],
              ['Potwory, zwierzęta', 'Brak.'],
              ['Żołnierz', 'Bez Towarzystwa.'],
              ['Pasażer wózka', 'Paski i zdrowie stoją.'],
              ['Pasażer statku', 'Je z ładowni, śpi jak poza domem, rozmawia. Religia czeka na ląd.'],
            ],
          },
        },
      ],
      see: ['article:food', 'article:health', 'article:draughts', 'article:religion', 'article:walking'],
    },
    {
      id: 'food',
      name: 'Jedzenie',
      lead: 'Ten sam posiłek w domu daje dwa razy więcej Energii.',
      blocks: [
        { h: 'Co daje posiłek' },
        {
          table: {
            head: ['Posiłek', 'Energia poza domem', 'Energia w domu', 'Towarzystwo'],
            rows: [
              ['[[good:bread|Żywność]]', '+40%', '+80%', '-'],
              ['[[good:candy|Ciastko]]', '+60%', '+120%', '+40%'],
              ['Owoc z krzewu', '+40%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: 'Posiłek trwa 4,2 s i zjada 1 sztukę. Żołnierz nie je w domu, a Ciastko daje mu tyle co Żywność: +40%.',
          },
        },
        { h: 'Skąd jest jedzenie' },
        {
          table: {
            head: ['Towar', 'Skąd', 'W magazynie i spiżarni'],
            rows: [
              [
                '[[good:bread|Chleb]]',
                '[[building:work_bakery_00|Piekarnia 1]], [[building:work_bakery_01|Piekarnia 2]]',
                'Żywność',
              ],
              ['[[good:candy|Ciastko]]', '[[building:work_bakery_01|Piekarnia 2]]', 'Ciastko'],
              [
                '[[good:meat|Mięso]]',
                '[[building:work_animal_farm|Ferma bydła]], [[job:hunter|Myśliwy]]',
                'Żywność',
              ],
              ['[[good:fish|Ryba]]', '[[job:fisher|Rybak]]', 'Żywność'],
              ['[[good:fruit|Owoc]]', 'dojrzały krzew', 'Zjadany na miejscu, krzew zostaje pusty.'],
            ],
            foot: 'Osadnik je też z półki warsztatu. W magazynie bierze najpierw Żywność, Ciastko dopiero bez Żywności.',
          },
        },
        { h: 'Gdzie je osadnik' },
        {
          steps: [
            'Własna spiżarnia, gdy drzwi domu są najwyżej 50 kroków dalej.',
            'Najbliższy magazyn, warsztat lub stos na ziemi w zasięgu 40 kroków, albo dojrzały krzew bliżej niż 10 kroków.',
            'Najbliższy dojrzały krzew w zasięgu 40 kroków.',
            'Najbliższe jedzenie gdziekolwiek w zasięgu chodu, także daleki własny dom.',
          ],
        },
        {
          p: 'Spiżarnie innych rodzin i zapasy innych graczy są zamknięte, krzew jest niczyj. [[article:roads|Drogowskazy]] rozszerzają te zasięgi. Zapasu poniżej [[article:hauling|minimum magazynu]] nikt nie zje ani nie zaniesie do domu.',
        },
        { h: 'Dostawa do spiżarni' },
        {
          steps: [
            '[[job:woman|Kobieta]] z gotowym domem szuka najbliższego jedzenia poza domami.',
            'Niesie 1 sztukę do domu, spiżarnia przyjmuje ją jako Żywność albo Ciastko.',
            'Z [[good:crockery|Naczyniami]] w domu 1 dostarczona sztuka daje 2 sztuki w spiżarni.',
          ],
        },
        {
          p: 'Kobieta bez innego zajęcia dostarcza, dopóki spiżarnia nie jest pełna. Limity spiżarni: [[article:family|Rodzina i dom]].',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: 'Zdrowie i leczenie',
      lead: 'Człowiek ma 5000 zdrowia, a pełne zdrowie wraca samo w 7 minut.',
      blocks: [
        { h: 'Co zmienia zdrowie' },
        {
          table: {
            head: ['Źródło', 'Zmiana', 'Warunek', '5000 zdrowia w'],
            rows: [
              ['Regeneracja', '+12/s', 'Energia powyżej 0%, także w walce', '6 min 57 s'],
              [
                '[[article:religion|Aura Świątyni]]',
                '+50/s',
                '50 kroków od [[building:work_temple|Świątyni]]',
                '1 min 40 s',
              ],
              ['Mikstura lecznicza', '+2000 za łyk', 'rana zeszłaby poniżej 2500', '-'],
              ['Głód', '-24/s', 'Energia 0%', '3 min 28 s'],
            ],
            num: [1, 3],
            foot: 'Regeneracja i aura sumują się do 62 na sekundę. Regeneracja kończy się na 5000, aura na 7500. Dziecko i bohater też mają 5000 i regenerują.',
          },
        },
        { p: 'Przy 720 zdrowia gra pokazuje powiadomienie, że osadnik umiera.' },
        { h: 'Mikstury lecznicze' },
        {
          list: [
            '[[good:potion_heal_small|Mała Lecznicza Mikstura]] ma 2 łyki, razem 4000. [[good:potion_heal_big|Duża Lecznicza Mikstura]] ma 5 łyków, razem 10000.',
            'Osadnik pije łyk za łykiem, aż rana zostawi mu co najmniej 2500 zdrowia.',
            'Cios, który by zabił, nie zabija, jeśli łyki pokrywają ranę.',
            'Głód też wywołuje picie, gdy zdrowie schodzi poniżej 2500.',
            'Najpierw napoczęta butelka, potem mała, potem duża.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: 'Życie i śmierć',
      lead: 'Dziecko dorasta 4 minuty po narodzinach. Dorosły żyje, dopóki ma zdrowie.',
      blocks: [
        { h: 'Etapy życia' },
        {
          table: {
            head: ['Etap', 'Wiek', 'Od narodzin', 'Uwagi'],
            rows: [
              ['Niemowlę', '0-3 lata', '0-1 min 20 s', 'Krok dwa razy dłuższy.'],
              ['Dziecko', '4-11 lat', '1 min 20 s-4 min', 'Krok dłuższy o 0,17 s. Chodzi wokół domu.'],
              [
                'Dorosły',
                'od 12 lat',
                'od 4 min',
                'Chłopiec zostaje [[job:civilist|Cywilem]], dziewczynka [[job:woman|Kobietą]].',
              ],
            ],
            foot: 'Rok życia trwa 20 s. Cywil bez zawodu czeka na przydział.',
          },
        },
        { h: 'Co zostaje po śmierci' },
        {
          table: {
            head: ['Rzecz', 'Co się z nią dzieje'],
            rows: [
              ['Niesiony towar', 'Spada na ziemię w całości.'],
              [
                '[[good:shoes|Buty]], narzędzie',
                'Spadają jako nowe, jeśli są zużyte najwyżej w 10%. Inaczej przepadają.',
              ],
              ['Broń', 'Spada tylko po żołnierzu.'],
              ['Pancerz', 'Spada zawsze.'],
              ['Napoje, amulety', 'Spadają amulety i nienapoczęte butelki.'],
              ['Wózek Tragarza', 'Stoi na miejscu z ładunkiem.'],
              ['Ciało', 'Człowiek zostawia kości. Po zwierzęciu zostaje [[article:wildlife|mięso]].'],
            ],
          },
        },
        {
          p: 'Odkryte [[article:trades|zawody]] zostają w osadzie. Skutki dla współmałżonka: [[article:family|Rodzina i dom]].',
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: 'Rodzina i dom',
      lead: 'Dziecko kosztuje 2 sztuki jedzenia ze spiżarni, a para ma jedno dziecko naraz.',
      blocks: [
        { h: 'Dziecko' },
        {
          steps: [
            'Gracz wybiera: Niech ma Chłopca albo Niech ma Dziewczynkę.',
            'Żona donosi jedzenie, gdy spiżarnia ma mniej niż 2 sztuki.',
            'Oboje wchodzą do domu.',
            'Spiżarnia traci 2 sztuki.',
            'Dziecko rodzi się po 16,7 s u Wikingów, po 4,2 s u pozostałych plemion.',
          ],
        },
        {
          table: {
            head: ['Co blokuje dziecko', 'Rozwiązanie'],
            rows: [
              ['Żona nie ma domu', 'Przydziel dom.'],
              ['Dom jest w budowie', 'Dokończ budowę.'],
              ['Mąż to żołnierz, [[job:trader|Kupiec]] lub [[job:scout|Zwiadowca]]', 'Zmień mu zawód.'],
              ['Małżonkowie mieszkają osobno', 'Przydziel im ten sam dom.'],
              ['Brak jedzenia w zasięgu', 'Dostarcz jedzenie do pobliskiego magazynu.'],
            ],
          },
        },
        {
          p: 'Następne dziecko para może mieć, gdy poprzednie dorośnie, czyli po 4 minutach. Dziecko nie zajmuje miejsca rodziny w domu.',
        },
        { h: 'Ślub' },
        {
          list: [
            'Rozkaz Ożeń łączy osadnika z najbliższą dorosłą osobą przeciwnej płci, z tego samego plemienia i od tego samego gracza.',
            'Ślubu nie biorą żołnierze, bohaterowie, Zwiadowcy ani osadnik wysłany do [[building:barracks|Koszar]] lub [[building:school|Szkoły]].',
            'Para mieszka w domu żony, a gdy żona go nie ma, w domu męża.',
          ],
        },
        { h: 'Poziomy domu' },
        { data: 'homes' },
        {
          p: 'Spiżarnia to osobny limit na Żywność i na Ciastko: Dom 1 mieści 5 + 5 sztuk. Rodzina to dorosły, jego małżonek i rosnące dziecko. Dom może należeć do dowolnego plemienia gracza.',
        },
        { h: 'Wyposażenie domu' },
        {
          table: {
            head: ['Towar', 'Od', 'Daje', '1 sztuka starcza na', 'Zapas', 'Dokładka poniżej'],
            rows: [
              [
                '[[good:crockery|Naczynia]]',
                'Dom 1',
                'Dostawa jedzenia daje 2 sztuki',
                '20 dostaw',
                '5 sztuk',
                '1 sztuki',
              ],
              [
                '[[good:furniture|Meble]]',
                'Dom 1',
                'Sen ×2',
                '10 snów mężczyzny, 20 snów kobiety',
                '5 sztuk',
                '1 sztuki',
              ],
              [
                '[[good:holy_oil|Oliwa]]',
                'Dom 3',
                '[[article:religion|Święty ogień]]: modlitwa przed domem',
                '5 min 33 s',
                '5 sztuk',
                '3 sztuk',
              ],
            ],
            foot: 'Dokładkę niesie Kobieta z domu. Oliwa pali się bez przerwy, także gdy nikt się nie modli.',
          },
        },
        {
          p: 'W panelu domu gracz wyłącza dla całej osady używanie Naczyń i Mebli oraz dostawy Oliwy. Oliwa już złożona pali się dalej.',
        },
        { h: 'Kto traci dom' },
        {
          table: {
            head: ['Kto', 'Kiedy'],
            rows: [
              ['Wdowiec', 'Gdy żona nie żyje, a dziecko dorosło lub zmarło.'],
              ['Wdowa', 'Zostaje w domu.'],
              ['Dorosłe dziecko', 'W chwili dorosłości.'],
              ['Wszyscy mieszkańcy', 'Gdy dom zostaje zburzony.'],
              ['Cała rodzina', 'Po rozkazie Usuń Dom.'],
              [
                'Kupiec, Zwiadowca, żołnierz',
                'Dom zostaje przy rodzinie, ale on sam nie je w nim ani nie śpi.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:life',
        'article:food',
        'article:religion',
        'building:home_level_00',
        'good:crockery',
        'good:furniture',
      ],
    },
    {
      id: 'draughts',
      name: 'Napoje i amulety',
      lead: 'Osadnik pije w miejscu i nie przerywa tego, co robi.',
      blocks: [
        { h: 'Napoje' },
        {
          table: {
            head: ['Napój', 'Łyki', 'Za łyk', 'Pije, gdy'],
            rows: [
              [
                '[[good:mead|Miód Pitny]]',
                2,
                '+50% Energii i +50% Wytrzymałości',
                'Energia lub Wytrzymałość ma do 20%',
              ],
              ['[[good:potion_food_small|Mała Odżywcza Mikstura]]', 2, '+100% Energii', 'Energia ma do 20%'],
              ['[[good:potion_food_big|Duża Odżywcza Mikstura]]', 5, '+100% Energii', 'Energia ma do 20%'],
              [
                '[[good:potion_stamina_small|Mała Mikstura Wytrzymałości]]',
                2,
                '+100% Wytrzymałości',
                'Wytrzymałość ma do 20%',
              ],
              [
                '[[good:potion_stamina_big|Duża Mikstura Wytrzymałości]]',
                5,
                '+100% Wytrzymałości',
                'Wytrzymałość ma do 20%',
              ],
              [
                '[[good:potion_heal_small|Mała Lecznicza Mikstura]]',
                2,
                '+2000 zdrowia',
                'rana zeszłaby poniżej 50% zdrowia',
              ],
              [
                '[[good:potion_heal_big|Duża Lecznicza Mikstura]]',
                5,
                '+2000 zdrowia',
                'rana zeszłaby poniżej 50% zdrowia',
              ],
            ],
            num: [1],
            foot: 'Rozkaz jedzenia lub snu wstrzymuje picie.',
          },
        },
        { h: 'Amulety' },
        {
          table: {
            head: ['Amulet', 'Działanie', 'Kiedy'],
            rows: [
              [
                '[[good:amulet_food|Odżywczy Amulet]]',
                '+40% Energii',
                'za każdym razem, gdy Energia ma do 20%',
              ],
              [
                '[[good:amulet_stamina|Amulet Wytrzymałości]]',
                '+40% Wytrzymałości',
                'za każdym razem, gdy Wytrzymałość ma do 20%',
              ],
              ['[[good:amulet_strength|Amulet Siły]]', 'zadawane obrażenia ×1,5', 'każdy cios'],
              ['[[good:amulet_crithit|Amulet Precyzji]]', '20% szans na obrażenia ×2', 'każdy cios'],
              ['[[good:amulet_defense|Amulet Obrony]]', 'otrzymywane obrażenia ×0,5', 'każdy otrzymany cios'],
              ['[[good:amulet_speed|Amulet Wiatru]]', 'krok krótszy o 0,17 s', 'każdy krok'],
            ],
            foot: 'Amulet się nie zużywa.',
          },
        },
        { h: 'Kilka naraz' },
        {
          list: [
            'Drugi taki sam amulet nic nie daje.',
            'Różne amulety działają razem: Siła i Precyzja dają ×3 przy udanym losowaniu.',
            'Kolejność na potrzebę: napoczęta butelka, amulet, butelka z mniejszą liczbą łyków.',
            'Miód Pitny wypity z powodu Energii napełnia też Wytrzymałość.',
            'Z Odżywczym Amuletem osadnik nie szuka jedzenia, z Amuletem Wytrzymałości nie idzie spać.',
          ],
        },
        { h: 'Kto nosi' },
        {
          table: {
            head: ['Kto', 'Co nosi'],
            rows: [
              ['Dorosły mężczyzna', '4 miejsca na napoje i amulety, w każdym zawodzie.'],
              [
                '[[article:heroes|Bohater]]',
                'Mikstury lecznicze oraz amulety Siły, Precyzji, Obrony i Wiatru.',
              ],
              ['Kobieta, dziecko', 'Nic.'],
            ],
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:damage', 'article:walking'],
    },
  ],
};
