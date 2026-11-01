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
                'Cios w budynek lub palisadę albo do {{notice.settlementReach}} hexów od nich. Ciosy do {{notice.fightRadius}} hexów od siebie to jedna karta, znika po {{notice.fightQuietSeconds}} s bez ciosu',
                'Wyślij żołnierzy',
              ],
              [
                '"Atakują nas"',
                'Ważne',
                'Cios dalej niż {{notice.settlementReach}} hexów od osady',
                'Wyślij żołnierzy albo odprowadź ludzi',
              ],
              [
                '"Brak dojścia"',
                'Ważne',
                'Zasób jest w obszarze, ale nie ma do niego drogi',
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
                'Po "Zawrzyj małżeństwo" w zasięgu nie było wolnej osoby. Rozkaz przepada',
                'Wydaj rozkaz, gdy ktoś będzie wolny',
              ],
              [
                '"Brak pary: towar"',
                'Ważne',
                'Na [[article:livestock|Fermie]] jest tylko jedno zwierzę',
                'Wyślij Zwiadowcę po drugie',
              ],
              [
                '"Brak placu"',
                'Ważne',
                'Obok warsztatu nie ma wolnej ziemi na pojazd',
                'Zrób miejsce, próba wraca po {{notice.yardRetrySeconds}} s',
              ],
              ['"Brak ryb"', 'Ważne', 'W zasięgu brzegu nie ma już ryb', 'Wskaż flagą wodę z rybami'],
              [
                '"Brak tragarza"',
                'Ważne',
                'Na pokładzie nie ma nikogo do ładunku',
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
                'W obszarze pracy nie ma tego zasobu',
                'Przenieś flagę roboczą albo rozszerz drogowskazy',
              ],
              [
                '"Brak załogi"',
                '-',
                'Wieża nie ma obsady',
                'Przydziel łuczników: [[article:defence|Wieże, alarm, schronienie]]',
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
                'Budowniczy: place czekają na towar, którego nie ma w magazynach w ich zasięgu. Warsztat: nie ma surowca w magazynach i nikt go nie wytwarza',
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
              ['"Czeka na budowę warsztatu"', '-', 'Miejsce pracy to wciąż plac budowy', 'Dokończ budowę'],
              ['"Czeka na koniec budowy"', '-', 'Szkoła albo Koszary to wciąż plac budowy', 'Dokończ budowę'],
              [
                '"Czeka na wolne miejsce"',
                '-',
                'Wszystkie miejsca nauki są zajęte',
                'Poczekaj albo wyślij go gdzie indziej',
              ],
              [
                '"dzikie bestie"',
                '-',
                'Wróg na karcie ataku to dzikie zwierzęta',
                '[[article:wildlife|Dzikie zwierzęta i polowanie]]',
              ],
              [
                '"Głoduje"',
                'Pilne',
                'Osadnik traci zdrowie z głodu',
                'Szybko dostarcz jedzenie do magazynu w jego zasięgu',
              ],
              ['"Głód"', 'Zwykłe', 'Osadnik jest głodny', 'Dostarcz jedzenie do magazynu w jego zasięgu'],
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
                '"Misja trzyma tę postać przy jej zadaniu"',
                '-',
                'Postacią steruje skrypt mapy',
                'Poczekaj, nie przyjmie rozkazów',
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
                'Osadnik z miejscem pracy stoi 10 s bez nazwanego powodu. Żołnierzy, osadników w Obronie i Tragarzy bez flagi to nie dotyczy',
                'Sprawdź budynek albo zmień mu zawód',
              ],
              [
                '"Nic do zebrania"',
                'Zwykłe',
                'Tragarz nie ma co podnieść przy swojej fladze',
                'Przenieś flagę albo ją zabierz',
              ],
              [
                '"Nie dojedzie"',
                'Ważne',
                'Drzwi statku leżą na innym lądzie',
                'Przybij do brzegu, do którego jest dojazd',
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
                'Trwa pokój i rozkaz sięga pod osadę partnera',
                'Wskaż miejsce dalej: [[article:diplomacy|Dyplomacja]]',
              ],
              [
                '"Nie wsiądzie"',
                'Ważne',
                'Zawód nie pasuje do pojazdu albo statek jest na morzu',
                'Przybij do brzegu albo wybierz inny pojazd',
              ],
              ['"Nie wysiądzie"', 'Ważne', 'Statek jest na morzu', 'Przybij do brzegu'],
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
              ['"Plac zajęty"', 'Ważne', 'Na placu stoi inny pojazd', 'Odprowadź go'],
              [
                '"Praca zamknięta"',
                'Ważne',
                'Zawód albo budynek jest jeszcze niedostępny dla twojego plemienia, albo zakazuje go misja',
                'Zdobądź odkrycie: [[article:exp-work|Doświadczenie w pracy]]',
              ],
              [
                '"Stoi na alarmie"',
                '-',
                'Żołnierz w Ataku lub Obronie nie odpoczywa przy walce do {{alert.restClearance}} hexów albo przy widocznym wrogim żołnierzu do {{alert.standTo}} hexów. Dzikie zwierzę liczy się dopiero w walce',
                'Rozkaz "Jedz" albo "Śpij" go zwalnia',
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
                'Osadnik jest bliski śmierci',
                'Wyprowadź go z zagrożenia i daj mu jedzenie',
              ],
              [
                '"Utrata pracy"',
                'Ważne',
                'Stracił miejsce pracy i przez 10 s stoi bez niego i bez flagi. Budynek zniknął albo go zwolniono. Zawód zostaje',
                'Przydziel miejsce pracy albo zmień zawód',
              ],
              [
                '"Wymaga restartu"',
                'Pilne',
                'Zmienione ustawienie działa dopiero od nowa',
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
              ['"Zmęczenie"', 'Zwykłe', 'Osadnik musi się wyspać', 'Pozwól mu odpocząć'],
              [
                '"Zwierz odcięty"',
                'Ważne',
                'Zwierzyna stoi za wodą albo murem',
                'Otwórz przejście albo przenieś flagę',
              ],
            ],
            foot: 'Filtr "Ważne i pilne" ukrywa Zwykłe, "Tylko pilne" także Ważne. Nowa gra ma filtr "Wszystkie". Poziom "-" to napis na panelu, bez powiadomienia.',
          },
        },
        {
          h: 'Praca i produkcja',
        },
        {
          faq: [
            [
              'Warsztat stoi pusty',
              'Stan "Brak pracowników": nikt nie ma tam miejsca pracy. Osadnik wchodzi tylko z właściwym zawodem i wolnym miejscem, inaczej komunikat powie "Nie ten zawód", "Brak miejsc" albo "Za mało wprawy". Stan "Bezczynny" podaje brakujący surowiec. Pracownik sam po niego chodzi, jeśli leży do {{reach.goods}} hexów od drogowskazu.',
            ],
            [
              'Płatnerz, Kowal albo Krawiec nie pracuje',
              'Religia w "Samopoczucie" ma 0%. Seria broni lub zbroi kosztuje 15% albo 30%, modlitwa daje {{pray.pct}}%. Komunikat "Chce się modlić" oznacza brak miejsca modlitwy: potrzebna [[building:work_temple|Świątynia]], [[building:headquarters|Kwatera główna]] albo święty ogień w domu. Krawiec sam się nie modli, wydaj mu rozkaz "Módl się".',
            ],
            [
              'Tragarze nic nie noszą',
              'Tragarz nosi tylko z miejscem pracy w budynku. Stan "Nic do przeniesienia w zasięgu": do {{flag.radius}} hexów od budynku, a z flagą roboczą od flagi, nie ma towaru do zabrania. "Brak miejsca przyjmującego towar" to pełne magazyny.',
            ],
            [
              'Hodowla stoi',
              'Hodowca rozmnaża przy dokładnie {{livestock.pair}} dorosłych sztukach gatunku. Stan Fermy mówi "Brak zwierząt", "Tylko jedno zwierzę", "Młode dorastają" albo "Stado pełne": [[article:livestock|Hodowla]].',
            ],
            [
              'Myśliwy nic nie przynosi',
              'Stan "Brak wolnej zwierzyny w terenie łowieckim": do {{flag.hunter}} hexów od flagi roboczej albo miejsca pracy nie ma zwierzyny. Na Wilka, Lwa, Niedźwiedzia, Słonia, Psa i Kurę nie poluje. Przenieś flagę roboczą tam, gdzie pasie się zwierzyna.',
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
              'Para potrzebuje wspólnego domu i {{family.childFood}} sztuk jedzenia w spiżarni. Komunikaty: "Mąż nie wraca" (mąż jest Kupcem, Zwiadowcą, żołnierzem albo bohaterem), "Para bez domu", "Dom w budowie", "Osobne domy", "Brak jedzenia". Licznik "Narodziny" w Asystencie składa zamówienia. Więcej: [[article:family|Rodzina i dom]].',
            ],
            [
              'Głód przy pełnym magazynie',
              'Sprawdź "Minimum w magazynach": nikt nie weźmie towaru poniżej tej sumy, także na posiłek. Obniż minimum przy jedzeniu. Druga przyczyna to odległość: magazyn musi leżeć w zasięgu chodu osadnika, {{reach.walk}} hexów albo sieć drogowskazów.',
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
              'W oknie budowy trafia do sekcji "Zablokowane". Podpowiedź "Wymagane odkrycia:" wymienia zawody i towary, a przy towarze doświadczenie w formie obecne/wymagane. "Niedostępne w tej misji" to zakaz mapy. Papier ze skrzyni stawia budynek także bez odkrycia: [[article:chests|Skrzynie i papiery]].',
            ],
            [
              'Budowa stoi',
              'Stan budowy mówi, czego brak: "brak materiałów", "dostawa w drodze" albo "brak budowniczego". Komunikat "Budowa czeka: towar" oznacza, że towaru nie ma w żadnym magazynie w zasięgu drogowskazów placu, {{reach.goods}} hexów od drogowskazu. Budowniczy sam nosi materiał.',
            ],
            [
              'Pole nie rośnie',
              'Rośnie tylko od podlewania przez [[job:farmer|Farmera]] z miejscem pracy na [[building:work_farm_00|Farmie]]. Farmer najpierw sieje, a podlewa dopiero przy {{field.max}} polach albo gdy nie ma gdzie siać. Pole dojrzewa po {{field.waterings}} podlewaniach, a jedno podlewanie obejmuje też 6 sąsiednich pól. Siew działa tylko na trawie, poza drogami, do {{field.radius}} hexów od Farmy.',
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
              'Sprawdź postawę: [[article:stances|Postawy]]. W Ignorowaniu nie rusza się z miejsca i bije tylko w zasięgu broni. Atak i rozkaz działają tylko wobec plemienia, do którego masz stosunek "Wrogi", i tylko poza "Czasem pokoju".',
            ],
            [
              'Statek nie wypływa',
              'Stan "Czeka na dowódcę": przydziel dowódcę, może nim być każdy dorosły. "Czeka na załogę": ktoś przypisany jeszcze idzie do drzwi, a osadnik z innego lądu wypada z załogi. Komunikat "Brak trasy" oznacza, że cel nie leży na tej wodzie. Statek nie zabierze nikogo na morzu, najpierw "Zacumuj".',
            ],
            [
              'Zaprzęg stoi',
              'Stan "Czeka na zwierzę pociągowe". Wóz bierze [[good:cattle|Wołu]] z twojego stada na tym samym lądzie, ale każda Ferma zachowuje {{livestock.pair}} dorosłe sztuki. Potrzebne są {{livestock.pairPlusOne}} dorosłe sztuki w jednej Fermie albo {{livestock.pairPlusOne}} poza Fermą. Dopiero potem można przydzielić dowódcę.',
            ],
          ],
        },
        {
          h: 'Pogoda',
        },
        {
          faq: [
            [
              'Czy deszcz, śnieg albo noc coś zmieniają?',
              'Nie. Pogoda, ustawienie "Zima" i pora dnia to tylko obraz i dźwięk. Ludzie, praca, pola i walka działają tak samo. Wolniej chodzi się tylko po terenie mapy: piasku, górach i śniegu, który na niej leży od początku.',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
