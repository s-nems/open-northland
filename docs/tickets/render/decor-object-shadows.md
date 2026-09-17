# Rysuj cienie płaskich dekoracji z danych mapy

**Area:** render · **Focus:** map-objects/decor-batch · **Priority:** P3

Płaskie dekoracje (trawa, kwiaty, kamienie bez blokady chodzenia) mają w danych sylwetki cienia,
ale ich nie rysują. `MapObjectSprite.shadow` (`packages/render/src/gpu/map-objects/map-object-sprite.ts`)
nazywa tę lukę wprost: tylko wysokie obiekty rysują cień, `decor-batch.ts` (`writeObjectQuad`) pisze
sam czworokąt ciała. Wysokie obiekty rysują cień osobnym spritem pod ciałem (`tall-blocks.ts`) i
przełącznik miękkich cieni już go obejmuje przez `textures.getShadow`. Konsekwencja: przy ziemi cienie
urywają się na granicy „wysoki/płaski”, co po włączeniu cieni postaci będzie jedyną grupą bez cienia.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Decyzja
o zachowaniu należy do użytkownika po sesji.

## Scope

- Najpierw policzyć na `magiczny_las`, ile rozmieszczeń dekoracji ma klatkę cienia i jak duże są
  sylwetki; jeśli to pojedyncze rekordy, zamknąć ticket bez zmian.
- Pisać czworokąt cienia pod czworokątem ciała w tej samej partii dekoracji (klatka cienia sparowana
  po indeksie z klatką ciała, animowane dekoracje aktualizują obie), z miękkim wariantem przez
  `textures.getShadow` i unieważnieniem po zmianie przełącznika, jak w `tall-blocks.ts`.
- Poza zakresem: wysokie obiekty, własne assety, cienie wymyślane dla rekordów bez sylwetki.

## Verify

- Test partii dekoracji: obiekt z cieniem daje dwa czworokąty w kolejności cień, ciało; obiekt bez
  cienia jeden; zmiana przełącznika miękkich cieni przebudowuje partię.
- Zrzuty A/B tego samego kadru `magiczny_las` z `polish=on` i `polish=off`; różnica pikseli tylko
  wokół dekoracji.
- Liczba czworokątów i GPU ms przed/po na mapie testowej; budżet partii bez regresji.
- Bramki z [TESTING.md](../../TESTING.md), ocena użytkownika.
