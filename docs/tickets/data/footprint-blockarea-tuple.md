# Tighten `fullStateBlockAreaCells` to the `LandscapeBlockArea` tuple

`packages/data/src/footprint.ts` — `fullStateBlockAreaCells(areas: readonly (readonly number[])[])`
takes a loose "array of int arrays" and defends each row with `x === undefined || y === undefined ||
run === undefined` guards. Every semantic caller passes a `LandscapeBlockArea` (a fixed 4-int tuple
`[state, x, y, run]`): `content-index.ts` (`record.workAreas`) and the sim's `footprint/resources.ts`
wrapper both do. Typing the param `readonly LandscapeBlockArea[]` would let the per-element
`undefined` guards go (keeping only the real `run <= 0` + `state !== fullState` filters).

## Why this is deferred (needs an app-side change first)

Attempted and reverted: the app's map-collision join (`packages/app/src/content/collision.ts`) passes
`g.walkBlockAreas` / `g.buildBlockAreas` from `ir.landscapeGfx`, and the app's IR value is
**deep-readonly-widened** — the `LandscapeBlockArea` tuple `[number,number,number,number]` degrades to
`readonly number[]`, which is NOT assignable to the tight tuple type (TS can't prove 4 elements). So
tightening `footprint.ts` alone breaks `collision.ts` at compile time; the guards are load-bearing for
that widened caller.

The real fix is in the app's IR readonly wrapper: make its deep-readonly mapping preserve tuple types
(so `LandscapeBlockArea` stays a 4-tuple through the readonly transform) instead of widening them to
`readonly number[]`. Then `footprint.ts` can take `readonly LandscapeBlockArea[] | undefined` and drop
the element guards, with no `as`-cast at the call site.

## Scope

1. Find the app's deep-readonly IR type (whatever produces `ir.landscapeGfx` in `collision.ts`) and fix
   its tuple handling so `readonly [number,number,number,number]` survives.
2. Tighten `fullStateBlockAreaCells`'s param to `readonly LandscapeBlockArea[] | undefined`; delete the
   `x/y/run === undefined` guards (keep `run <= 0` and the `state !== fullState` filter). Remove the
   `NOTE` comment added when this was deferred.
3. Verify no call site needs an `as` cast.

## Verify

`npm test`, `npm run check`, `npm run build`. The footprint + collision behavior must be unchanged.

## Source basis

Pure type-safety refactor; no mechanic change. The block-area tuple shape is pinned by the
`LandscapeBlockArea` schema (`packages/data/src/schema/landscape/objects.ts`).
