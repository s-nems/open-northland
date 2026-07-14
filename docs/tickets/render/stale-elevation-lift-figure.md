# Correct the superseded ≈1.24 px/unit elevation-lift figure in AGENTS.md

**Area:** docs (root `AGENTS.md`) · **Origin:** /trim-comments render sweep, 2026-07-14 · **Priority:** P3

The root `AGENTS.md` "Durable Gotchas" entry (line ~148) still states the map projection has an
"elevation lift about 1.24 native px/unit". That figure is an early photogrammetric fit and is
explicitly superseded: `docs/SOURCES.md` (source basis "terrain tessellation") pins the lift to the
engine tessellation's own divisor — each node lifts by `elevation/16` half-row-steps = `TILE_HALF_H/32`
= **1.1875 px per unit** at the measured 38 px row step, and records that the old ≈1.24 fit ran ≈4%
high. `packages/render/src/data/elevation.ts` already implements and documents the correct divisor.

Because `AGENTS.md` is always-read context, the stale number is the version an agent is most likely to
absorb and propagate. The comment sweep found and removed the same stale claim from
`packages/render/src/data/iso.ts` (which additionally called the lift "unrendered for now" — it is
rendered: `gpu/terrain/geometry.ts` → `data/terrain.ts` `nodeLift` → `elevation.liftAt`); `AGENTS.md`
was left alone as out of scope for a comment-only pass.

Source basis: `docs/SOURCES.md` "terrain tessellation" (the divisor + the superseding note) and
`docs/SOURCES.md` "projection" (the 68 px / 38 px pitch, which stays correct).

## Scope

- Update the `AGENTS.md` Durable Gotchas projection line to cite `elevation/16` half-row-steps
  (`TILE_HALF_H/32`, ≈1.1875 px/unit at the 38 px row step) instead of ≈1.24, keeping the rest of the
  entry (staggered raster, 68 px cell width, 38 px row step, pre-lift depth sorting) as-is.
- Grep for any other surviving ≈1.24 citation and correct or delete it. As of filing, the only other
  hits are the two intentional ones in `docs/SOURCES.md` that *record* the supersession, plus
  `docs/SOURCES.md:399`, which notes some px figures were fitted against the old lift and asks for a
  re-fit — leave that alone; it is its own open question, not a stale claim.
- Do not restate the lift arithmetic in `iso.ts`; `elevation.ts` owns that fact.

## Verify

`npm run check` and `npm test` (docs-only change; nothing should move). Confirm by grep that no
non-historical ≈1.24 lift claim remains outside `docs/SOURCES.md`.
