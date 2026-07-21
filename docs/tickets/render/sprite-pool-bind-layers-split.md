# Separate sprite reconciliation from per-entity layer binding

**Area:** render · **Priority:** P3

`gpu/sprite-pool/sprite-pool.ts` is about 580 lines. It owns both pool membership/lifecycle and the
roughly 200-line operation that mutates one entity's body, shadow, reveal, bounds, and texture layers.
The existing folder already separates pure motion, picking, reconciliation, and placeholder logic;
per-entity binding is the remaining mixed responsibility.

## Scope

Extract binding behind a non-allocating context containing the sheet, texture cache, and frame id.
Keep `SpritePool` responsible for membership, attach/detach, reap, and orchestration. Preserve the
public barrel and do not combine this move with frame-selection changes.

## Verify

Sprite-pool, motion, reconciliation, and scene tests remain behavior-identical. Run `npm test`,
`npm run check`, and `npm run build`; visually compare a scene with construction, shadows, and team
colours.
