# Split WorldRenderer's retained-layer coordination by concern

**Area:** render · **Priority:** P3

`gpu/world-renderer/world-renderer.ts` is about 530 lines and now coordinates terrain, map objects,
sprites, fog memory, placement overlays, combat effects, badges, bubbles, the portrait cutout, and
screen chrome. The public façade is useful, but fog/static-memory ownership and transient overlay
coordination have become independent state machines inside the same class.

## Scope

- Keep `WorldRenderer` as the stable app-facing façade and retained scene-graph owner.
- Extract fog view/ghost/static-object handoff into one cohesive collaborator.
- Group transient world overlays behind a typed frame/update boundary without changing draw order.
- Do not create a generic layer framework or allocate per frame; preserve the current explicit wiring.

## Verify

World-renderer, fog, placement, effect, and portrait tests remain behavior-identical. Run `npm test`,
`npm run check`, and `npm run build`, then visually compare fog and construction/combat overlays.

