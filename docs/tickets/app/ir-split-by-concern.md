# Split content/ir.ts into a feature folder by concern

**Area:** app · **Origin:** app refactor-cleanup pass, 2026-07-14 · **Priority:** P3

`packages/app/src/content/ir.ts` (~418 lines) bundles three distinct concerns that its sibling
content packages (`building-gfx/`, `resource-gfx/`, `settler-gfx/`, `sprite-sheet/`) already keep as
feature folders behind an `index.ts` barrel:

1. **The `ContentIr` type surface** — `ContentIr` plus ~10 row interfaces (`BobSeqRow`,
   `LandscapeGfxRow`, `GatheringPipelineRow`, …) and the `servedAtlasStem` helper.
2. **Atlas / texture byte-loading** — `loadLayer`, `loadBuildTimeSheet`, `loadPlayerLut`,
   `loadGalleryLayers`, `MissingAtlasError`.
3. **The memoized IR document fetch + per-lane readers** — `loadIrRaw` (the one memoized raw
   `/ir.json` fetch every domain shares, incl. `real-content.ts`), `loadIr`, `buildingFootprints`,
   `sequencesFor`, `gfxAtomicFrameLists`, `loadBodyClips`.

Deferred from the refactor-cleanup pass (kept out to bound that diff) — a standalone packaging move
that deserves its own review.

## Scope

- Split into `content/ir/{types.ts, atlas.ts, document.ts}` with a `content/ir/index.ts` barrel that
  re-exports the current public surface, so every existing `./ir.js` / `../ir.js` import path stays
  stable (files inside the folder import each other directly, not through the barrel).
- A move, not a rewrite: bodies move verbatim; any rename rides in its own separable hunk.
- Finish the extraction — no leftover grab-bag `ir.ts`.

## Verify

- `npm test`, `npm run check`, `npm run build` green; re-read the resulting folder to confirm each
  file owns one of the three concerns above and no grab-bag `content/ir.ts` remains. No golden moves
  (pure move).
