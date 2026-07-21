# Preserve deposit level counts in fog ghosts

**Area:** render · **Priority:** P2

Live deposit draw items carry both `level` and `levels`, but the remembered `FogGhost` shape stores
only the current level. When a multi-level deposit enters explored fog, frame selection falls back to
the binding's default ladder length and can show a different depletion state than the last visible
frame. This is snapshot-memory drift, not a new visual rule.

## Scope

Carry the total level count through ghost capture, update, and draw-item reconstruction. Keep old ghost
records compatible if any serialized diagnostic fixture contains them; otherwise fail explicitly.

## Verify

A render-data test observes a deposit with a non-default ladder, hides it, and asserts the ghost keeps
the same frame. Run `npm test`, `npm run check`, and `npm run build`.
