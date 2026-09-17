# Kołysz nieruchome oryginalne drzewa wiatrem

**Area:** render, app · **Focus:** map-objects, content/objects · **Priority:** P3

Większość oryginalnej roślinności ma autorskie klatki kołysania i renderer je odtwarza: z 866
rekordów `landscapeGfx` 277 ma pętlę (drzewa 8, 16 lub 24 klatki, krzewy 27), a
`packages/app/src/content/objects.ts` przycina do jednej klatki tylko rekordy bez `loopAnimation`.
Nieruchome zostają trzy jednoklatkowe rekordy drzew (na `magiczny_las` 1 709 z ok. 13 800 drzew),
pnie i skały. Mechanika ścinania już istnieje i działa dla własnych drzew: pole `sway` w
`MapObjectSprite`, `vegetationShear` w `packages/render/src/gpu/vegetation-sway.ts`, zastosowanie
w `tall-blocks.ts` pod przełącznikiem ruchu otoczenia. `loadMapObjects` nie ustawia `sway` żadnemu
oryginalnemu rekordowi. Klasyfikacja po nazwie typu logiki ma wzór w
`packages/app/src/content/object-shading.ts` (`UNSHADED_LANDSCAPE_TYPES`).

Wartość jest niewielka (ok. 12% drzew na mapie testowej), koszt też: to jedna tabela nazw i jedno
pole. Płaskie dekoracje (`decor-batch.ts`) piszą osiowe czworokąty i nie potrafią się ścinać; zostają
poza zakresem.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Decyzja
o zachowaniu należy do użytkownika po sesji.

## Scope

- Nadać `sway` (siła jak własne sosny/buki, `runtime.json` ok. 0,02) wyłącznie wysokim obiektom
  o typie logiki drzewa lub krzewu, które nie mają pętli klatek. Rekordy z pętlą zostają bez ścinania
  (dwa wiatry naraz), skały, pnie i „tree falling” bez zmian.
- Poza zakresem: płaskie dekoracje, własne assety, zmiana siły wiatru.

## Verify

- Test `objects`: rekord drzewa z pętlą nie dostaje `sway`, jednoklatkowy dostaje, skała nie.
- Przeglądarka, `magiczny_las`, `polish=on` i `polish=off`: nieruchome drzewa kołyszą się w tempie
  własnych drzew i przestają przy wyłączonym ruchu otoczenia; cienie tych drzew podążają za ciałem.
- GPU ms bez regresji (ścinanie zmienia tylko rebind wysokich obiektów).
- Bramki z [TESTING.md](../../TESTING.md), ocena użytkownika na żywo.
