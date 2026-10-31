// The storyboard: each screen opens the live wireframe in one state and says what the owner judges there.
export const SCREENS = [
  {
    id: 'plan',
    title: 'Plan okna',
    state: { surface: 'plan' },
    intent: 'Cała zawartość Wiedzy po Twoich uwagach. Cztery karty zamiast pięciu.',
    judge: ['Czy podział na cztery karty jest dobry', 'Lista otwartych decyzji na dole'],
  },
  {
    id: 'overview',
    title: 'Drzewo towarów',
    intent:
      'Nowy układ. Linia łączy kartę tylko z jej głównym składnikiem w tym samym pasie, więc linie się nie krzyżują. Pozostałe składniki są na karcie jako ikony.',
    judge: [
      'Wskaż kartę: cały łańcuch się podświetla, reszta gaśnie, a linie spoza pasa pojawiają się na chwilę',
      'Karta pokazuje pełny przepis ikonami, np. Długi Miecz: 2 żelaza i drewno',
      'Suwak skali w prawym dolnym rogu, działa też Ctrl + kółko',
      'Kliknięcie otwiera hasło, Wróć wraca w to samo miejsce drzewa',
    ],
    data: [
      'Przepisy z danych gry. Przydział do pasa i główny składnik to nasza tabela, w grze sprawdzana testem',
      'Ikon nie ma tylko Zdobycz: gra nie ma dla niej rysunku, trzeba go dorobić',
    ],
  },
  {
    id: 'chain',
    title: 'Podświetlony łańcuch',
    point: 'good:amulet_speed',
    intent:
      'Tak wygląda wskazanie towaru z innego pasa. Amulet Wiatru bierze żelazo, złoto i buty, więc widać trzy pasy naraz.',
    judge: ['Czy linie pokazane tylko po wskazaniu wystarczą', 'Czy kolory są czytelne'],
  },
  {
    id: 'buildings',
    title: 'Drzewo budynków',
    state: { tab: 'buildings' },
    intent:
      'Ten sam układ. Farma, młyn, piekarnia i dalej w jednym ciągu. Ferma bydła obok zakładu krawieckiego, bo oba otwiera myśliwy.',
    judge: [
      'Czy ciągi odpowiadają temu, co opisałeś',
      'Wskaż budynek: oprócz ciągu świecą warsztaty, których zawodów wymaga',
      'Stan mojej osady wyszarza zablokowane i pisze, czego brakuje',
    ],
    data: ['Stan zablokowania to przykładowa osada, w grze czytany z odkryć gracza i uprawnień mapy'],
  },
  {
    id: 'weapon',
    title: 'Hasło: broń',
    state: { tab: 'encyclopedia', category: 'arms', entry: { kind: 'good', id: 'sword_long' } },
    intent:
      'Tabele są teraz przy samej broni: obrażenia przeciw każdemu pancerzowi, ciosy do śmierci, na sekundę, bonusy, szybkość marszu.',
    judge: [
      'Czy to właściwy zestaw liczb',
      'Zmień plemię w pasku: liczby są dla wybranego plemienia',
      'Animacja ciosu i marszu to klatki z arkuszy gry, w oknie będzie żywy sprite',
    ],
    data: ['Na sekundę to wyliczenie z długości animacji ciosu, nie pomiar z gry'],
  },
  {
    id: 'armour',
    title: 'Hasło: pancerz',
    state: { tab: 'encyclopedia', category: 'arms', entry: { kind: 'good', id: 'armor_chain' } },
    intent: 'Odwrotna tabela: co każda broń robi z tym pancerzem.',
    judge: ['Czy kolumna Zatrzymuje jest potrzebna'],
  },
  {
    id: 'animal',
    title: 'Hasło: zwierzę',
    state: { tab: 'encyclopedia', category: 'animals', entry: { kind: 'animal', id: '8' } },
    intent: 'Pełne statystyki zwierzęcia, jego atak i ile trzeba, żeby je zabić.',
    judge: [
      'Czego tu brakuje',
      'Czas zabicia zakłada jednego napastnika, który cały czas trafia',
      'Dromader, Słoń, Dzika Koza, Koń, Gęś i Łabędź nie mają jeszcze obrazka',
    ],
  },
  {
    id: 'wonder',
    title: 'Cuda',
    state: {
      tab: 'encyclopedia',
      category: 'wonders',
      entry: { kind: 'building', id: 'wonder_pyramid_of_gizeh' },
    },
    intent: 'Cuda mają własną kategorię. W grze nic nie dają i hasło mówi to wprost.',
    judge: ['Czy tak ma zostać'],
    data: ['Miniatury wycięte z arkuszy budynków gry'],
  },
  {
    id: 'article',
    title: 'Mechanika: artykuł',
    state: { tab: 'mechanics', article: 'fog' },
    intent:
      'Mechaniki napisane od nowa: tabele zamiast punktów, liczby sprawdzone w kodzie. Tu Twój przykład, mgła i widzenie.',
    judge: [
      'Przejrzyj spis po lewej',
      'Doświadczenie ma teraz osobne działy na pracę i walkę',
      'Ton: czy dość suchy',
    ],
    data: ['Liczby z kodu symulacji i danych. W grze będą wstawiane ze stałych, nie wpisane w tekst'],
  },
  {
    id: 'matrix',
    title: 'Mechanika: broń i pancerz',
    state: { tab: 'mechanics', article: 'damage' },
    intent: 'Zbiorcza tabela z kalkulatorem jest teraz w artykule, nie w osobnej karcie.',
    judge: ['Czy kalkulator jest potrzebny skoro każda broń ma już swoją tabelę'],
  },
  {
    id: 'problems',
    title: 'Dlaczego to nie działa?',
    state: { tab: 'mechanics', article: 'why' },
    intent: 'To jedyne, co zostało z Jak grać. Sterowanie jest w ustawieniach, pierwsze kroki w samouczku.',
    judge: ['Czy powiadomienia o problemach mają tu linkować'],
  },
  {
    id: 'search',
    title: 'Szukanie',
    state: { query: 'miecz' },
    intent: 'Jedno pole dla całej Wiedzy, działa bez polskich znaków.',
    judge: ['Czy wyniki w grupach wystarczą'],
  },
  {
    id: 'menu',
    title: 'Menu główne',
    state: { surface: 'menuHome', mode: 'menu' },
    intent: 'Pozycja między Katalogiem map a Ustawieniami. To samo okno, bez stanu osady.',
    judge: ['Miejsce pozycji w menu'],
  },
  {
    id: 'small',
    title: 'Najmniejszy ekran',
    state: { frame: 'min' },
    intent: 'Najmniejsza płaszczyzna interfejsu. Okno zakrywa wtedy minimapę.',
    judge: ['Czy zakrycie minimapy na małych ekranach jest do przyjęcia'],
  },
];

