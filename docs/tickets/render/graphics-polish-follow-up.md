# Graphics polish — przekazanie i dalszy eksperyment

**Area:** render · **Priority:** P3

## Cel i decyzje użytkownika

Poprawiać prezentację **oryginalnych assetów** Cultures w PixiJS, zachowując ich charakter.
Zgodność i korzyści dla `assets=own` są dodatkowym plusem, nie głównym celem.
Użytkownik wizualnie zaakceptował dotychczasowe ulepszenia, ale **odrzucił mieszanie klatek**
z powodu dziwnych, podwójnych konturów. Nie przywracać tej metody jako poprawy.

Użytkownik upoważnił do eksperymentów w osobnym worktree i commitowania postępów.
Nie upoważnił do integracji z `main`. Ostatnia prośba dotyczyła zapisania tego przekazania,
nie wdrożenia kolejnego etapu. Przy wznowieniu kierować się nowym poleceniem użytkownika.

## Gdzie kontynuować

- Worktree: `~/Projects/vikings/on-graphics-polish`.
- Gałąź: `experiment/graphics-polish`.
- Główne repo: `~/Projects/vikings/open-northland` — nie zmieniać jego lokalnych prac.
- Zawartość gry jest współdzielona tylko do odczytu przez
  `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`.
- Ostatnio zweryfikowany serwer: port **5175**, PID **58904**. To dane ostatniej sesji,
  nie gwarancja aktualnego procesu; ponownie sprawdzić tożsamość przed użyciem lub zatrzymaniem.
- Port 5173 jest zarezerwowany dla głównego checkoutu. Nie zatrzymywać innych serwerów.

Najpierw przeczytać root `AGENTS.md`, `CLAUDE.local.md`, kontrakty dotykanych pakietów oraz
[macierz testów](../../TESTING.md). Instrukcje podglądu i aktualny opis efektów są w
[DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews).

```bash
# Uruchamiać z eksperymentalnego worktree; jeśli serwer już działa, nie uruchamiać drugiego.
ON_CONTENT_DIR=~/Projects/vikings/open-northland/content npm run dev -- --port 5175

npm run dev:verify -- 'http://127.0.0.1:5175/?map=magiczny_las&assets=original&polish=on&zoom=2&sound=off&intro=off&fullscreen=off'
```

## Zachowany stan

Zaakceptowany kod jest w commitach:

- `2a7b94761`: przełączniki jakości, próbkowanie po rozwiązaniu palety, miękkie cienie,
  ulepszona prezentacja wody i własnej roślinności.
- `d61847c7a`: pozycjonowanie subpikselowe i filtrowanie pomniejszonego terenu.
- `2b1983509`: interpolacja przemieszczania oryginalnych ludzi i zwierząt, ruch ryb,
  detal budynków i terenu.

Eksperyment `c7a63e855` został w całości cofnięty przez `f9d72323b`.
Po cofnięciu `git diff 2b1983509 f9d72323b` był pusty. Historia pozostaje liniowa;
odrzucona implementacja jest dostępna w Git, ale nie w aktywnym kodzie.

Trzy zachowane opcje są domyślnie włączone w tej gałęzi i działają na żywo w ustawieniach grafiki.
`polish=on` włącza je wszystkie; `polish=off` wyłącza; `polish=sampling,shadows,motion`
pozwala wybrać podzbiór. Nie używać już usuniętego `frames`.

### Co rzeczywiście działa, a czego nie obiecywać

- Oryginalne postacie paletowe są wygładzane **po odczytaniu kolorów z palety**.
  Interpolowanie samych indeksów dawałoby błędne kolory gracza.
- Ludzie i zwierzęta mają płynniejsze pozycje pomiędzy tickami. Zwierzęta są wewnętrznie
  `DrawItem.kind === 'settler'`; oryginalne krowy mają `tribe: 10`, ludzie Wikingów `tribe: 1`.
- Nie wygenerowano dodatkowych oryginalnych klatek pracy, drzew ani mechanizmów.
  Ułamkowy zegar sam nie dodaje nowych póz. Ruch ryb ma ciągłe przesunięcia sinusoidalne.
- Teren: ograniczone do kafla próbkowanie przy pomniejszeniu; subtelne wyostrzenie
  nieprzezroczystego wnętrza przy zbliżeniu. Własne tekstury z mipmapami zachowują swój tor.
- Budynki gotowe: izolowane klatki z mipmapami i ograniczonym podbiciem detalu.
  Budowa/ulepszanie, cienie i już mipmapowane własne grafiki omijają tę obróbkę.
- Budżety: miękkie cienie 8 MiB RGBA GPU plus kopie CPU; budynki 32 MiB pełnych mipmap GPU
  plus kopie canvas. Brak dostępnych pikseli/przekroczenie limitów oznacza powrót do źródła.
  Pierwsze przetworzenie klatki jest synchroniczne i może chwilowo przyciąć.
- Nie zmieniono PNG źródłowych, ekstrakcji, jednostek mapy ani symulacji.

