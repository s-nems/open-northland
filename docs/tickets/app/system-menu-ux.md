# Polish the in-game system menu (Esc, quit-guard, pause-on-open, focus)

**Area:** app (view/system-menu) · **Origin:** game-shell-session review, 2026-07-15 · **Priority:** P3

`view/system-menu.ts` (opened by the `options` tool-panel button) is a thin first slice: a DOM modal
with "return to menu" + "close". The code and gameplay reviews flagged UX polish deliberately deferred
from that slice — none blocking, all conventional for a system/pause menu.

## Scope

1. **Esc to close.** Add a `window` keydown that closes the menu on `Escape` while open, removed in
   `dispose()`. Mind the tool panel's existing Esc (`hud/tool-panel/index.ts` — cancels
   placement/goods-drop; its input-claim order is order-sensitive and comment-protected): when the menu
   is open, Esc should close it and not also cancel a placement. Esc-to-*open* is the stronger RTS
   convention but collides with placement-cancel Esc — gate it carefully or leave it out.
2. **Guard the destructive quit.** "Wróć do menu" abandons a running game via full-page navigation with
   no confirm and no undo (and no save yet), while sharing one style with "Zamknij" stacked 10px above
   it — a misclick loses the session. Deprioritize it visually (secondary styling / separation / order)
   or add a confirm step.
3. **Pause the sim while open.** The RAF loop keeps stepping behind the dim backdrop (`view/game-view.ts`
   only stops it on quit). A system/pause menu conventionally freezes play — set `control.paused` on
   open and restore the prior speed on close. A `P` pause already exists to model it on.
4. **Accessibility.** The panel sets `role="dialog"`/`aria-modal="true"` but never moves focus into the
   dialog or traps/restores it, so keyboard/AT users can't easily reach or dismiss it. Pairs with (1).

## Verify

Browser: Esc closes the menu; the sim is frozen while it's open and resumes on close; "return to menu"
does not read as the accidental default action; keyboard can reach and dismiss the menu. `npm test`,
`npm run check`, `npm run build`.

## Source basis

Engine-shell UX slice, no original-game mechanic — RTS/desktop-modal conventions, not fidelity.
