# Daj oryginalnym kaflom terenu łańcuch mipmap

**Area:** render, app · **Focus:** terrain · **Priority:** P3

Przy silnym oddaleniu na ekranach 1x oryginalny teren migocze i pokazuje szwy, bo jego strony atlasu
nie mają mipmap. Strony to konwersja 1:1 z PCX (`convertPcxTree` w
`tools/asset-pipeline/src/stages/pcx.ts`): 256x256 px, kafle 64 px upakowane bez odstępów, UV jako
włączne rogi pikseli (`packages/render/src/data/terrain/uv.ts`). `loadAtlasSource`
(`packages/render/src/gpu/pixi-app.ts`) ustawia tylko `scaleMode`, nigdy `autoGenerateMipmaps`, bo mipmapa
całej strony zmieszałaby sąsiednie kafle. Zamiast tego shader terenu (`TERRAIN_SAMPLE` w
`packages/render/src/gpu/shading.ts`) filtruje przy pomniejszeniu czterema próbkami ograniczonymi do
kafla; komentarz mówi wprost, że to nie zastępuje mipmap. Własne materiały mają odstęp
(`MATERIAL_GUTTER` w `packages/app/src/content/own-assets/material-layout.ts`) i mipmapy, a gotowe
budynki dostają je z izolowanych klatek (`building-texture-cache.ts`); teren oryginalny jest ostatnim
źródłem bez łańcucha.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Zrzuty
z Playwright z widocznym oknem (prawdziwe GPU); porównania oceniać różnicą pikseli. Decyzja
o zachowaniu należy do użytkownika po sesji.

## Scope

- Przepakować kafle oryginalnych stron terenu (bazowe i nakładki przejść `.masked`) na strony
  z odstępem i przedłużonymi krawędziami przy ładowaniu w aplikacji (wzór: własne materiały), włączyć
  mipmapy i przemapować UV; `uManualSampling` wyłącza filtr ręczny sam, gdy źródło ma mipmapy.
- Utrzymać ograniczenie próbkowania do kafla przy powiększeniu (bikubiczne bez zmian).
- Porównać z obecnym filtrem 4-tapowym: migotanie przy panoramowaniu na minimalnym zoomie, szwy,
  pamięć GPU, czas przygotowania przy starcie mapy.
- Poza zakresem: własne assety, zmiana pipeline'u i formatu content (przepakowanie w czasie ładowania
  nie zmienia IR).

## Verify

- Test: przemapowane UV trafiają w te same piksele źródłowe co dziś na brzegach kafla; nakładki
  przejść zachowują alfę.
- Pomiar migotania: różnica klatka do klatki przy powolnym panoramowaniu na `magiczny_las` przy
  minimalnym zoomie, DPR 1, przed i po; szwy na zrzutach zbliżenia.
- Czas ładowania mapy i pamięć tekstur przed/po; GPU ms bez regresji.
- Bramki z [TESTING.md](../../TESTING.md), zrzuty A/B do oceny użytkownika.