Właściciele kodu: `packages/render/src/gpu/` — `paletted-sprite/`, `terrain/`,
`sprite-pool/present-entity.ts`, `sprite-pool/presentation.ts`, `sprite-pool/bind-layers.ts`,
`building-texture-cache.ts`, `soft-shadow-cache.ts`, `texture-cache.ts`, `world-renderer/`.
Ustawienia: `packages/app/src/view/graphics-enhancements.ts`, `settings-store.ts`,
`settings-graphics-tab.ts` i `runtime/game-settings.ts` / `game-live-settings.ts`.

## Wnioski z weryfikacji

Zaakceptowany stan przeszedł build, check i testy pakietów app/render: **2629 passed, 2 skipped**.
Po cofnięciu eksperymentu potwierdzono identyczność drzewa z tym stanem, poprawność dokumentacji,
polityki assetów, tożsamość podglądu, aktywne trzy opcje oraz brak błędów konsoli.
Nie uruchamiano ponownie pełnej symulacji ani integracji z `main`.

Przegląd oryginałów wykonano przy ×2 i oddaleniu, również podczas przesuwania kamery.
Oryginalny człowiek i krowa miały różne pozycje renderowania w obrębie tego samego ticka;
własne grafiki sprawdzono dodatkowo pod kątem zgodności. Szczegółowe dane historyczne są
w commitach; nie traktować pojedynczego pomiaru jednej sceny jako gwarancji wydajności.

Odrzucone mieszanie było poprawnym matematycznie mieszaniem kolorów z uwzględnieniem alfa,
nie zwykłym nakładaniem półprzezroczystych sprite'ów. Mimo tego krowa miała podwójną głowę,
a wiatrak podwójne skrzydła. To ograniczenie metody, nie błąd premultiplikacji.
Testy techniczne nie zastępują akceptacji wizualnej.

## Scope

**Spójność jakości budynków w trakcie budowy i ulepszania z gotowym budynkiem.**

Zweryfikowana luka: nowa obróbka gotowych budynków świadomie pomija te stany. Najpierw
prześledzić `LayerBinder`, `TextureCache.revealed`, maski czasu budowy oraz przycinanie klatek.
Sprawdzić na jednym oryginalnym budynku, czy da się zachować poprawę detalu bez zmiany
progów odsłaniania, położenia, przezroczystości i zaznaczania. Nie obiecywać wyniku z góry.

Zakres próby: budowa od zera, ulepszanie istniejącego budynku, końcowe przejście do gotowej
grafiki, przełączenie jakości w trakcie. Kontrolować liczbę/cache tekstur i koszt pierwszego użycia.
Zachować bezpieczny fallback oraz dotychczasowy wygląd własnych assetów.

### Kandydaci na później — nie są jeszcze wdrożeni ani udowodnieni

1. Izolowane kafle terenu z mipmapami dla silnego oddalenia. Oryginalne strony atlasu nie mają
   właściwego paddingu do bezpiecznych mipmap całej strony. Porównać migotanie, ostrość,
   szwy, pamięć i czas przygotowania; nie włączać mipmap całego atlasu na ślepo.
2. Subtelne cienie kontaktowe pod wybranym budynkiem. Najpierw sprawdzić cieniowanie
   namalowane w źródle, żeby nie podwoić zaciemnienia. To decyzja artystyczna, nie odzyskana
   reguła oryginalnego silnika. Wymaga osobnej oceny na terenie.
3. Rzeczywiste klatki pośrednie lub ruch wydzielonego mechanizmu. Nie wracać do crossfade.
   Postacie/zwierzęta wymagają poprawnych nowych kształtów; ciągły ruch mechanizmu również
   musi zachować perspektywę i zasłanianie. To większy, osobno oceniany eksperyment.

## Verify

- Oryginalne assety jako pierwszy podgląd, własne jako kontrola zgodności.
- Porównanie na tej samej mapie i kamerze, ×2 zgodnie z
  [WORLD-STYLE.md](../../art/WORLD-STYLE.md#quality-and-characters), także przy oddaleniu i ruchu.
- Nie powiększać źródłowych PNG, aby deklarować nowy detal; HUD i jednostki świata pozostają stałe.
- Testować alfa, maski budowy, bounds/picking, przełączanie ustawień i lifecycle cache.
- Nie mutować magazynów symulacji z diagnostyki przeglądarkowej; używać snapshotów,
  publicznych komend UI albo izolowanej próby renderera bez zmiany świata.
- Gates według TESTING.md, niezależny przegląd istotnych zmian, zweryfikowany URL na końcu.
  Nie uruchamiać benchmarków równolegle z buildem lub pełnymi testami.
- Akceptacja użytkownika decyduje o zachowaniu efektu. Małe osobne commity ułatwiają cofanie.

Po wykonaniu następnego etapu skrócić ten ticket do faktycznie pozostałego zadania;
nie dopisywać dziennika sesji. Stabilne zasady należą do kontraktów i DEVELOPMENT.md.
