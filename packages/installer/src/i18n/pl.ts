import type { Messages } from './en.js';

export const pl = {
  setup: {
    title: 'Open Northland - pierwsze uruchomienie',
    introHtml:
      'Open Northland to darmowa reimplementacja gry <em>Cultures - 8th Wonder of the World</em>. Nie ' +
      'zawiera żadnej grafiki ani dźwięków gry: przy tym pierwszym uruchomieniu konwertuje zasoby Twojej ' +
      'własnej kopii oryginalnej gry do swojego folderu danych. Wskaż folder, w którym zainstalowana jest ' +
      'gra (ten z plikiem <code>the original</code> i katalogiem <code>DataX</code>), aby zacząć.',
    pathPlaceholder: 'Ścieżka do folderu z grą Cultures 8th Wonder…',
    dropPrompt: 'Przeciągnij tutaj folder z grą Cultures 8th Wonder',
    browserStorage: 'prywatnym magazynie tej przeglądarki',
    browse: 'Przeglądaj…',
    readingFolder: 'Odczytywanie folderu…',
    detected: 'Znalezione na tym komputerze:',
    install: 'Zainstaluj zawartość gry',
    regenerate: 'Wygeneruj zawartość gry ponownie',
    play: 'Graj',
    playAnyway: 'Graj mimo to',
    cancel: 'Anuluj',
    back: 'Wstecz',
    installed: 'Zawartość gry zainstalowana.',
    legalHtml:
      'Twoje oryginalne pliki gry są tylko odczytywane, nigdy modyfikowane. Skonwertowane dane pozostają ' +
      'na tym komputerze w <code id="data-root"></code>.',
    probe: {
      withMod: 'Znaleziono grę (z modem CulturesNation).',
      externalMod: 'Znaleziono grę. Używany mod CulturesNation z {path}.',
      noMod: 'Znaleziono grę - ale brakuje moda CulturesNation.',
      noArchives: 'Nie znaleziono tam archiwów gry (.lib) - wskaż folder zawierający the original oraz DataX.',
    },
    status: {
      ready: 'Zawartość gry jest zainstalowana. Wygeneruj ją tutaj ponownie, jeśli chcesz świeżej konwersji.',
      staleRevision:
        'Twoja zawartość gry jest niekompletna lub została wygenerowana przez starszą wersję Open ' +
        'Northland - zalecane jest wygenerowanie jej ponownie.',
      staleSchema:
        'Twoja zawartość gry została wygenerowana przez niezgodną starszą wersję Open Northland - trzeba ' +
        'ją wygenerować ponownie przed graniem.',
    },
    run: {
      starting: 'Rozpoczynanie…',
      // Approximation: a fixed genitive plural instead of Polish's 1 plik / 2 pliki / 5 plików rule.
      files: '{done} plików',
      failed: 'Instalacja zawartości gry nie powiodła się.',
    },
    stages: {
      unpack: 'Rozpakowywanie archiwów gry',
      pictures: 'Konwertowanie obrazów',
      atlases: "Budowanie atlasów sprite'ów",
      'player-colors': 'Budowanie kolorów graczy',
      gui: 'Konwertowanie grafiki interfejsu',
      fonts: 'Konwertowanie czcionek',
      goods: 'Konwertowanie ikon towarów',
      ir: 'Wyodrębnianie reguł gry',
      transitions: 'Składanie przejść terenu',
      maps: 'Dekodowanie map',
      music: 'Renderowanie ścieżki dźwiękowej',
    },
    mod: {
      requiredUpstreamHtml:
        'Darmowy mod społecznościowy <strong>CulturesNation</strong> jest wymagany do gry, a Twój folder ' +
        'gry go nie zawiera. Open Northland może pobrać go za Ciebie (~600 MB, z linku Google Drive serwisu ' +
        '<code>culturesnation.pl</code>) do swojego folderu danych - Twój folder gry pozostaje nienaruszony.',
      requiredOriginHtml:
        'Darmowy mod społecznościowy <strong>CulturesNation</strong> jest wymagany do gry, a Twój folder ' +
        'gry go nie zawiera. Open Northland może pobrać go za Ciebie (~600 MB, z tej strony) do magazynu ' +
        'tej przeglądarki - Twój folder gry pozostaje nienaruszony.',
      download: 'Pobierz mod',
      haveIt: 'Już go mam…',
      downloading: 'Pobieranie moda…',
      unpacking: 'Rozpakowywanie…',
      cancelled: 'Pobieranie anulowane.',
      downloadFailed: 'Pobieranie moda nie powiodło się: {message} - {fallback}',
      pickFailed: '{message} - {fallback}',
      fallbackFolder:
        'Możesz pobrać mod samodzielnie z culturesnation.pl (strona z aktualnościami → CnMod), rozpakować ' +
        'zip i wskazać rozpakowany folder przyciskiem „Już go mam…”.',
      fallbackArchive:
        'Możesz pobrać mod samodzielnie z culturesnation.pl (strona z aktualnościami → CnMod) i wskazać ' +
        'pobrany plik zip przyciskiem „Już go mam…”.',
    },
    language: {
      english: 'Angielski',
      polish: 'Polski',
    },
  },
  dialogs: {
    pickGameTitle: 'Wybierz folder z grą Cultures - 8th Wonder of the World',
    pickModTitle: 'Wybierz rozpakowany folder moda CulturesNation',
    saveGameTitle: 'Zapisz do pliku',
    loadGameTitle: 'Wczytaj zapisaną grę',
    saveFileFilter: 'Zapis Open Northland',
    leaveGame: 'Opuść grę',
    stay: 'Zostań',
    leaveGameMessage: 'Opuścić trwającą grę?',
    leaveGameDetail: 'Niezapisany postęp przepadnie - możesz najpierw zapisać grę w menu gry.',
  },
  menu: {
    game: 'Gra',
    reinstall: 'Zainstaluj zawartość gry ponownie…',
    openDataFolder: 'Otwórz folder danych',
  },
  errors: {
    modStillDownloading: 'mod wciąż się pobiera - poczekaj na zakończenie',
    noArchives: 'nie znaleziono archiwów gry (.lib) w wybranym folderze',
    modRequired:
      'mod CulturesNation jest wymagany - pobierz go poniżej lub wskaż kreatorowi rozpakowaną kopię',
    modDownloadRunning: 'pobieranie moda już trwa',
    noDataCnmd: 'nie znaleziono tam DataCnmd/ - wskaż rozpakowany folder moda (pobierz go z {url})',
    incompatibleSchema:
      'zawartość została wygenerowana dla niezgodnego schematu - najpierw wygeneruj ją ponownie',
    contentMissing: 'nie ma jeszcze przekonwertowanej zawartości gry - najpierw ją zainstaluj',
    noServiceWorker:
      'ta przeglądarka nie uruchomi dla tej strony service workera, więc nie da się podać ' +
      'przekonwertowanej zawartości gry. Okna prywatne zwykle to blokują - spróbuj w zwykłym oknie.',
    noStorage:
      'ta przeglądarka nie daje stronie prywatnego magazynu, więc nie ma gdzie zapisać ' +
      'przekonwertowanej zawartości gry.',
    storageFull:
      'przeglądarce zabrakło miejsca dla tej strony przed końcem konwersji. Zwolnij miejsce na ' +
      'dysku i zacznij instalację od nowa.',
    notEnoughStorage:
      'konwersja potrzebuje około {needed} GB magazynu przeglądarki, a dla tej strony dostępne ' +
      'jest tylko {available} GB. Zwolnij miejsce na dysku i odśwież stronę.',
    conversionElsewhere: 'inna karta tej strony już konwertuje - dokończ ją lub zamknij',
    modInstallElsewhere: 'mod już się instaluje - najpierw dokończ tamtą instalację',
    modArchiveUnavailable: 'ta strona nie udostępniła archiwum moda ({status})',
    pipelineRunning: 'konwersja już trwa',
    pipelineWorkerCrashed: 'konwerter nieoczekiwanie się zatrzymał - odśwież stronę i spróbuj ponownie',
    notAFolder: 'to jest plik, a nie folder - przeciągnij folder, w którym zainstalowana jest gra',
    setupFailed: 'nie udało się uruchomić instalatora: {message}',
  },
} as const satisfies Messages;
