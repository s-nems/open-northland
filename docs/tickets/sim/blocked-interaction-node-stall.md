# Reroute a completed building whose interaction node is statically blocked

**Area:** sim (footprint/nav) · **Origin:** construction-perimeter review, 2026-07-17 · **Priority:** P3

A completed building without a `door` footprint offset resolves its interaction node to its own
anchor (`footprint/interaction.ts` `interactionNode`). If its footprint blocks that anchor, generic
delivery and operator routes still target a permanently unwalkable cell and retry without progress.
Construction builders and material deliveries no longer hit this case because under-construction
sites use `constructionWorkCells`; the remaining defect is limited to completed buildings in
synthetic or hand-authored content. All real extracted footprint-bearing buildings currently carry doors.

## Scope

Make the no-door interaction fallback choose a canonical walkable cell adjacent to the completed
building footprint when its anchor is blocked. Keep every interaction consumer on the same resolved
node so walk goals, arrival checks, worker presence, and delivery agree. Do not change normal
door-bearing buildings.

## Verify

- Unit test: a completed doorless, self-blocking building receives a delivery or operator.
- Existing door and wall-gate interaction tests remain unchanged.
- `npm test`, `npm run check`, and `npm run build` pass without unintended golden movement.
