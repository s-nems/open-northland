# Rysuj cienie oryginalnych postaci i pojazdów

**Area:** render, app · **Focus:** sprite-pool, content/sprite-sheet · **Priority:** P2

Oryginalne zwierzęta, drzewa i budynki rzucają cień, a ludzie, wozy i statki nie. Cień w oryginale to
osobny zestaw sylwetek (`cr_hum_body_XX_s.bmd`, `cr_veh_body_00_s.bmd`; typ klatki 2 w
`docs/formats/GRAPHICS.md`), nie piksele w ciele. Dane są kompletne: każdy z 71 wierszy `jobGraphics`
w `content/ir.json` ma `shadowBody`, a pipeline konwertuje je do `content/bobs/<stem>_s.shadow.png`
(`convertShadowBmdTree` w `tools/asset-pipeline/src/stages/bmd/convert.ts`). Nikt ich nie wczytuje:

- `shadowStemsByAtlasStem` (`packages/app/src/content/ir/joins.ts`) składa tylko `landscapeGfx`
  i `buildingBobs`; wiersze `jobGraphics.shadowBody` pomija.
- `packages/app/src/content/sprite-sheet/human-sheet.ts` ładuje ciała bez bliźniaka cienia
  („Settlers draw shadow-less”), więc `shadowLayerFor` w `character-layers.ts` nie ma z czego zbudować
  warstwy. Zwierzęta działają, bo `animal-roster.ts` ładuje `cr_ani_body_00_s.shadow` wprost.
- Oryginalni ludzie rysują się ścieżką paletową (`bindPalettedLayer` w
  `packages/render/src/gpu/sprite-pool/bind-layers.ts`), która nigdy nie woła `textures.getShadow`;
  robi to tylko `bindPlainLayer`. Sylwetki cienia są bezpaletowe, więc cień może iść jako zwykła
  warstwa pod paletowym ciałem.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Zrzuty
z Playwright z widocznym oknem (prawdziwe GPU); porównania A/B oceniać różnicą pikseli. Decyzja
o zachowaniu efektu należy do użytkownika po sesji.

## Scope

- Dołączyć `jobGraphics.shadowBody` do złączenia stem ciała → stem cienia i wczytywać bliźniaka
  cienia dla warstw ciał ludzi i pojazdów (`human-sheet.ts`, ścieżka `[jobbasegraphics]`).
- Postać paletowa dostaje warstwę cienia `[shadow, body]` tak jak zwierzę: klatka cienia po tym samym
  id boba co ciało, `boundsExempt`, poza pickingiem i clipem zwijania; sprawdzić na danych, że
  identyfikatory sylwetek biegną równolegle do ciała (dla `_s.bmd` budynków tak jest).
- Przełącznik miękkich cieni obejmuje nowe warstwy przez `textures.getShadow` bez zmian w cache.
- Pojazdy (wóz, statek, katapulta) jadą tą samą ścieżką co ludzie.
- Poza zakresem: własne assety (mają własne cienie), elipsy zastępcze, zmiana kierunku światła.

## Verify

- Test jednostkowy `resolve-layers`: osadnik i pojazd z oryginalnego arkusza dają `[shadow, body]`,
  cień ma `boundsExempt` i nie wchodzi do pickingu; cień bez klatki dla danego boba daje samo ciało.
- Przeglądarka, `?map=magiczny_las&assets=original&polish=on&zoom=2`: idący osadnik, wóz i zwierzę
  mają cienie o spójnym kierunku i jasności; ten sam kadr z `polish=off` pokazuje cień twardy.
- Klik w cień nie zaznacza jednostki; ramki zaznaczenia bez zmian.
- Pomiar: GPU ms i pamięć tekstur przed/po na tym samym kadrze; nowe strony atlasu cieni policzyć.
- Bramki z [TESTING.md](../../TESTING.md), zrzuty A/B do oceny użytkownika.
