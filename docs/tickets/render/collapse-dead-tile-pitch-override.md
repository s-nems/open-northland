# Remove the dead runtime tile-pitch override (or wire the `?pitch=` query it exists for)

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-14 · **Priority:** P3
**Needs user:** decide *remove* vs *wire* — `setTilePitch` is a public export and a documented
calibration/debug seam, so deleting it is a judgment call, not a mechanical cleanup.

`data/iso.ts` exposes `setTilePitch(halfW, halfH)` and keeps `TILE_HALF_W` / `TILE_HALF_H` as
`export let` so a runtime override (documented as `?pitch=<cellWidth>` / `?pitchy=<cellDiamondHeight>`)
can retune the projection after module init. Several comments across the projection layer state this
override is live and "reaches" the rings/overlays/diamonds because they read the pitch per call
(`iso.ts`, `elevation.ts`, `selection-layer.ts` `isoRatio`, `geometry-debug.ts` `diamond`,
`map-object-layer.ts`).

Verified during the 2026-07-14 render pass: the mechanism is **entirely dead**.

- `setTilePitch` has zero callers anywhere (`packages/*`, `tools/*`, tests) — only the declaration,
  the `src/index.ts` barrel re-export, and three JSDoc mentions.
- There is **no `?pitch` / `?pitchy` query-param handling anywhere in `packages/app/src`** — nothing
  reads such a param and calls `setTilePitch`.
- Therefore the only writes to `TILE_HALF_W` / `TILE_HALF_H` are inside `setTilePitch` itself, which
  never runs: both bindings are permanently equal to `CALIBRATED_HALF_W` / `CALIBRATED_HALF_H`, i.e.
  effectively `const`.

So the "read the pitch live so `?pitch` reaches every consumer / call `setTilePitch` before the scene
is built" contract is documentation of a feature that was never wired (or was removed). The reads are
harmless (reading a const per call), but the docs are misleading.

Source basis: the calibrated pitch (68 px cell width / 38 px row step) is observed from the original
(`AGENTS.md` "Durable Gotchas"); `?pitch`/`?pitchy` would be a live-calibration tool for exactly that
tuning.

## Scope

**First: the user decides the direction.**

- **Remove (recommended — dead code + speculative extensibility):** delete `setTilePitch` and its
  `src/index.ts` re-export; collapse `TILE_HALF_W` / `TILE_HALF_H` from `export let` to
  `export const = CALIBRATED_HALF_W/H`; and correct the now-false "read live for `?pitch`" comments
  in `iso.ts`, `elevation.ts`, `selection-layer.ts`, `geometry-debug.ts`, `map-object-layer.ts` (the
  per-call reads can stay — they're just no longer load-bearing for an override). A developer can
  still retune by editing the calibrated constants.
- **Wire (only if the calibration hook is wanted):** add `?pitch=` / `?pitchy=` parsing in the app
  entry and call `setTilePitch` before the first scene build. This is a feature, not a cleanup —
  keep the `let` bindings and the live-read comments, and add a test that an override reaches the
  projection.

## Verify

`npm run build`, `npm test` (full render suite — projection is exercised by `terrain`, `viewport`,
`elevation`, `map-object-fog` suites), `npm run check`. Byte-identical rendering either way (the
override never fired). If wiring: add a test that a `?pitch` override changes `tileToScreen` output.
