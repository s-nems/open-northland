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
  left the snapshot.
- Cache frame textures and decoded bindings.
- Preserve batching. Per-sprite filters, masks, and blend modes need a measured reason.
- Keep zoom-out bounded. A wider view needs a deliberate level-of-detail strategy.

The current sprite visibility pass may still inspect all entities, but submitted draw work must stay
close to the visible set. If that CPU scan becomes material, add a tested spatial query rather than
weakening culling.

## Depth, colour, and shadows

Isometric depth decisions must be stable for the same snapshot. Keep projection, pre-lift sorting,
anchors, and cull extents in pure tested helpers where possible.

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
