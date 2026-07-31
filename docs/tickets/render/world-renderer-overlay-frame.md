# Give WorldRenderer's transient overlays one frame context

**Area:** render · **Priority:** P3

`gpu/world-renderer/world-renderer.ts`'s `update` tail draws six transient overlays one by one, each
hand-threaded the same frame context. `selectionLayer`, `effects`, `collapses`, `damageSmoke`,
`badgeLayer` and `bubbleLayer` all read some mix of `elevation`, the cull viewport, `tick + alpha` and
the pool as `drawn`, in six different argument shapes.

Unlike the fog, these layers share no state: each owns its own. The win is the repeated context, not
ownership, so the bar is that the call site gets simpler without a generic layer framework.

`mountPainterOrder` (`gpu/world-renderer/painter-order.ts`) owns the mounted z-order and
`test/world-renderer.test.ts` pins it by container identity, so moving a layer in the scene graph now
fails a test. Nothing pins `update`'s call order, which is where this work lands: dropping or
reordering a draw there is still caught only by eye.

## Scope

- Keep `WorldRenderer` as the stable app-facing façade and retained scene-graph owner.
- Give the six transient draws one typed frame context, preserving draw order and the explicit
  container wiring.
- Do not create a generic layer framework, and do not allocate a fresh context object per frame.

## Verify

Placement, effect, badge, bubble, selection and construction-plot tests remain behavior-identical, and
the painter-order test still passes. Run `npm test`, `npm run check`, and `npm run build`, then
visually compare the construction and combat overlays.
