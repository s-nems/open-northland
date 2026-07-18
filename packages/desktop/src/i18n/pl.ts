import type { Messages } from './en.js';

/**
 * The installer's Polish catalog, structurally checked against {@link Messages}. Unlike the game's
 * app catalog — where a later i18n pass owns Polish and new strings ship in English — the installer's
 * Polish is authored here directly, since this surface targets the (Polish-community) CulturesNation
 * mod and the EN/PL pair was requested up front.
 */
export const pl = {
  setup: {
    title: 'Open Northland — pierwsze uruchomienie',
    introHtml:
      'Open Northland to darmowa reimplementacja gry <em>Cultures — 8th Wonder of the World</em>. Nie ' +
      'zawiera żadnej grafiki ani dźwięków gry: przy tym pierwszym uruchomieniu konwertuje zasoby Twojej ' +
      'własnej kopii oryginalnej gry do swojego folderu danych. Wskaż folder, w którym zainstalowana jest ' +
      'gra (ten z plikiem <code>Game.exe</code> i katalogiem <code>DataX</code>), aby zacząć.',
    pathPlaceholder: 'Ścieżka do folderu z grą Cultures 8th Wonder…',
    browse: 'Przeglądaj…',
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
      withMod: 'Znaleziono grę (z modem culturesnation).',
      externalMod: 'Znaleziono grę. Używany mod CulturesNation z {path}.',
      noMod: 'Znaleziono grę — ale brakuje moda CulturesNation.',
      noArchives: 'Nie znaleziono tam archiwów gry (.lib) — wskaż folder zawierający Game.exe oraz DataX.',
    },
    status: {
      ready: 'Zawartość gry jest zainstalowana. Wygeneruj ją tutaj ponownie, jeśli chcesz świeżej konwersji.',
      staleRevision:
        'Twoja zawartość gry jest niekompletna lub została wygenerowana przez starszą wersję Open ' +
        'Northland — zalecane jest wygenerowanie jej ponownie.',
      staleSchema:
        'Twoja zawartość gry została wygenerowana przez niezgodną starszą wersję Open Northland — trzeba ' +
        'ją wygenerować ponownie przed graniem.',
    },
    run: {
      starting: 'Rozpoczynanie…',
      // Genitive plural "plików" for the running counter — a named approximation over Polish's full
      // plural rules (1 plik / 2 pliki / 5 plików), adequate for a progress line.
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
    },
    mod: {
      requiredHtml:
        'Darmowy mod społecznościowy <strong>CulturesNation</strong> jest wymagany do gry, a Twój folder ' +
        'gry go nie zawiera. Open Northland może pobrać go za Ciebie (~600 MB, z linku Google Drive serwisu ' +
        '<code>culturesnation.pl</code>) do swojego folderu danych — Twój folder gry pozostaje nienaruszony.',
      download: 'Pobierz mod',
      haveIt: 'Już go mam…',
      downloading: 'Pobieranie moda…',
      unpacking: 'Rozpakowywanie…',
      cancelled: 'Pobieranie anulowane.',
      downloadFailed: 'Pobieranie moda nie powiodło się: {message} — {fallback}',
      pickFailed: '{message} — {fallback}',
      fallbackNote:
        'Możesz pobrać mod samodzielnie z culturesnation.pl (strona z aktualnościami → CnMod), rozpakować ' +
        'zip i wskazać rozpakowany folder przyciskiem „Już go mam…”.',
    },
    language: {
      english: 'Angielski',
      polish: 'Polski',
    },
  },
  dialogs: {
    pickGameTitle: 'Wybierz folder z grą Cultures - 8th Wonder of the World',
    pickModTitle: 'Wybierz rozpakowany folder moda CulturesNation',
    leaveGame: 'Opuść grę',
    stay: 'Zostań',
    leaveGameMessage: 'Opuścić trwającą grę?',
    leaveGameDetail: 'Zapisywanie nie jest jeszcze dostępne — bieżąca sesja zostanie utracona.',
  },
  menu: {
    game: 'Gra',
    reinstall: 'Zainstaluj zawartość gry ponownie…',
    openDataFolder: 'Otwórz folder danych',
  },
  errors: {
    modStillDownloading: 'mod wciąż się pobiera — poczekaj na zakończenie',
    noArchives: 'nie znaleziono archiwów gry (.lib) w wybranym folderze',
    modRequired:
      'mod culturesnation jest wymagany — pobierz go poniżej lub wskaż kreatorowi rozpakowaną kopię',
    modDownloadRunning: 'pobieranie moda już trwa',
    noDataCnmd: 'nie znaleziono tam DataCnmd/ — wskaż rozpakowany folder moda (pobierz go z {url})',
    incompatibleSchema:
      'zawartość została wygenerowana dla niezgodnego schematu — najpierw wygeneruj ją ponownie',
  },
} as const satisfies Messages;
