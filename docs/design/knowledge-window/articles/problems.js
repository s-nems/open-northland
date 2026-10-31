export const GROUP = {
  group: 'Problemy',
  items: [
    {
      id: 'why',
      name: 'Dlaczego to nie działa?',
      lead: 'Zaznacz budynek albo osadnika i przeczytaj jego pasek stanu.',
      blocks: [
        { h: 'Praca i produkcja' },
        {
          faq: [
            [
              'Warsztat stoi pusty',
              'Stan "Brak pracowników": nikt nie ma tam posady. Osadnik wchodzi tylko z właściwym zawodem i wolnym miejscem, inaczej komunikat powie "Nie ten zawód", "Brak miejsc" albo "Za mało wprawy". Stan "Bezczynny" podaje brakujący surowiec. Pracownik sam po niego chodzi, jeśli leży do 40 kroków od drogowskazu.',
            ],
            [
              'Płatnerz, Kowal albo Krawiec nie pracuje',
              'Religia w "Samopoczucie" ma 0%. Partia broni lub zbroi kosztuje 15% albo 30%, modlitwa daje 40%. Komunikat "Chce się modlić" oznacza brak miejsca modlitwy: potrzebna [[building:work_temple|Świątynia]], [[building:headquarters|Kwatera główna]] albo święty ogień w domu. Krawiec sam się nie modli, wydaj mu rozkaz "Módl się".',
            ],
            [
              'Tragarze nic nie noszą',
              'Tragarz nosi tylko z posadą w budynku. Stan "Nic do przeniesienia w zasięgu": do 32 kroków od budynku, a z flagą roboczą od flagi, nie ma towaru do zabrania. "Brak miejsca przyjmującego towar" to pełne magazyny.',
            ],
            [
              'Hodowla stoi',
              'Hodowca rozmnaża przy dokładnie 2 dorosłych sztukach gatunku. Stan Fermy mówi "Brak zwierząt", "Tylko jedno zwierzę", "Młode dorastają" albo "Stado pełne": [[article:livestock|Hodowla]].',
            ],
            [
              'Myśliwy nic nie przynosi',
              'Stan "Brak wolnej zwierzyny w terenie łowieckim": do 50 kroków od flagi roboczej albo miejsca pracy nie ma zwierzyny. Na Wilka, Lwa, Niedźwiedzia, Słonia, Psa i Kurczaka nie poluje. Przenieś flagę roboczą tam, gdzie pasie się zwierzyna.',
            ],
          ],
        },
        { h: 'Ludzie' },
        {
          faq: [
            [
              'Nie rodzą się dzieci',
              'Para potrzebuje wspólnego domu i 2 sztuk jedzenia w spiżarni. Komunikaty: "Mąż nie wraca" (mąż jest Kupcem, Zwiadowcą, żołnierzem albo bohaterem), "Para bez domu", "Dom w budowie", "Osobne domy", "Brak jedzenia". Licznik "Narodziny" w Asystencie składa zamówienia. Więcej: [[article:family|Rodzina i dom]].',
            ],
            [
              'Głód przy pełnym magazynie',
              'Sprawdź "Minimum w magazynach": nikt nie weźmie towaru poniżej tej sumy, także na posiłek. Obniż minimum przy jedzeniu. Druga przyczyna to odległość: magazyn musi leżeć w zasięgu chodu osadnika, 50 kroków albo sieć drogowskazów.',
            ],
            [
              'Zawodu nie ma na liście w Szkole',
              'Lista pokazuje tylko kursy odkryte i dozwolone w tej misji. Wiersz bez wyboru podaje powód: "Już nauczone" albo "Nie można wyszkolić wybranych osadników w tej szkole". Kursy odkrywa [[article:exp-work|Doświadczenie w pracy]].',
            ],
          ],
        },
        { h: 'Budowa i pola' },
        {
          faq: [
            [
              'Budynek jest zablokowany',
              'W oknie budowy trafia do sekcji "Zablokowane". Podpowiedź "Wymagane odkrycia:" wymienia zawody i towary, a przy towarze doświadczenie w formie obecne/wymagane. "Niedostępne w tej misji" to zakaz mapy. Papier ze skrzyni stawia budynek także bez odkrycia: [[article:chests|Skrzynie i papiery]].',
            ],
            [
              'Budowa stoi',
              'Stan budowy mówi, czego brak: "brak materiałów", "dostawa w drodze" albo "brak budowniczego". Komunikat "Budowa czeka: towar" oznacza, że towaru nie ma w żadnym magazynie w zasięgu drogowskazów placu, 40 kroków od drogowskazu. Budowniczy sam nosi materiał.',
            ],
            [
              'Pole nie rośnie',
              'Rośnie tylko od podlewania przez [[job:farmer|Farmera]] z posadą na [[building:work_farm_00|Farmie]]. Farmer najpierw sieje, a podlewa dopiero przy 25 polach albo gdy nie ma gdzie siać. Pole dojrzewa po 4 podlewaniach, a jedno podlewanie obejmuje też 6 sąsiednich pól. Siew działa tylko na trawie, poza drogami, do 16 kroków od Farmy.',
            ],
          ],
        },
        { h: 'Wojsko i pojazdy' },
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
              'Stan "Czeka na zwierzę pociągowe". Wóz bierze [[good:cattle|Wołu]] z twojego stada na tym samym lądzie, ale każda Ferma zachowuje 2 dorosłe sztuki. Potrzebne są 3 dorosłe sztuki w jednej Fermie albo 3 poza Fermą. Dopiero potem można przydzielić dowódcę.',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
