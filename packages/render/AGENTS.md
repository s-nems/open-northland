# Render package contract

`packages/render` projects snapshots into a PixiJS scene. It may use floats and GPU APIs, but it must
never mutate the simulation or read live component stores. The root
[`AGENTS.md`](../../AGENTS.md) also applies.

## Screen-bounded cost

Per-frame draw cost must follow the viewport, not total map size.

- Keep a retained scene graph. Reconcile and update display objects instead of rebuilding them each
  frame.
- Chunk static terrain and cull chunks by viewport bounds.
- Cull sprites before drawing. Keep off-screen live entities pooled and destroy only entities that
  left the snapshot. A cheap transient overlay node may instead retire on cull and re-mint on return
  when retaining it would scale with entity state, not the screen (the settler-bubble policy).
- Cache frame textures and decoded bindings.
- Preserve batching. Per-sprite filters, masks, and blend modes need a measured reason.
- Keep zoom-out bounded. A wider view needs a deliberate level-of-detail strategy.

The current sprite visibility pass may still inspect all entities, but submitted draw work must stay
close to the visible set. If that CPU scan becomes material, add a tested spatial query rather than
weakening culling.

## Depth, colour, and shadows

Isometric depth decisions must be stable for the same snapshot. Keep projection, pre-lift sorting,
anchors, and cull extents in pure tested helpers where possible.

The sorted layer paints in passes, each a depth band under the next (`data/scene/depth.ts`): the still
landscape, then fish, then everything else by feet row. A landscape record joins the still pass on
`GfxStatic` alone. In CnMod 1.3.2 that is safe for every such record: across the 98 that block walking,
the sprite's top stays within 19 px (one half-cell row) of the first free row behind its
`LogicWalkBlockArea`, so nothing can stand behind one, while 227 of the 297 animated blocking records
rise above theirs. Re-measure that from `ir.json` and the served atlases before trusting a new input.
A new "what draws over what" case picks a pass or a same-anchor paint step; it does not get its own
sort-row override.

Team colour is a palette-band remap, not a whole-sprite tint. Keep custom palette rendering limited
to assets that need it because it can reduce batching.

Shadow and terrain-lighting choices need a named source basis or approximation. Do not infer a new
visual rule from a passing structural test.

## Verification

Headless tests can verify frame choice, projection, culling, reconciliation, bounds, and absence of
page errors. Headless Chromium does not provide trustworthy real-GPU frame timing.

Measure sim step, snapshot, scene update, and GPU/compositor time separately before assigning a
performance problem to render. Use a reproducible screenshot or browser scene for the final visual
check, and leave pixel judgement to a human.
