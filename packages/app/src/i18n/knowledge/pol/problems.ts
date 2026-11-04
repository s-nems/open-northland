import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Problemy',
  items: [
    {
      id: 'why',
      name: 'Dlaczego to nie działa?',
      lead: 'Zaznacz budynek albo osadnika i przeczytaj jego pasek stanu.',
      blocks: [
        {
          h: 'Komunikaty',
        },
        {
          table: {
            filter: 'Szukaj komunikatu',
            head: ['Komunikat', 'Poziom', 'Przyczyna', 'Co zrobić'],
            rows: [
              [
                '"Atak na osadę"',
                'Pilne',
                'Ktoś atakuje twój budynek lub palisadę albo walczy do {{notice.settlementReach}} hexów od nich',
                'Wyślij żołnierzy',
              ],
              [
                '"Atakują nas"',
                'Ważne',
                'Walka dalej niż {{notice.settlementReach}} hexów od osady',
                'Wyślij żołnierzy albo odprowadź ludzi',
              ],
              [
                '"Brak dojścia"',
                'Ważne',
                'Zasób jest w obszarze, ale nie da się do niego dojść',
                'Otwórz przejście albo przenieś flagę',
              ],
              ['"Brak dowódcy"', 'Ważne', 'Pojazd bez dowódcy dostał rozkaz jazdy', 'Przydziel dowódcę'],
              [
                '"Brak handlu"',
                'Ważne',
                'Cel Kupca wymaga przyjaznego stosunku obu stron',
                'Sprawdź [[article:diplomacy|Dyplomację]]',
              ],
              [
                '"Brak magazynu"',
                'Zwykłe, warsztat: Ważne',
                'Żaden magazyn nie przyjmie towaru',
                'Zbuduj magazyn albo zrób w nim miejsce',
              ],
              [
                '"Brak miejsc"',
                'Ważne',
                'Budynek nie ma wolnych miejsc pracy',
                'Zwolnij miejsce albo zbuduj drugi taki budynek',
              ],
              [
                '"Brak pary"',
                'Zwykłe',
                'Po rozkazie "Zawrzyj małżeństwo" w pobliżu nie było nikogo wolnego',
                'Spróbuj znowu, gdy ktoś będzie wolny',
              ],
              [
                '"Brak pary: towar"',
                'Ważne',
                'Na [[article:livestock|Fermie]] jest tylko jedno zwierzę',
                'Wyślij Zwiadowcę po drugie',
              ],
              [
                '"Brak placu", "Plac zajęty"',
                'Ważne',
                'Obok warsztatu nie ma wolnej ziemi na pojazd albo stoi tam inny pojazd',
                'Zrób miejsce, warsztat spróbuje znowu po {{notice.yardRetrySeconds}} s',
              ],
              ['"Brak ryb"', 'Ważne', 'W pobliskiej wodzie nie ma już ryb', 'Wskaż flagą wodę z rybami'],
              [
                '"Brak tragarza"',
                'Ważne',
                'Na pokładzie nie ma nikogo, kto by ładował',
                'Wsadź na pokład Tragarza albo innego cywila',
              ],
              [
                '"Brak trasy"',
                'Pilne',
                'Pojazd nie ma drogi do celu. Cel statku nie leży na tej wodzie',
                'Wskaż inny cel',
              ],
              [
                '"Brak w obszarze"',
                'Ważne',
                'W obszarze roboczym nie ma tego zasobu',
                'Przenieś flagę roboczą albo rozszerz drogowskazy',
              ],
              [
                '"Brak załogi"',
                '-',
                'Wieża nie ma obsady',
                'Przydziel łuczników: [[article:defence|Wieże i alarm]]',
              ],
              ['"Brak zasobów"', 'Ważne', 'Na całej mapie nie ma nic do zebrania', 'Zmień mu zawód'],
              [
                '"Brak zwierząt: towar"',
                'Ważne',
                'Na [[article:livestock|Fermie]] nie ma tego gatunku',
                'Wyślij Zwiadowcę do dzikich zwierząt',
              ],
              [
                '"Brak zwierzęcia"',
                'Ważne',
                'Zaprzęg nie ma Wołu',
                'Trzymaj {{livestock.pairPlusOne}} dorosłe sztuki: [[article:vehicles|Pojazdy i statki]]',
              ],
              [
                '"Brak zwierzyny"',
                'Ważne',
                'W terenie łowieckim nie ma wolnej zwierzyny',
                'Przenieś flagę tam, gdzie pasie się zwierzyna',
              ],
              [
                '"Brak: towar"',
                'Zwykłe, warsztat: Ważne',
                'Place Budowniczego czekają na towar, którego nie ma w pobliskich magazynach, albo warsztatowi brakuje surowca, którego nikt nie wytwarza',
                'Wytwórz go, sprowadź albo obsadź warsztat',
              ],
              [
                '"Budowa czeka: towar"',
                'Pilne',
                'Towaru nie ma w żadnym magazynie w zasięgu drogowskazów placu',
                'Wytwórz go, sprowadź albo połącz magazyn drogowskazami',
              ],
              [
                '"Chce się modlić"',
                'Ważne',
                'Religia spadła do {{need.criticalPct}}% i nie ma miejsca modlitwy',
                'Zbuduj [[building:work_temple|Świątynię]] albo rozpal święty ogień',
              ],
              [
                '"Głoduje"',
                'Pilne',
                'Osadnik traci zdrowie z głodu',
                'Szybko dostarcz jedzenie do magazynu w jego zasięgu',
              ],
              [
                '"Głód"',
                'Zwykłe',
                'Energia spadła do {{need.criticalPct}}%',
                'Dostarcz jedzenie do magazynu w jego zasięgu',
              ],
              [
                '"Ląd zbadany"',
                'Ważne',
                'Zwiadowca odkrył cały dostępny ląd i czeka',
                'Wydaj nowy rozkaz: [[article:scout|Zwiadowca]]',
              ],
              [
                '"Magazyn daleko"',
                'Zwykłe, warsztat: Ważne',
                'Magazyny, które go przyjmą, leżą poza zasięgiem drogowskazów',
                'Połącz je drogowskazami albo zbuduj magazyn bliżej',
              ],
              [
                '"Nic do budowy"',
                'Zwykłe',
                'Budowniczy nie ma żadnego placu',
                'Postaw budynek albo zmień mu zawód',
              ],
              [
                '"Nic do roboty"',
                'Zwykłe',
                'Osadnik z miejscem pracy od {{notice.idleSeconds}} s nic nie robi i nie wiadomo dlaczego',
                'Sprawdź budynek albo zmień mu zawód',
              ],
              [
                '"Nic do zebrania"',
                'Zwykłe',
                'Przy fladze Tragarza nie ma nic do zabrania',
                'Przenieś flagę albo ją zabierz',
              ],
              [
                '"Nie dojedzie"',
                'Ważne',
                'Statek cumuje przy innym lądzie niż pojazd',
                'Przybij do brzegu, do którego pojazd dojedzie',
              ],
              [
                '"Nie ten zawód"',
                'Ważne',
                'Osadnik nie ma zawodu, którego potrzebuje budynek',
                'Zmień mu zawód',
              ],
              [
                '"Nie wejdą", "Bez budowy"',
                'Ważne',
                'Trwa czas pokoju, a wskazane miejsce leży za blisko osady innego gracza',
                'Wskaż miejsce dalej: [[article:diplomacy|Dyplomacja]]',
              ],
              [
                '"Nie wsiądzie", "Nie wysiądzie"',
                'Ważne',
                'Statek jest na morzu albo zawód nie pasuje do pojazdu',
                'Przybij do brzegu albo wybierz inny pojazd',
              ],
              [
                '"Nikt nie zbiera: towar", "Nikt nie poluje: towar", "Nikt nie łowi: towar"',
                'Ważne',
                'Warsztat stoi od {{notice.noGathererSeconds}} s bez surowca i nikt go nie zdobywa',
                'Przydziel osadnika albo włącz ten towar u obecnych',
              ],
              [
                '"Odmowa statku"',
                'Ważne',
                'Statek nie przewozi tego pojazdu albo jego miejsce jest zajęte',
                'Użyj Statku albo zwolnij miejsce: [[article:vehicles|Pojazdy i statki]]',
              ],
              [
                '"Pełne magazyny: towar"',
                'Zwykłe',
                'Półka wytwórcy i każdy magazyn z tym towarem są pełne od {{notice.storageFullSeconds}} s',
                'Zbuduj magazyn albo zużyj zapas',
              ],
              [
                '"Pełny pokład"',
                'Ważne',
                'Wszystkie miejsca są zajęte',
                'Zwolnij miejsce albo użyj innego pojazdu',
              ],
              [
                '"Praca zamknięta"',
                'Ważne',
                'Zawód albo budynek jest jeszcze niedostępny dla twojego plemienia, albo zakazuje go misja',
                'Zdobądź odkrycie albo zmień zawód: [[article:exp-work|Doświadczenie w pracy]]',
              ],
              [
                '"Stoi na alarmie"',
                '-',
                'Żołnierz w postawie Atak lub Obrona nie odpoczywa, gdy do {{alert.restClearance}} hexów trwa walka albo do {{alert.standTo}} hexów widać wrogiego żołnierza',
                'Wydaj mu rozkaz "Jedz" albo "Śpij"',
              ],
              [
                '"Surowiec daleko"',
                'Ważne',
                'Surowiec mają tylko budynki poza zasięgiem drogowskazów',
                'Połącz je drogowskazami albo zbuduj magazyn bliżej',
              ],
              [
                '"Towary na 0"',
                'Zwykłe',
                'Wszystkie liczniki osadnika mają 0',
                'Wybierz w panelu, co ma robić',
              ],
              [
                '"Umiera"',
                'Pilne',
                'Zdrowie spadło poniżej {{health.nearDeath}}, z ran albo głodu',
                'Zabierz go z walki albo daj mu jedzenie',
              ],
              [
                '"Utrata pracy"',
                'Ważne',
                'Budynek zniknął albo osadnika zwolniono, a on od {{notice.idleSeconds}} s stoi bez flagi. Zawód zostaje',
                'Przydziel miejsce pracy albo zmień zawód',
              ],
              [
                '"Wymaga restartu"',
                'Pilne',
                'Zmienione ustawienie zadziała dopiero po restarcie',
                '"Restart misji" w menu Esc',
              ],
              [
                '"Wyrób nieodkryty"',
                'Ważne',
                'Wybrany wyrób nie jest jeszcze dostępny',
                'Wybierz inny wyrób',
              ],
              [
                '"Za mało wprawy"',
                'Ważne',
                'Osadnik ma za mało doświadczenia na ten zawód',
                'Wyślij kogoś bardziej doświadczonego: [[article:exp-work|Doświadczenie w pracy]]',
              ],
              [
                '"Zgubił się", "Zgubiła się"',
                'Pilne',
                'Nie ma drogi do celu albo miejsce pracy, flaga robocza lub plac leży poza zasięgiem drogowskazów. Stoi, aż coś zmienisz',
                '"Pokaż cel" wskaże to miejsce. Postaw [[article:roads|drogowskaz]] albo wydaj inny rozkaz',
              ],
              [
                '"Zmęczenie"',
                'Zwykłe',
                'Wytrzymałość spadła do {{need.criticalPct}}%',
                'Nie dawaj mu teraz rozkazów, sam pójdzie spać',
              ],
              [
                '"Zwierz odcięty"',
                'Ważne',
                'Zwierzyna stoi za wodą albo murem',
                'Otwórz przejście albo przenieś flagę',
              ],
            ],
            foot: 'Filtr "Ważne i pilne" ukrywa Zwykłe, "Tylko pilne" także Ważne. Poziom "-" to napis na panelu, bez powiadomienia.',
          },
        },
        {
          h: 'Praca i produkcja',
        },
        {
          faq: [
            [
              'Warsztat stoi pusty',
              'Stan "Brak pracowników" znaczy, że nikt tam nie pracuje: przydziel osadnika z właściwym zawodem. Jeśli odmówi, komunikat powie dlaczego: "Nie ten zawód", "Brak miejsc" albo "Za mało wprawy". Stan "Bezczynny" podaje brakujący surowiec. Pracownik sam po niego pójdzie, jeśli leży do {{reach.goods}} hexów od drogowskazu.',
            ],
            [
              'Płatnerz, Kowal albo Krawiec nie pracuje',
              'Pewnie ma 0% Religii w "Samopoczucie". Każda broń i zbroja kosztuje {{piety.lowPct}}% albo {{piety.highPct}}% Religii, a modlitwa daje {{pray.pct}}%. Komunikat "Chce się modlić" znaczy, że nie ma gdzie się modlić: potrzebna [[building:work_temple|Świątynia]], [[building:headquarters|Kwatera główna]] albo święty ogień w domu. Więcej: [[article:religion|Religia i świątynia]].',
            ],
            [
              'Tragarze nic nie noszą',
              'Tragarz pracuje tylko wtedy, gdy ma miejsce pracy w budynku. Stan "Nic do przeniesienia w zasięgu" znaczy, że do {{flag.radius}} hexów od budynku albo flagi roboczej nie ma towaru, a "Brak miejsca przyjmującego towar", że magazyny są pełne.',
            ],
            [
              'Hodowla stoi',
              'Hodowca rozmnaża zwierzęta tylko wtedy, gdy ma dokładnie {{livestock.pair}} dorosłe sztuki. Co oznacza stan Fermy: [[article:livestock|Hodowla]].',
            ],
            [
              'Myśliwy nic nie przynosi',
              'Stan "Brak wolnej zwierzyny w terenie łowieckim" znaczy, że do {{flag.hunter}} hexów od flagi albo miejsca pracy nie ma nic do upolowania. Nie na każde zwierzę poluje sam, patrz kolumna "Myśliwy": [[article:wildlife|Dzikie zwierzęta i polowanie]]. Przenieś flagę roboczą tam, gdzie pasie się zwierzyna.',
            ],
          ],
        },
        {
          h: 'Ludzie',
        },
        {
          faq: [
            [
              'Nie rodzą się dzieci',
              'Para potrzebuje wspólnego domu i {{family.childFood}} sztuk jedzenia w spiżarni. Komunikat mówi, czego brak: "Para bez domu", "Dom w budowie", "Osobne domy", "Brak jedzenia". "Mąż nie wraca" oznacza, że mąż jest Kupcem, Zwiadowcą, żołnierzem albo bohaterem i nie wraca do domu. Dzieci możesz też zamówić licznikiem "Narodziny" w Asystencie. Więcej: [[article:family|Rodzina i dom]].',
            ],
            [
              'Głód przy pełnym magazynie',
              'Sprawdź "Minimum w magazynach": poniżej tej ilości nikt nie weźmie towaru, także na posiłek. Obniż je przy jedzeniu. Może być też za daleko: magazyn musi leżeć do {{reach.walk}} hexów od osadnika albo w sieci drogowskazów.',
            ],
            [
              'Zawodu nie ma na liście w Szkole',
              'Lista pokazuje tylko kursy odkryte i dozwolone w tej misji. Wiersz bez wyboru podaje powód: "Już nauczone" albo "Nie można wyszkolić wybranych osadników w tej szkole". Kursy odkrywa [[article:exp-work|Doświadczenie w pracy]].',
            ],
          ],
        },
        {
          h: 'Budowa i pola',
        },
        {
          faq: [
            [
              'Budynek jest zablokowany',
              'Jest w sekcji "Zablokowane" okna budowy. Podpowiedź "Wymagane odkrycia:" mówi, jakie zawody i towary są potrzebne i ile doświadczenia ci brakuje. "Niedostępne w tej misji": nie zbudujesz go na tej mapie. Papier ze skrzyni stawia budynek także bez odkrycia: [[article:chests|Skrzynie i papiery]].',
            ],
            [
              'Budowa stoi',
              'Stan budowy mówi, czego brak: "brak materiałów", "dostawa w drodze" albo "brak budowniczego". Komunikat "Budowa czeka: towar" oznacza, że towaru nie ma w żadnym magazynie w zasięgu drogowskazów placu, {{reach.goods}} hexów od drogowskazu. Budowniczy sam nosi materiał.',
            ],
            [
              'Pole nie rośnie',
              'Rośnie tylko od podlewania przez [[job:farmer|Farmera]] z miejscem pracy na [[building:work_farm_00|Farmie]]. Farmer najpierw sieje, a podlewa dopiero przy {{field.max}} polach albo gdy nie ma gdzie siać. Pole dojrzewa po {{field.waterings}} podlewaniach, a jedno podlewanie obejmuje też 6 sąsiednich pól. Sieje tylko na trawie, poza drogami, do {{field.radius}} hexów od Farmy.',
            ],
            [
              'Czy deszcz, śnieg albo noc coś zmieniają?',
              'Nie. Pogoda, ustawienie "Zima" i pora dnia to tylko obraz i dźwięk. Wolniej chodzi się tylko po piasku, w górach i po śniegu, który leży na mapie od początku.',
            ],
          ],
        },
        {
          h: 'Wojsko i pojazdy',
        },
        {
          faq: [
            [
              'Żołnierz nie atakuje',
              'Sprawdź postawę: [[article:stances|Postawy]]. W postawie Ignorowanie nie podchodzi do wroga i bije tylko to, co ma w zasięgu broni. Zaatakuje tylko plemię, do którego masz stosunek "Wrogi", i tylko poza "Czasem pokoju".',
            ],
            [
              'Statek nie wypływa',
              'Stan "Czeka na dowódcę": przydziel dowódcę, może nim być każdy dorosły. "Czeka na załogę": ktoś z załogi jeszcze idzie na statek. "Brak trasy": cel nie leży na tej wodzie. Na morzu nikt nie wsiądzie, najpierw "Zacumuj".',
            ],
            [
              'Zaprzęg stoi',
              'Stan "Czeka na zwierzę pociągowe" znaczy, że brakuje Wołu. Zaprzęg zabierze [[good:cattle|Wołu]] tylko spoza pary, więc potrzebne są {{livestock.pairPlusOne}} dorosłe sztuki w jednej Fermie albo {{livestock.pairPlusOne}} poza Fermą: [[article:vehicles|Pojazdy i statki]].',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
