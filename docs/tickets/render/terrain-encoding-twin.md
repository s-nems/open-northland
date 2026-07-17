# Resolve render's duplicated `TRANSITION_NONE` / `TRANSITION_PAIRS` twin

**Area:** render (+ data) · **Origin:** data+pipeline refactor-cleanup pass, 2026-07-17 · **Priority:** P3
**Needs user:** the render↔data decoupling is an architecture call — confirm the intended dependency
direction before executing.

The `emt1..emt4` transition-lane encoding constants exist twice:

- `packages/data/src/schema/maps/terrain/encoding.ts` — `TRANSITION_NONE = 255`, `TRANSITION_PAIRS = 6`,
  documented as *"the render keeps a documented local twin — that package stays import-decoupled from
  `@open-northland/data` by design"*.
- `packages/render/src/data/terrain.ts` — the same two values, with a comment saying a change to the
  encoding must touch both sites.

The stated rationale is only half true (verified 2026-07-17): `packages/render/package.json:19`
**already declares** `"@open-northland/data": "*"` as a dependency. Render's *source* genuinely never
imports it — the only `@open-northland/data` occurrences under `packages/render/src` are JSDoc prose
in `data/terrain.ts` and `data/sprites/settler-bindings.ts` — so the convention holds today, but
nothing enforces it while the dependency edge exists anyway.

Meanwhile `data` pays for the split: `encoding.ts` exists solely to be shared, and is consumed only by
`schema/maps/terrain/file.ts` and `tools/asset-pipeline/src/stages/maps/terrain.ts`.

## Scope

Decide the direction, then make the repo say it:

- **Keep the decoupling**: drop the unused `@open-northland/data` dependency from
  `packages/render/package.json` so the boundary is real, and keep the twin + its comment. Consider a
  check (lint rule or a test) that fails if render's source ever imports `data`.
- **Drop the twin**: import `TRANSITION_NONE`/`TRANSITION_PAIRS` from `@open-northland/data` in
  `packages/render/src/data/terrain.ts`, delete the local copies, and remove the decoupling claim from
  `encoding.ts`'s doc.

Either way, `encoding.ts`'s doc comment must stop asserting a decoupling the package manifest
contradicts.

## Verify

`npm test`, `npm run check`, `npm run build`. Behavior-preserving either way — the values are
identical; only the import graph moves.

## Source basis

Internal architecture; the encoding values themselves are pinned by the map schema's refines and
`tools/asset-pipeline/test/maps-terrain.test.ts`.
