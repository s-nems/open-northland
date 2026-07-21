# Bound the settler-bubble layer by the screen, not the settler count

**Area:** render + app · **Priority:** P2

The bubble layer was built for rare states (wedding hearts); the need bubbles made `hungry`/`sleepy`
common transients — during a famine every settler past ¾ hunger carries one. Today
`computeSettlerBubbles` (`packages/app/src/view/projections/settler-bubbles.ts`) allocates a bubble
per needy settler MAP-WIDE per frame, and `SettlerBubbleLayer.draw`
(`packages/render/src/gpu/overlays/bubble-layer.ts`) computes `headOf` for every bubble before its
viewport cull and retains a pooled hidden `Container` per off-screen bubble. That is entity-scaled
per-frame work and retained-node growth — against the render rule that per-frame cost tracks the
screen (root AGENTS rule 6). A large hungry population therefore makes an off-screen state affect
frame cost and retained display-object count.

## Scope

- Cull on the raw snapshot position BEFORE projecting/`headOf`, so off-screen needy settlers cost a
  bounds test, not a projection.
- Let far-off bubble nodes retire from the pool instead of retaining a hidden `Container` each
  (mirror the sprite pool's cull-retire policy).
- `?debug=perf` before/after over a large hungry population to show the frame slice drop.

## Verify

- Existing bubble-layer unit tests keep passing; a new one pins that an off-viewport needy settler
  produces no pooled node.