const TAB_SUMMARY = [
  ['Towary', ['Drzewo od surowca do wyrobu', 'Pełny przepis na każdej karcie', 'Kliknięcie otwiera hasło']],
  ['Budynki', ['Ciągi odblokowań', 'Co otwiera następny budynek', 'Stan mojej osady']],
  [
    'Encyklopedia',
    [
      'Towary, uzbrojenie, budynki, cuda',
      'Zawody, pojazdy, zwierzęta, plemiona',
      'Przy broni i zwierzęciu pełne statystyki',
    ],
  ],
  ['Mechaniki', ['Osadnicy, doświadczenie, gospodarka', 'Wojsko, świat', 'Dlaczego to nie działa?']],
];

const list = (items) => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

export const PLAN_PAGE = `<div class="wf-plan">
  <h1>Wiedza</h1>
  <p>Jedno okno w grze (F7, znaki zapytania, Wiedza na karcie budynku) i ten sam ekran w menu głównym. Tylko czytanie: nic stąd nie wydaje rozkazów.</p>
  <div class="wf-plan__tabs">${TAB_SUMMARY.map(([name, items]) => `<section class="wf-plan__tab"><h2>${name}</h2>${list(items)}</section>`).join('')}</div>
  <div class="wf-plan__cols">
    <section><h2>Zmienione po Twoich uwagach</h2>${list([
      'Tabele nie mają karty: są przy broni, pancerzu i zwierzęciu oraz w artykułach.',
      'Zawody zniknęły z drzewa. Towary i Budynki to dwie karty.',
      'Drzewo przerobione: bez plątaniny linii, pasy bez przycisków skoku, suwak skali.',
      'Kliknięcie w drzewie otwiera hasło. Jeden przycisk Wróć działa wszędzie.',
      'Usunięte: Posiłek i Kiełbasa. Owoc i Ryba są tylko w Encyklopedii, bo w grze istnieją.',
      'Sterowanie i Pierwsze kroki usunięte, Dlaczego to nie działa? przeniesione do Mechanik.',
      'Doświadczenie podzielone na pracę i walkę, stopnie żołnierzy wypadły.',
    ])}</section>
    <section><h2>Przy budowie okna</h2>${list([
      'Ikona Zdobyczy, jedyna brakująca: gra nie ma rysunku',
      'Obrazki 6 zwierząt: Dromader, Słoń, Dzika Koza, Koń, Gęś, Łabędź',
      "Żywa animacja ciosu i marszu: sprite'y mają paletę w shaderze, więc to mały canvas renderera, nie obrazek",
      'Medaliony pasów i ikony kart w stylu atlasu menu',
      'Liczby w artykułach wstawiane ze stałych, nie wpisane w tekst',
      'Tłumaczenie artykułów na wszystkie języki gry',
    ])}</section>
    <section><h2>Decyzje dla Ciebie</h2>${list([
      '<b>Rozmiar:</b> polecam duże okno 1240 px, gra widoczna dookoła. Inaczej pełny ekran.',
      '<b>Opisy z oryginału:</b> polecam pokazywać, liczby brać zawsze z danych. Stare liczby w tekstach trzeba poprawić.',
      '<b>Kalkulator ciosu:</b> został w artykule o broni. Zostawić, skoro każda broń ma własną tabelę?',
      '<b>Brakujące tematy:</b> wyposażanie żołnierzy, wybór produktu w warsztacie, cele misji. Dopisać?',
      '<b>Owoc i Ryba:</b> w grze istnieją, więc są w Encyklopedii, choć nie w drzewie. Usunąć też stamtąd?',
    ])}</section>
  </div>
</div>`;
