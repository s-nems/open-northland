# Bake the HUD's icon and thumbnail shadows into their pictures

**Area:** app · **Focus:** hud/dom · **Priority:** P2

With the construction window open, every frame pays for the live `filter: drop-shadow` rules on its
cards: each filtered thumbnail and good icon is an effect of its own that the page paints and layerizes
again whenever anything in the HUD layer repaints, which the counters and the notice figures make
happen in most frames. A `bench:hud` CSS A/B on a Radeon integrated GPU at 1920x1080 (four rounds ABBA,
every HUD drop shadow disabled on the B side) reads per frame:

| scenario | Paint ms | Layerize ms | HitTest ms | raster ms |
| --- | --- | --- | --- | --- |
| `build` | 1.15 -> 0.87 | 0.65 -> 0.41 | 0.82 -> 0.68 | 0.23 -> 0.23 |
| `build-tabs` | 4.27 -> 2.32 | 0.90 -> 0.43 | 0.59 -> 0.45 | 0.51 -> 0.36 |

The other suspects are cleared. A CPU profile of `build` puts the 250 ms availability refresh at under
0.15 ms a call, the cost tooltips no longer format a string per line per tick, and the window shows no
portrait inset.

## Scope

Draw the shadow into the static pictures instead of filtering them live:

- the card thumbnails (`.on-bcard__thumb img`, `hud/dom/building-thumb.ts`), with a margin so the
  shadow is not cut at the picture's edge and the body keeps its size in the card;
- the good icons (`.on-good`, `hud/dom/good-art.ts`). The CSS shadow is in design px while an icon is
  scaled by its box, so the baked picture is per good and box size, and `goodIconStyle` has to place
  the larger picture without moving the icon.

Shadow pixels may differ slightly; leave a before/after screenshot pair for the owner. The remaining
rules (`.on-icon`, `.on-token`, the bar figures, the minimap frame) sit on a handful of elements and
can keep their filters unless the A/B shows otherwise.

## Verify

`bench:hud` scenarios `none`, `build` and `build-tabs` with `ON_BENCH_HUD_TRACE=1`, before and after in
one session: `build` Layerize within 0.1 ms of `none`, `build-tabs` Paint at or below the B side above.
`test:hud` green.
