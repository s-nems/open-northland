# Wzmocnij cienie i rzuć cień z sylwetki postaci

**Area:** render, app · **Focus:** sprite-pool, world-batcher, soft-shadow-cache · **Priority:** P2

Wszystkie cienie oryginału są ledwo widoczne. Krycie sylwetek `_s.bmd` jest zapieczone w pipeline na
`SHADOW_ALPHA = 0x50` (31%, `tools/asset-pipeline/src/decoders/atlas/bake.ts`), a przełącznik
`softShadows` tylko rozmywa alfę (`packages/render/src/gpu/soft-shadow-cache.ts`, jądro 1-4-6-4-1,
rgb zawsze 0). Budynek ma duży, długi cień, więc zarys widać; postać dostaje z oryginału małą plamę
pod stopami (0.27-0.71 wysokości ciała), praktycznie niewidoczną. Cel: cienie wyraźnie lepsze niż w
oryginale, nadal w tym samym przełączniku, `polish=off` bez zmian.

Kierunek światła: sylwetki budynków i drzew biegną z anchora w prawo do góry ekranu (wieża na
`magiczny_las`). Rzutowany cień postaci ma iść tym samym kierunkiem, z długością i nachyleniem
zmierzonymi na kilku sylwetkach budynków (`content/bobs/<house>_s.shadow.png` względem klatki ciała,
punkt najdalszy cienia względem wysokości bryły). Stałe nazwane, z podanym pomiarem jako źródłem.

Zawartość jest współdzielona i tylko do odczytu, więc bez zmian w pipeline: siła i barwa cienia to
sprawa renderera.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Zrzuty
z Playwright z widocznym oknem (prawdziwe GPU); porównania A/B oceniać różnicą pikseli. Decyzja
o zachowaniu efektu należy do użytkownika po sesji.

## Scope

- Siła i barwa: przy włączonym `softShadows` każda sylwetka cienia (budynki, drzewa, zwierzęta,
  postacie, tall-blocks) rysuje się z krotnością alfy (np. 0x50 → ok. 50-60%) i chłodną barwą zamiast
  czystej czerni. Miejsce: shader batchera `world` (`packages/render/src/gpu/world-batcher.ts`) po
  oznaczeniu tekstur cienia w `pixel-art-registry.ts` (tekstury z `textures.getShadow` i płótna
  `SoftShadowCache`), jako stała programu tak jak tryb powiększenia; albo wypiek w `SoftShadowCache`,
  jeśli budżet 8 MiB nie zostawi żadnej sylwetki w wersji oryginalnej obok wzmocnionej. Wybrać jedno,
  uzasadnić w raporcie.
- Rzutowany cień postaci: dla ludzi i zwierząt dodatkowy zwykły sprite z klatką ciała (atlas
  indeksowany ma indeks w R i pokrycie w A, więc `tint` czarny daje czystą sylwetkę), zakotwiczony
  w stopach, ścięty i spłaszczony w kierunku światła budynków, pod ciałem, `boundsExempt`, poza
  pickingiem i clipem zwijania. Wariant miękki: `SoftShadowCache.get(źródło ciała, klatka ciała)` już
  daje rozmytą czarną sylwetkę dowolnej klatki. Sprawdzić A/B: sama plama oryginału, sam rzut, oba
  razem; zarekomendować domyślne.
- Parametr diagnostyczny sesji w `params.ts` obok `scaler=` do strojenia krotności, barwy i długości
  rzutu bez przebudowy; wartości domyślne wpisane jako stałe po strojeniu.
- Etykieta przełącznika w ustawieniach i katalogach (pl/en) opisuje nowe znaczenie, jeśli „miękkie
  cienie" przestaje być prawdą.
- Poza zakresem: zmiana kierunku światła, cienie na własnych assetach ponad to, co dostają
  automatycznie, cienie w oddzielnej warstwie pod wszystkimi jednostkami (jeśli rzut wchodzi na
  ciało jednostki stojącej wyżej na ekranie, opisać to w raporcie i oszacować koszt osobnej warstwy).

## Verify

- Test jednostkowy: postać z oryginalnego arkusza daje `[cast, shadow, body]` (lub uzgodnioną
  kolejność), rzut jest `boundsExempt` i nie wchodzi do pickingu; transformacja rzutu dla znanej
  wysokości ciała daje oczekiwany wektor.
- Przeglądarka, `?map=magiczny_las&assets=original&polish=on&zoom=2`: ten sam kadr z wieżą, drzewem,
  zwierzęciem i idącym osadnikiem; kierunek cieni spójny, postać czytelnie rzuca cień; `polish=off`
  identyczny z HEAD (diff pikseli 0).
- Montaż kandydatów: 3-4 zestawy (siła, barwa, długość rzutu) obok siebie do decyzji użytkownika.
- Pomiar GPU ms i liczby spritów przed/po na tym samym kadrze.
- Bramki z [TESTING.md](../../TESTING.md).
