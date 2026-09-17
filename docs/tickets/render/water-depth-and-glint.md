# Dodaj wodzie głębię przy brzegu i refleks światła

**Area:** render · **Focus:** terrain/water · **Priority:** P3

Woda na tej gałęzi faluje (przesunięcie wierzchołków `aWave` i migotanie jasności w `FIELD_FRAGMENT`,
`packages/render/src/gpu/shading.ts`), ale jest jednolita od brzegu po środek jeziora: nie ma
rozjaśnienia płycizny, ściemnienia głębi ani refleksu nieba. Pianę przy brzegu oryginał ma jako
animowane dekoracje mapy (obiekty „waves”, na `magiczny_las` w tysiącach), więc piana w shaderze
podwoiłaby efekt i nie wchodzi w zakres. Pole wody (`makeWaveField` w
`packages/render/src/data/terrain/water.ts`) zna ułamek wody każdej komórki i celowo zeruje amplitudę
na węzłach stykających się z lądem; nie zna odległości od brzegu.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Zrzuty
z Playwright z widocznym oknem (prawdziwe GPU); porównania oceniać różnicą pikseli. Decyzja
o zachowaniu należy do użytkownika po sesji.

## Scope

- Policzyć odległość od brzegu w komórkach z pola wody (przeszukiwanie wszerz od komórek lądu)
  i przekazać ją jako atrybut wierzchołka obok `aWave` (`TerrainBatch`, `pushTriangle`, `meshGeometry`).
- W fragmencie: subtelny gradient jasności od płycizny do głębi i wąski, wolno wędrujący refleks
  światła na wodzie głębokiej; oba mnożą warstwę jasności, nie zmieniają tekstury kafla. Linia
  brzegowa i węzły lądu bez zmian geometrii.
- Efekt pod istniejącym przełącznikiem ruchu otoczenia (`environmentMotion`) albo osobnym, jeśli
  ocena A/B wymaga rozdzielenia.
- Poza zakresem: piana, odbicia obiektów, własne materiały (mają własną wodę).

## Verify

- Test `water.test.ts`: odległość od brzegu wynosi 0 na komórce stykającej się z lądem, rośnie
  w głąb, jest 0 na mapie bez wody.
- Zrzuty A/B wybrzeża `magiczny_las` (ta sama kamera, tick, zoom 1 i 2); różnica pikseli ograniczona
  do wody; woda przy `polish=off` bez zmian.
- GPU ms bez regresji; brak zmian w pamięci tekstur.
- Bramki z [TESTING.md](../../TESTING.md), ocena użytkownika w ruchu (refleks jest widoczny tylko
  na żywo).
