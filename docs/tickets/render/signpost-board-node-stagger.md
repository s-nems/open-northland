# Fix signpost boards deriving half-cell nodes without the row stagger

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P2

`data/scene/signpost-boards.ts` derives each post's half-cell node straight from its Position:

```ts
hx: Math.round((p.x / ONE) * 2),
hy: Math.round((p.y / ONE) * 2),
```

and feeds the pair to `systems.withinNodeRadius` to decide which boards to draw. The module doc claims
"posts sit on node anchors, so the rounding is exact … the drawn boards can never disagree with the
confinement". **The `hx` half of that does not hold.**

The sim stores a post at `positionOfNode(hx, hy)`, which is `x = hx/2 − staggerShift(y)`
(`sim/src/nav/halfcell.ts`), and recovers the node with `nodeOfPosition` = `toInt(worldX(x,y)·2)`,
which **adds `staggerShift(y)` back**. render drops that term. At an integer row `r`, `2·staggerShift(r)`
is 0 on even rows and 1 on odd — so **render's `hx` is exactly one node too low for every post on an
odd row**. `hy` is exact.

Consequence: for a pair straddling row parities, render's node distance is off by one 34 px node step
versus the sim's. Near the radius sum, `withinNodeRadius` returns a different answer than the sim's
network (`sim/src/systems/signposts/network.ts`), so a board can be drawn for a link that does not
exist, or omitted for one that does.

The tell that this is a slip and not a convention: `data/fog.ts` `fogCellOfTile` does the same
Position→lattice conversion and applies the stagger correctly. render has two answers to one question.

Not covered by [signpost-visual-calibration](../app/signpost-visual-calibration.md) (that is the
bearing→frame join) or [signpost-local-circle-anchor](../sim/signpost-local-circle-anchor.md) (the
sim's confinement anchor).

## Scope

Give render one owner for Position→half-cell, beside `fogCellOfTile` — both are the render twin of the
sim's `nodeOfPosition`:

```ts
nodeOfTile(tileX, tileY) => { hx: Math.round(tileX * 2 + rowStagger(tileY)), hy: Math.round(tileY * 2) }
```

Have `signpost-boards.ts` call it, and express `fogCellOfTile` in terms of it (`cellOfNode(nodeOfTile(…))`,
mirroring the sim's own chain) so the two cannot drift again.

**Not behavior-preserving** — it changes which boards draw for odd-row posts. That is the point; land
it as a fix commit with the regression test first, not folded into a move.

While in the file: `signpost-boards.ts:63,65` `posts[i] as Post` is a non-null assertion in disguise;
`for (const [i, a] of posts.entries())` proves it to the compiler instead.

## Verify

Pin the odd-row case first — `packages/render/test/` has no signpost-boards node-derivation test today
(`test/sprites/signpost-binding.test.ts` covers the binding, not this prepass). The test should place
two posts whose link verdict differs between the staggered and unstaggered `hx`, and assert render
agrees with `systems.signpostNetwork`. Then `npm test`, `npm run check`, `npm run build`.
