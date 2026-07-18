# Give the "remove from home" button a distinct glyph (not the shared house icon)

**Area:** app (HUD) · **Origin:** review of `app/home-unassign-button.md`, 2026-07-18 ·
**Priority:** P3

The settler details panel's three Praca controls — Assign Work Place, Assign Home, and the new
**Remove from home** — all draw the same `chrome.glyphHouse` on the same round button
(`hud/details-panel/sections/settler.ts`, the `glyphHouse` calls for `assignIcon`/`homeIcon`/
`unassignIcon`). The three stacked buttons are visually identical and distinguished only by their
text labels.

This predates the remove-from-home button (assign-workplace and assign-home already shared the
glyph), but the new control makes it sharper: "remove from home" moves a whole household out of its
house with no confirmation and no pick-mode, so a mis-click between two identical-looking icons has a
real cost. The icon gives no affordance for which control is which.

## Scope

Add a distinct glyph for the remove-from-home button — e.g. a house with a minus / an arrow leading
out / a struck-through house — drawn by a new `chrome.glyph*` method beside `glyphHouse`
(`hud/details-panel/chrome.ts`), and call it from the remove row in
`hud/details-panel/sections/settler.ts` instead of `glyphHouse`. Keep the lit/dimmed cream-tone
treatment the other glyphs use. Optionally also differentiate assign-workplace vs assign-home while
here (both currently `glyphHouse`), but the remove control is the one that matters.

Source basis: UI affordance / player-experience, not original-game fidelity — the original's human
window is the layout reference, but this glyph is OpenNorthland's own control. A human signs off the
pixels.

## Verify

`npm run dev` → `?scene=family`, select a housed settler: the remove-from-home button reads as
distinct from assign-home at a glance, stays legible lit and greyed, and the panel layout is
unchanged. `npm test`, `npm run check`, `npm run build`.
