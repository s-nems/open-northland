// The storyboard: each screen opens the live wireframe in one state and says what the owner judges there.
export const SCREENS = [
  {
    id: 'plan',
    title: 'Plan okna',
    state: { surface: 'plan' },
    intent:
      'Cała zawartość Wiedzy na jednej stronie. Tu zdecydujesz, czy struktura jest dobra, zanim ocenisz układy.',
    judge: [
      'Pięć kart: czy tak dzielić wiedzę',
      'Dodane od siebie: co zostaje, co wypada',
      'Pozostałe ekrany są klikalne: linki, wstecz i dalej, szukanie, tabele',
    ],
  },
  {
    id: 'overview',
    title: 'Drzewo produkcji',
    intent:
      'Domyślny widok po F7. Całe drzewo towarów w pasach tematycznych, od surowców po lewej do wyrobów po prawej.',
    judge: [
      'Czy pasy tematyczne i etapy czytają się lepiej niż jeden wielki graf',
      'Czy okno 1240 px szerokości wystarczy, czy wolisz pełny ekran',
      'Linie są przygaszone, dopóki nic nie wybierzesz. Czy to dobra równowaga',
    ],
    data: [
      "Receptury, budynki i nazwy z danych gry, ikony to prawdziwe sprite'y towarów",
      'Przydział towaru do pasa to nasza tabela, oparta na sekcjach drzewa technologii z oryginału',
    ],
  },
  {
    id: 'chain',
    title: 'Wybrany łańcuch',
    state: { entry: { kind: 'good', id: 'potion_heal_big' }, onlyChain: true },
    intent: 'Wybór towaru zwija drzewo do jego łańcucha. Prawa kolumna odpowiada na pytania gracza.',
    judge: [
      'Czy prawa kolumna to właściwe pytania: jak zdobyć, koszt w surowcach, do czego służy',
      'Czy zwijać od razu, czy zostawić całe drzewo z podświetleniem. Przycisk Pokaż całość przełącza',
      'Bursztyn to z czego powstaje, zieleń to dalsze użycie',
    ],
    data: ['Koszt w surowcach liczony z receptur, nie wpisany ręcznie'],
  },
  {
    id: 'buildings',
    title: 'Drzewo budynków',
    state: { lens: 'buildings', entry: { kind: 'building', id: 'work_smithy_01' } },
    intent: 'Ten sam ekran, inny widok: poziomy budynków i co blokuje następny krok w tej osadzie.',
    judge: [
      'Czy zablokowany i poza mapą są wystarczająco różne',
      'Oryginał ma tu dziesięć sekcji technologii. Tu pięć grup, bo Wojsko i warsztaty czytają się razem. Zostawić?',
    ],
    data: ['Stan zablokowania to przykładowa osada, w grze czytany z odkryć gracza i uprawnień mapy'],
  },
  {
    id: 'jobs',
    title: 'Drzewo zawodów',
    state: { lens: 'jobs', entry: { kind: 'job', id: 'smith' } },
    intent: 'Skąd bierze się dany zawód. Doświadczenie na poprzednim otwiera następny dla całej osady.',
    judge: ['Czy to jest czytelne jako drzewo', 'Dwie drogi nauki, praktyka i szkoła, pokazane po prawej'],
    data: [
      'Z wymagań plemienia w danych gry. Wikingowie, pozostałe plemiona mają tyle samo wierszy, do sprawdzenia przy budowie',
    ],
  },
  {
    id: 'good',
    title: 'Hasło: towar',
    state: { tab: 'encyclopedia', category: 'goods', entry: { kind: 'good', id: 'tool_iron' } },
    intent:
      'Encyklopedia ma trzy kolumny: kategoria, lista, hasło. Tu trafia też znak zapytania z karty budowy.',
    judge: [
      'Czy pokazywać opis z oryginału. Część jego liczb jest nieaktualna, np. wózek 10 towarów przy 15 w danych',
      'Ile miejsca dać opisowi, a ile liczbom',
    ],
    data: ['Opisy z plików pomocy CNMod. Pipeline ich jeszcze nie wyciąga'],
  },
  {
    id: 'building',
    title: 'Hasło: budynek zablokowany',
    state: { tab: 'encyclopedia', category: 'buildings', entry: { kind: 'building', id: 'work_smithy_01' } },
    intent:
      'Stan zablokowania z powodem na górze hasła. Link do brakującego zawodu lub towaru prowadzi dalej.',
    judge: ['Czy powód blokady jest tam, gdzie go szukasz', 'Co jeszcze powinno być na karcie budynku'],
  },
  {
    id: 'matrix',
    title: 'Broń i pancerz',
    state: { tab: 'tables', table: 'matrix' },
    intent:
      'Główna tabela detali. Przełączniki pokazują obrażenia, ciosy do śmierci albo obrażenia na sekundę, z kierunkiem ciosu, doświadczeniem i amuletami.',
    judge: [
      'Czy kalkulator modyfikatorów jest potrzebny, czy wystarczy goła tabela',
      'Zmień plemię w pasku: wiersze się różnią, np. długa włócznia bohatera i łuki',
      'Na sekundę to wyliczenie z długości animacji, nie pomiar z gry',
    ],
    data: [
      'Obrażenia i zasięgi z danych broni',
      'Tempo z animacji ataku danego zawodu',
      'Kolejność liczenia taka jak w symulacji',
    ],
  },
  {
    id: 'article',
    title: 'Mechanika: artykuł',
    state: { tab: 'mechanics', article: 'tools' },
    intent: 'Reguły opisane po ludzku, z małą tabelą przy regule. Spis po lewej to pełna lista 25 tematów.',
    judge: [
      'Przejrzyj listę tematów po lewej: czego brakuje, co wyrzucić',
      'Narzędzia i Obrażenia są napisane do końca, reszta to szkice z liczbami',
      'Ton tekstu: czy tak ma mówić gra',
    ],
    data: ['Liczby z kodu symulacji i danych. W grze będą wstawiane ze stałych, nie wpisane w tekst'],
  },
  {
    id: 'howto',
    title: 'Jak grać i problemy',
    state: { tab: 'howto', howto: 'why' },
    intent: 'Moja propozycja dodatku: odpowiedzi na typowe zacięcia. Pierwsze kroki i sterowanie obok.',
    judge: ['Czy chcesz tę sekcję', 'Czy powiadomienia o problemach mają tu linkować'],
  },
  {
    id: 'search',
    title: 'Szukanie',
    state: { query: 'miecz' },
    intent: 'Jedno pole dla całej Wiedzy. Wpisz coś w polu u góry, działa bez polskich znaków.',
    judge: ['Czy wyniki w grupach wystarczą'],
  },
  {
    id: 'menu',
    title: 'Menu główne',
    state: { surface: 'menuHome', mode: 'menu' },
    intent:
      'Nowa pozycja między Katalogiem map a Ustawieniami. Kliknij ją: to samo okno, bez stanu osady, z wyborem plemienia.',
    judge: [
      'Miejsce pozycji w menu',
      'W menu nie ma działającej gry, więc Wiedza pobiera dane gry przy pierwszym otwarciu i potrzebuje stanu ładowania',
    ],
  },
  {
    id: 'small',
    title: 'Najmniejszy ekran',
    state: { frame: 'min', entry: { kind: 'good', id: 'bread' } },
    intent: 'Najmniejsza płaszczyzna interfejsu. Okno zakrywa wtedy minimapę, bo inaczej miałoby 730 px.',
    judge: ['Czy zakrycie minimapy na małych ekranach jest do przyjęcia'],
  },
];

