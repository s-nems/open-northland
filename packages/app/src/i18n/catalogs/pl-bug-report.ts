export const plBugReport = {
  titles: {
    manual: 'Zgłoś błąd',
    error: 'W grze wystąpił błąd',
    'sim-stall': 'Gra stanęła',
    'main-freeze': 'Gra się zawiesiła',
    'unclean-exit': 'Gra nieoczekiwanie się zamknęła',
    'renderer-gone': 'Gra uległa awarii',
    'renderer-unresponsive': 'Gra przestała odpowiadać',
    desync: 'Gra straciła synchronizację',
    'context-lost': 'Grafika przestała działać',
    'gpu-gone': 'Grafika została uruchomiona ponownie',
  },
  explanations: {
    manual: 'Opisz, co poszło nie tak. Czytamy każde zgłoszenie i każde pomaga naprawić grę.',
    error: 'Coś w grze zawiodło. Gra może działać dalej, ale od teraz może zachowywać się dziwnie.',
    'sim-stall': 'Świat przestał się poruszać. Może pomóc wczytanie zapisu lub odświeżenie strony.',
    'main-freeze': 'Strona przez jakiś czas nie odpowiadała.',
    'unclean-exit':
      'Ostatnia gra nie zakończyła się poprawnie, prawdopodobnie z powodu awarii lub zawieszenia.',
    'renderer-gone': 'Strona gry uległa awarii i została uruchomiona ponownie.',
    'renderer-unresponsive': 'Strona gry przez jakiś czas nie odpowiadała.',
    desync:
      'Twoja gra nie zgadza się już z grami pozostałych graczy, więc rozgrywka nie może dalej toczyć się bez błędów.',
    'context-lost':
      'Przeglądarka odebrała grze grafikę i jej nie oddała. Odśwież stronę; jeśli to nie pomoże, zamknij całkiem grę albo przeglądarkę i uruchom ją ponownie.',
    'gpu-gone':
      'Część gry odpowiedzialna za grafikę przestała działać i została uruchomiona ponownie. Gra już działa; zgłoszenie pomoże ustalić przyczynę.',
  },
  fatalTitle: 'Gra nie może działać dalej',
  fatalExplanation:
    'Błąd zatrzymał grę. Wyślij lub pobierz zgłoszenie, a potem odśwież stronę. Później możesz wczytać ostatni zapis.',
  reload: 'Odśwież',
  status: {
    preparing: 'Przygotowuję zgłoszenie…',
    sending: 'Wysyłam zgłoszenie…',
    sent: 'Zgłoszenie wysłane, nr {number}.',
    counted:
      'Ten problem jest już znany: serwer go policzył, ale nie zachował kolejnej kopii. Jeśli chcesz coś dodać, napisz komentarz i wyślij go jako nowe zgłoszenie.',
    queued: 'Nie udało się wysłać zgłoszenia. Gra spróbuje ponownie później.',
    full: 'Serwer zgłoszeń jest teraz pełny. Pobierz zgłoszenie i prześlij je w inny sposób.',
    rejected: 'Serwer nie przyjął zgłoszenia. Pobierz je i prześlij w inny sposób.',
    unsupported: 'Ta przeglądarka nie potrafi wysyłać zgłoszeń. Pobierz zgłoszenie.',
    expired: 'Nie udało się wysłać zgłoszenia. Pobierz je i prześlij w inny sposób.',
    unsent: 'Nic jeszcze nie zostało wysłane.',
    limited:
      'To zgłoszenie nie zostało wysłane automatycznie, bo gra wysłała już ich dość w tej sesji. Możesz wysłać je samodzielnie.',
  },
  additionsHint: 'Możesz dodać do niego komentarz i więcej plików.',
  additions: {
    sending: 'Wysyłam uzupełnienie…',
    sent: 'Dziękujemy, uzupełnienie zostało wysłane.',
    queued: 'Nie udało się wysłać uzupełnienia. Gra spróbuje ponownie później.',
    failed: 'Nie udało się wysłać uzupełnienia. Pobierz zgłoszenie.',
  },
  thanks: 'Dziękujemy! Zgłoszenie nr {number} dotarło.',
  more: {
    one: 'Od tego czasu wystąpił jeszcze {count} problem.',
    few: 'Od tego czasu wystąpiły jeszcze {count} problemy.',
    many: 'Od tego czasu wystąpiło jeszcze {count} problemów.',
  },
  comment: 'Komentarz (opcjonalnie)',
  commentPlaceholder: 'Co działo się tuż przed tym?',
  description: 'Co się stało?',
  descriptionHint:
    'Opisz po kolei, co prowadzi do błędu, jaki był oczekiwany efekt i co stało się zamiast tego.',
  descriptionRequired: 'Najpierw opisz problem.',
  countedNeedsWords: 'Najpierw napisz komentarz lub podaj kontakt; zostanie wysłany jako nowe zgłoszenie.',
  alsoSendHeld: {
    one: 'Wyślij też zgłoszenie {count} kolejnego problemu',
    few: 'Wyślij też zgłoszenia {count} kolejnych problemów',
    many: 'Wyślij też zgłoszenia {count} kolejnych problemów',
  },
  earlierError: {
    title: 'W poprzedniej sesji wystąpił błąd',
    explanation:
      'W poprzedniej sesji coś w grze zawiodło. Gra została od tego czasu uruchomiona ponownie i powinna działać normalnie.',
  },
  earlierNote: 'To wydarzyło się w poprzedniej sesji.',
  contact: 'Kontakt (opcjonalnie)',
  contactPlaceholder: 'E-mail lub nazwa na Discordzie',
  contactHint: 'Tylko jeśli chcesz dostać odpowiedź. To jedyne dane osobowe w zgłoszeniu.',
  attachments: 'Załącz',
  attachment: {
    commands: 'Dziennik poleceń do odtworzenia gry',
    settings: 'Ustawienia gry',
    screenshot: 'Zrzut ekranu',
    save: 'Najnowszy autozapis',
  },
  shortened: 'tylko ostatnia część',
  included: 'już wysłane',
  large: 'duży plik',
  overCap: 'Za duże razem z pozostałymi plikami.',
  preview: 'Pokaż, co zostanie wysłane',
  send: 'Wyślij',
  sendAdditions: 'Wyślij uzupełnienie',
  download: 'Pobierz',
  close: 'Zamknij',
  privacy:
    'Zgłoszenie zawiera dane techniczne o grze i komputerze oraz to, co tu wpiszesz. Adres IP nie jest zapisywany.',
  sizeKb: '{size} KB',
  sizeMb: '{size} MB',
} as const;
