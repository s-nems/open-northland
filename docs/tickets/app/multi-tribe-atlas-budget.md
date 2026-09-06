# Bound the atlas pages a multi-civilization world uploads

**Area:** app, render, pipeline · **Focus:** texture budget · **Priority:** P2

Loading each civilization's own building and character bob sets scales the boot upload with the number
of civilizations a map fields. `loadBuildingSheet` and `loadLookLayers` restrict the load to
`worldTribes`, which keeps it off the whole content tree, but the remainder is still large and nothing
measures or caps it.

Measured against the decoded content, summing `width * height * 4` over the pages the two loaders
actually fetch (the reducers themselves, run out of `packages/app/dist`):

| world | building pages | character pages | RGBA8 total |
| --- | --- | --- | --- |
| `[1]` viking | 12 / 132 MB | 22 / 145 MB | 277 MB |
| `[1,2]` | 26 / 224 MB | 30 / 195 MB | 419 MB |
| `[1,5]` | 17 / 283 MB | 23 / 155 MB | 438 MB |
| `[1,2,3,4,7]` | 49 / 500 MB | 50 / 334 MB | 834 MB |
| `[1,2,3,4,5,7]` | 54 / 651 MB | 51 / 344 MB | 995 MB |

Over the 124 decoded maps, tribes per world run `{1: 31, 2: 20, 3: 22, 4: 24, 5: 22, 6: 5}`, so 51
maps field four or more and 27 field five or six. The multi-civilization case is the common one, not
the corner.

Two specific defects sit inside that total.

**The wonders are five pages of 1012 x 11150, and one of them already fails today.**
`ls_wonders3.{clay01,oxcart,wonders_8th,wonders_pyramid,wonders_semiramis}` are the only atlases in the
content tree over 8192 px in either dimension. Headless Chromium here reports `MAX_TEXTURE_SIZE` 8192
and refuses the upload with `WebGL: INVALID_VALUE: texImage2D: width or height out of range`; the page
then draws as nothing and no diagnostic names it.

This is not new and not confined to the multi-civilization case: it reproduces on `?map=cn_1`, an
all-viking world, because `ls_wonders3` reaches the GPU through the `landscapeGfx` map-object lane
(12 rows name it), which the per-tribe building join does not touch. Loading each civilization's own
building families adds a second route to the same pages on a tribe-5 world. The renderer checks no
page against `MAX_TEXTURE_SIZE` on either route.

**A tribe that places no building still buys its building pages.** `worldTribes` admits a tribe from a
seat or from an authored settler, and the building loader then takes every family that tribe's rows
name. Tribe 5's rows are the seven wonders and nothing else, so of the 24 maps fielding it, 20 place no
tribe-5 building at all and still upload `ls_wonders3` - 151 MB that nothing draws.

## Scope

- Repack `ls_wonders3` in the pipeline so no page exceeds 8192 in either dimension, and add a pipeline
  assertion that none ever does. Pair it with a runtime check against the context's `MAX_TEXTURE_SIZE`
  that reports the page it refused, so the next oversized atlas is a log line rather than a hole.
- Narrow the building family set from the tribe set to the `(tribe, typeId)` pairs a world can field:
  the authored buildings plus what its seats can construct.
- Add a content test that pins the per-tribe-set page count and pixel total, so the budget is measured
  rather than asserted, and fails when an extraction widens it.

## Verify

- `npm run test:content`: the budget assertion over the tribe sets above.
- A synthetic-atlas unit test for the oversize guard, asserting the page is refused and reported.
- The `texImage2D` rejection on `?map=cn_1` must be gone; it is reproducible under headless Chromium
  (`MAX_TEXTURE_SIZE` 8192) without any special hardware.
- A human pass on `?map=boso_przez_swiat`, the six-civilization worst case: it must boot, and the
  wonders on `?map=arabskie_wyspy_wolna_gra_mieszana` must draw rather than come up black -
  **user's eyes**.
