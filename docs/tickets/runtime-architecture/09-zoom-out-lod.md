# Bound the frame cost across the zoom range with named detail tiers

**Area:** render, app · **Focus:** world-renderer, sprite-pool · **Priority:** P3
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md), [03 Mirror indexes](03-mirror-indexes.md)

`MIN_ZOOM` is 0.35, so the widest view covers about eight times the world area of zoom 1 and the
visible set grows with it. The render contract requires a deliberate level-of-detail strategy for a
wider view and none exists: every layer draws at every scale, including cast and soft shadows, head
overlays, environment motion, bubbles and decor shadows.

## Scope

- Measure first on the 00 checkpoint: frame cost and drawn counts at zoom 1, 0.7, 0.5 and 0.35, per
  layer.
- Define tiers by camera scale and what each drops or simplifies: shadows and soft shadows, head
  overlays and sway, bubbles and badges, decor shadows, then characters as single frames. Tier
  thresholds are named constants; the user judges the look of each tier.
- The tiers apply to the sprite pool, the map-object layer and the marks, through the indexes of 03,
  so a tier change never rescans the world.

## Verify

- Frame cost at `MIN_ZOOM` on the 00 checkpoint stays within a stated ratio of zoom 1, with the
  ratio and the per-layer numbers in the closing report.
- One screenshot per tier for the user's visual sign-off.
- `npm test`, `npm run check`, `npm run build`.
