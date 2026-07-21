# Correct and bound the details-panel worker overlay

**Area:** app · **Priority:** P2

`WorkerSpriteOverlay` narrows the snapshot to the selected building's settlers before calling
`buildSpriteScene`. That removes buildings and work targets needed for indoor-state and facing
resolution, so store workers can animate when they should be frozen and workers can face a stale
direction. The overlay also keys pooled sprites by entity id and only hides old entries; clicking
through many buildings grows the map and its per-update scan for the rest of the session.

## Scope

- Resolve worker draw items from the full snapshot, then filter the result to the at-most-eight displayed
  workers. Use one indoor-capable scene collection rather than two projections.
- Bound display objects by panel slot and layer, or destroy entries not drawn in the current update.
  Apply the same bounded ownership to fallback textures if profiling shows entity-keyed growth there.
- Keep the existing panel layout and animation rules.

## Verify

- Tests cover an indoor store worker, target-facing during work, and a long sequence of different worker
  ids whose retained object count stays bounded.
- `npm test`, `npm run check`, and `npm run build` pass; visually check a staffed store panel.

