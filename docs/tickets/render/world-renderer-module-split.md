# Group WorldRenderer's transient overlays behind one frame boundary

**Area:** render · **Priority:** P3

The fog half of this landed: `WorldFog` (`gpu/world-renderer/world-fog.ts`) owns the wash, the ghost
memory and the statically-drawn refs, and hands `update` one typed `FogPoolFrame` slice.

`gpu/world-renderer/world-renderer.ts` is now about 480 lines and still wires ten transient overlays
one by one: construction plots, the placement wash and cursor ghost, selection rings, combat marks,
collapses, damage smoke, door badges, settler bubbles, and the geometry debug overlay. Each carries
its own setter, its own draw call inside `update`'s fixed z-order, and its own line in `dispose`.

## Scope

- Keep `WorldRenderer` as the stable app-facing façade and retained scene-graph owner.
- Group the transient overlays behind a typed frame/update boundary that preserves the current draw
  order and the explicit container wiring.
- Do not create a generic layer framework or allocate per frame.

## Verify

Placement, effect, badge, bubble, selection and construction-plot tests remain behavior-identical.
Run `npm test`, `npm run check`, and `npm run build`, then visually compare the construction and
combat overlays.
