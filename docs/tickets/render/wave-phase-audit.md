# Resolve the wave-phase code/doc contradiction against the corpus

**Area:** app content (render behavior) · **Origin:** map-visual-fidelity plan reconciliation,
2026-07-12 · **Priority:** P3

`packages/app/src/content/objects.ts` contradicts itself: the code sets `phase: hx + hy` (a
deliberate spatial gradient, from the "water repeated too many times" report) while the SAME
function's JSDoc claims "phase — 0 for every object … play IN UNISON". One of them is wrong about
the original.

## Scope

- Template-match wave frames over one corpus water patch (kit below) → decide
  unison vs gradient with evidence.
- Update the code AND the JSDoc to agree with the finding; name the source basis at the site.

## Template-matching kit

The pixel-oracle kit for comparing our render against the original (the owner is the pixel oracle —
never self-sign a visual):

- **Corpus:** `~/Projects/vikings/reference-shots/mosty-na-rzece-toprow/mosty-{1..7}.png` — the
  full 250-column top strip of `specjalna_mosty_na_rzece`, left→right with small overlaps, capture
  scale exactly **1.25× native art px** (pinned by 5 building templates). Read-only, outside the repo.
- **Pinned mosty-5 viewport mapping** (north base, 19-building sub-pixel lattice fit):
  `img_x = −11996.0 + 42.4958·hx`, `img_y = 240.2 + 23.766·hy − 1.547·elev(hx/2, hy/2)`; native
  px = image px ÷ 1.25. Caveat: the `−1.547·elev` coefficient and the residual offset ≈ (−59,−15)
  px were fitted against the OLD ≈1.24 lift (superseded by `TILE_HALF_H/32`) — re-fit the
  elevation term before trusting sub-pixel claims; the x/y lattice terms should hold.
- **Our matching frame:** `?map=specjalna_mosty_na_rzece&center=160,15&zoom=1.25` at a 3172×1784
  viewport ≈ mosty-5.
- **Recipe:** masked `TM_SQDIFF_NORMED` (invert to a score), alpha mask eroded 2 px, sprites
  cropped from `content/Data/engine2d/bin/bobs/<stem>.<palette>.{atlas.json,png}`, OpenCV via a
  scratchpad venv.

## Verify

- Pure phase selection is unit-testable.
- River side-by-side (mosty-3/4 reference frames) — **user's eyes**.
