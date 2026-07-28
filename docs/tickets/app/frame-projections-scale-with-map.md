# Make the per-frame snapshot projections screen-bounded, not map-bounded

**Area:** app + render · **Priority:** P1

Every display frame that carries a new tick walks the full `WorldSnapshot.entities` array once per
projection. On `magiczny_las` that array holds ~36 300 entities while ~530 sprites are actually drawn,
so the per-frame cost tracks the map's scenery rather than the visible screen — the scaling budget in
the root `AGENTS.md` puts per-frame rendering work on the screen, not the map.

The passes, each memoized on snapshot identity and therefore rebuilt once per tick:

- `takeSnapshot` itself (`sim/inspect/snapshot.ts`) — the scenery clone cache spares the *cloning*,
  not the array build or the per-id cache probe;
- `collectSpriteScene` (`render/data/scene/sprite-scene.ts`);
- `enterableStoresOf` and `targetPositionsOf` (`render/data/scene/snapshot-index.ts`);
- `signpostBoardsOf` (`render/data/scene/signpost-boards.ts`);
- `buildHud` (`render/data/hud/model.ts`);
- `computeDoorBadges` (`app/view/projections/door-badges.ts`) — two passes, tally then project;
- `computeSettlerBubbles` (`app/view/projections/settler-bubbles.ts`);
- `forEachMinimapDot` (`app/hud/minimap/dots.ts`).

`buildHud` is the cheapest to settle: `startFrameLoop` computes `hudFor(snap)` unconditionally and
hands it to `toolPanel.controller.update`, which forwards it to `stats.refresh`. The stats window
returns early when it is closed, but its input has already been built. Defer the build behind the
window's open state.

A spectator session (`?player=overseer`, or `fog=reveal`) is the worst case and the one the
diagnostics URL uses: `fogView` is null, so no consumer culls by visibility either.

## Evidence

`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile` at tick ~46 500, read from
`window.__opennorthland.perf()` in a headed GPU-backed Chromium (`sampling.hidden` false):

| state | frame | sim | snapshot | draw | GPU | fps |
| --- | --- | --- | --- | --- | --- | --- |
| `speed=10` | 155.75 ms | 121.71 | 12.94 | 18.93 | 2.17 | 6 |
| `speed=1` | 22.87 ms | 9.79 | 4.74 | 12.94 | 0.00 | 44 |
| paused | 8.38 ms | 0 | 0 | 4.82 | 3.56 | 119 |

Paused holds the snapshot identity, so every projection memo hits and the 4.82 ms is the drawing
alone. The 31.9 ms of `snapshot + draw` a `speed=10` frame pays is therefore almost all
snapshot-and-projection rebuild, for 530 drawn sprites and an idle GPU.

Which half dominates depends on speed, and both rows above are the same world. At `speed=10` five ticks
ride one frame, so the sim's 121.71 ms buries the one rebuild. At `speed=1` every frame carries at most
one tick, so the rebuild is paid per tick and sits next to a single tick's sim cost rather than five.

## Scope

Cut the per-frame cost so it tracks drawn entities rather than map entities. The bounded first step is
the cheap half:

- build `hudFor` only when the stats window is open;
- give the projections that already have a natural screen or ownership bound (`computeDoorBadges`,
  `computeSettlerBubbles`, `forEachMinimapDot`) an index or a viewport/fog filter applied *before* the
  full walk rather than after it.

Changing the snapshot's own shape (a persistent patched array, or an id-keyed index the consumers
share instead of each re-deriving one) is the larger follow-up and is explicitly out of scope here;
file it separately once the cheap half is measured. Its prerequisite is reliable `World.touch`
coverage, already noted in
[steady-allocation-churn](../sim/steady-allocation-churn.md).

## Verify

`window.__opennorthland.perf()` on the same URL and tick horizon, before and after, comparing
`frame.snapMs` and `frame.drawMs` against the paused-frame floor. Read `sampling.hidden` first: a
background tab throttles the frame loop and voids every millisecond.

`npm test`, `npm run check`, `npm run build`. Visual output is unchanged by construction, so a human
browser pass only needs to confirm the HUD, door badges, settler bubbles and minimap dots still appear
where they did.
