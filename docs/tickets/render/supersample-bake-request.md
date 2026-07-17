# Collapse the supersample bake signature into a request object

**Area:** render, app · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3

`gpu/supersample.ts` exposes `bakeToFlippedSprite(renderer, source, texW, texH, invScale)` (and its
unflipped twin). `texW`/`texH` are adjacent same-typed numbers a caller can transpose silently, and all
four call sites pass the identical tuple shape:

- `app/src/hud/details-panel/panel.ts`
- `app/src/hud/minimap/frame.ts`
- `app/src/hud/icon-texture.ts`
- `app/src/hud/tool-panel/strip-texture.ts`

This is the exact hazard `WorldFrame` was introduced to kill one file over in the same package — its
doc says "named rather than positional so the same-typed `selection`/`flagged` sets cannot be swapped
silently". The supersample API never got the same treatment.

## Scope

One `BakeRequest { renderer, source, texW, texH, invScale }` param object, threaded through the private
`bake` helper. **Keep the two distinct export names** — the flip decision is the genuinely load-bearing
API distinction and should stay in the name, not become a boolean field.

Update the four app call sites in the same change.

Explicitly out of scope: `oversampleFor(scale, resolution, floor, cap)`. Both its callers already pass
named constants (`FRAME_SS_FLOOR`/`FRAME_SS_CAP`, `MIN_SUPERSAMPLE`/`MAX_SUPERSAMPLE`), which defuses
the hazard at the call site.

## Verify

`npm test`, `npm run check`, `npm run build`. Behaviour-preserving (a pure signature reshape), but the
consumers are all HUD chrome — a `npm run shot` or a browser pass over the details panel, minimap and
tool panel confirms nothing re-baked at the wrong size. Human sign-off on the chrome.
