# Split `nav/terrain/graph.ts` by concern

**Area:** sim · **Priority:** P3
(refactor — no behavior change)

## Context

`packages/sim/src/nav/terrain/graph.ts` is **332 lines**, past the ~300 split guidance. It grew there
during the A*-allocation pass (292 → 332): removing the per-settle allocations added the scalar
`xOf`/`yOf` accessors and the `stepsInto` scratch-fill variant beside the existing allocating `steps()`.
The `StepBuffer` itself was extracted to `terrain/step-buffer.ts`, but the graph kept both edge-emission
paths.

That pass deliberately stopped there: splitting the graph further was not sanctioned by its scope, and
doing it concurrently with four other in-flight refactors would have widened an already large diff.

The module now mixes:

- the node lattice accessors (`coordsOf`, `xOf`/`yOf`, `nodeAt*`, `typeAt`, `isWalkable`),
- edge emission + the diagonal flank-seam rule (`neighbours`, `walkableNeighbours`, `steps`, `stepsInto`),
- connectivity (`computeComponents`' flood fill).

## Scope

- Split by domain concern into the existing `terrain/` folder (edge emission is the obvious first
  extraction — it is the one the pathfinder and the flood fill share, and the flank-seam rule must keep
  exactly one owner).
- A split is a MOVE: bodies move verbatim; emission order and every `fx` operation stay identical.
- Keep `steps`/`stepsInto` together — they are one rule with two allocation strategies.

## Verify

- No module in `nav/terrain/` is meaningfully over the budget, each file owns one terrain concern,
  and `npm test` is green with **zero golden movement** (a moved golden means the arithmetic changed).