const TAB_SUMMARY = [
  [
    'Produkcja',
    [
      'Towary: 63 towary w 8 pasach, od surowca do wyrobu',
      'Budynki: poziomy i rozbudowa',
      'Zawody: kto otwiera kogo',
    ],
  ],
  [
    'Encyklopedia',
    [
      'Towary, budynki, zawody',
      'Broń i pancerze, pojazdy',
      'Zwierzęta, plemiona',
      'Świat: skrzynie, papiery, teren',
    ],
  ],
  [
    'Mechaniki',
    ['25 artykułów', 'Osadnicy, gospodarka, wojsko, świat', 'Reguły po ludzku, liczby przy regule'],
  ],
  [
    'Tabele',
    [
      '15 tabel do wertowania',
      'Broń × pancerz z kalkulatorem',
      'Narzędzia, mikstury, amulety',
      'Budynki, domy, pojazdy, zwierzęta',
    ],
  ],
  ['Jak grać', ['Pierwsze kroki', 'Sterowanie, z klawiszami gracza', 'Dlaczego to nie działa?']],
];

const list = (items) => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

export const PLAN_PAGE = `<div class="wf-plan">
  <h1>Wiedza</h1>
  <p>Jedno okno w grze (F7, znaki zapytania, Wiedza na karcie budynku) i ten sam ekran w menu głównym. Tylko czytanie: nic stąd nie wydaje rozkazów.</p>
  <div class="wf-plan__tabs">${TAB_SUMMARY.map(([name, items]) => `<section class="wf-plan__tab"><h2>${name}</h2>${list(items)}</section>`).join('')}</div>
  <div class="wf-plan__cols">
    <section><h2>Dodałem od siebie</h2>${list([
      '<b>Dlaczego to nie działa?</b> Odpowiedzi na typowe zacięcia, np. głód przy pełnym magazynie.',
      '<b>Stan mojej osady:</b> co masz, co zablokowane i czego dokładnie brakuje.',
      '<b>Koszt w surowcach</b> przy każdym towarze.',
      '<b>Kalkulator ciosu:</b> kierunek, doświadczenie, amulety, ciosy do śmierci, obrażenia na sekundę.',
      '<b>Budynki i zawody</b> jako osobne drzewa, nie tylko towary.',
      '<b>Różnice plemion:</b> jeden wybór w pasku zmienia tabele.',
      '<b>Zwierzęta, skrzynie, mgła</b> jako pełnoprawne hasła.',
      '<b>Wstecz, dalej, poprzednie, następne</b> jak w pomocy oryginału, plus szukanie po wszystkim.',
    ])}</section>
    <section><h2>Grafika po akceptacji układu</h2>${list([
      '5 ikon kart w stylu obecnego atlasu menu',
      '8 medalionów pasów produkcji: kłos, baran, kłoda, glina, kamień, ruda, moździerz, tarcza',
      'Tło drzewa. Najpierw próba z welinem księgi misji, nowe tylko jeśli nie zagra',
      'Ramka karty towaru w drzewie',
      'Schematy w artykułach, np. kierunek ciosu: rysowane w SVG, nie generowane',
      "Towary, budynki i ludzie zostają sprite'ami z gry, tak każe zasada HUD",
    ])}</section>
    <section><h2>Decyzje dla Ciebie</h2>${list([
      '<b>Rozmiar:</b> polecam duże okno 1240 px, gra widoczna dookoła. Inaczej pełny ekran.',
      '<b>Wybór towaru:</b> polecam zwijanie do łańcucha.',
      '<b>Opisy z oryginału:</b> polecam pokazywać, liczby brać zawsze z danych. Stare liczby w tekstach trzeba poprawić.',
      '<b>Kiełbasa:</b> nikt jej nie wytwarza w danych. Ukryć ją w drzewie?',
      '<b>Cuda:</b> w grze nic nie dają. Opisać je tak szczerze, czy pominąć?',
    ])}</section>
  </div>
</div>`;
