# Decide whether buildings/settlers should shade to terrain (and how)

**Area:** render + human eyes · **Origin:** shadowed-buildings fix, 2026-07-18 · **Priority:** P4

**Needs user:** requires an A/B judgement against the running original.

The per-entity feet-anchor shading enhancement (`DrawItem.shade`) was removed because it multiplied a
whole sprite by the brightness of the single cell under its feet, which blackened large building
footprints standing on baked slope-shadow (e.g. `boso_przez_swiat`: 3 of 4 coin mints on `embr≈60` →
×0.47, 16% of buildings below ×0.85). Buildings/settlers now draw unshaded — the source basis is the
original's normal bob-print core (`CBobManager.PrintBob_8BitCore`/`PrintBob_DoubleByteCore`) taking no
brightness argument, while only landscape objects fold shade into their alpha blit.

Two things are still open and unmeasured:

- The original was not observed to confirm buildings render fully unshaded on slope-shadowed ground.
  Landscape objects *do* shade to the lane via a single anchor cell (measured, `brightness.ts`), so the
  defect may have been "one cell for a big footprint," not "entity shading exists at all."
- Removing the multiplier entirely can leave settlers/buildings reading as mildly "floating" over
  darker ground (the opposite failure of the black-building bug).

Investigate-first, then pick one: (a) keep unshaded (current), (b) shade by the footprint's *average*
or *centre* cell instead of the feet anchor, or (c) apply the feet-cell multiplier with a floor (never
below ~0.85) so entities stay seated without blackening. Pin the choice against a side-by-side capture
of the original game on `boso_przez_swiat` and the `mosty-5` calibration map.

## Verify

- Human A/B vs the original on a slope-shadowed patch; the rejected options recorded in the
  `brightness.ts` comment as considered-and-dropped.
- If (b)/(c) is chosen: a headless assertion that a building on an `embr≈60` cell no longer renders
  below the chosen floor, plus `npm test` / `npm run check` / `npm run build`.
