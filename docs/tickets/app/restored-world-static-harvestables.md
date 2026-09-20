# Measure and bound a restored map's static harvestable cost

**Area:** app, render · **Focus:** save/load, performance · **Priority:** P3

A fresh map bakes every harvestable placement into the static object layer and hands one node at a time to
the sprite pool as it is worked. A restored map cannot know which nodes the save already felled, so
`entries/map.ts` retires the whole harvestable bake up front and every tree and bush on the map becomes
pool-drawn for the rest of the session. On a real map that is thousands of quads moved from a built-once
layer into per-frame work, and nothing measures it.

The same path drops the fog ghost for nodes worked before the save; the code names that approximation.

It also freezes the forest. The pool draws a standing node as one still frame per level
(`firstBobsByStateAscending`, `resolveResourceDraw` takes no tick), while the static layer plays a
record's authored sway loop and leans the original's still trees with `environmentSway`. So a loaded map
shows every harvestable tree motionless where a fresh boot of the same map sways.

## Scope

- Measure a loaded session against a fresh one on the same real map, at the late-game x3 speed budget,
  reporting process CPU time rather than wall clock on a loaded machine (`docs/DEVELOPMENT.md` says which
  tool answers which question).
- If the cost is material, keep the static quad for every node the restored world still holds intact and
  retire only the rest. The fresh path's placement-to-entity binding is the shape to reproduce; the
  restore builds its entities from the save, so the match has to come from the placement's own node.
- Decide the fog-ghost approximation with the measurement in hand: either restore ghosts for pre-save work
  or keep the documented divergence.

## Verify

- A numbered before/after on the same map and save, with the interleaved A/B the perf docs require.
- A loaded world draws each harvestable exactly once, with no resurrected node after felling.
- Intact trees on a loaded map play their sway loop, and its dead trees lean with the breeze with
  the environment motion setting on, as on a fresh boot.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass on a real map.
