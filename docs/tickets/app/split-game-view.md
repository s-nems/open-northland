# Extract the fixed-timestep frame loop from view/game-view.ts

**Area:** packages/app · **Origin:** code review of feat/fog-of-war, 2026-07-12; partially done on
refactor/app-decompose (2026-07-12)

`packages/app/src/view/game-view.ts` was ~650 lines mixing several concerns. Most named seams have
since been extracted into sibling `view/*` modules (the repo's established pattern — see the pile
tooltip + geometry-debug extractions): the placement-overlay band probe → `view/placement-overlay.ts`,
the fog predicates/gate → `view/fog-gates.ts`, and the hover-tooltip pile cache →
`view/ground-pile-tooltip.ts` (earlier commit). The file is now ~553 lines.

The one large seam left inline is the **fixed-timestep RAF frame loop** (`frame()` + its per-frame
state: `timestep`, `lastMs`, `renderAlpha`, `frameEvents`, and the snapshot-identity memos
`hudFor`/`doorBadgesFor`). It was deliberately kept whole because its per-frame ORDER is pinned and
load-bearing (documented at the top of the file).

## Scope

Behavior-preserving extraction of the frame loop (and its per-frame memo/state) into a
`view/frame-loop.ts` sibling (a `createFrameLoop(...)` returning the `frame` callback / a `start()`),
keeping `startGameView` as the assembly that wires deps → subsystems → the loop. Preserve the pinned
per-frame order EXACTLY and keep the ordering comment with the loop. Sibling module, not a
`view/game-view/` folder (matches the current `view/` layout).

## Verify

`npm test`, `npm run check`, `npm run build`; boot `?map=` and `?scene=fog` — no console errors,
tick/step/CPU-split overlay unchanged, placement/tooltip/fog behavior unchanged.
