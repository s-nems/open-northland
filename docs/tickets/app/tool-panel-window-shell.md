# Extract the shared tool-panel window shell (menu/goods/stats triplication)

**Area:** app (hud/tool-panel) · **Origin:** pre-release quality audit 2026-07-13 · **Priority:** P3

Three tool-panel window controllers re-implement the same lifecycle plumbing:
`menu-window.ts` (335 lines), `goods-window.ts` (138), `stats-window.ts` (131) each own their
open/toggle/close state, input-claim registration, `handleClick` routing, rebuild scheduling, and
`runs[]` glyph cleanup — `goods-window.ts` even calls itself "the twin of `createMenuWindow`". At
three real callers the project's deduplicate-at-the-second-caller rule is past due, and
docs/tickets/app/hud-missing-windows.md is about to add more windows on the same pattern — extract
the shell **before** it gets copied a fourth time.

## Scope

1. Read the three controllers side by side and split shared shell from per-window content: the
   shell is the open/toggle/close + claims + click-dispatch + rebuild + cleanup skeleton; the
   content is each window's layout/model/glyph population. Expect the shell to take a small
   per-window spec (title, body builder, click regions).
2. Extract it under `packages/app/src/hud/tool-panel/` (e.g. `window-shell.ts`) and rebase the
   three windows on it. Behavior-preserving: same open/close semantics, same input-claim order —
   the tool panel's `stopImmediatePropagation` priority chain is order-sensitive and only
   comment-protected, so keep mount/claim order byte-for-byte.
3. Keep the pure-model / thin-controller split intact — the shell is controller-side plumbing; the
   window models (`hud/details-panel/model/`-style pure halves) stay untouched.
4. Update docs/tickets/app/hud-missing-windows.md's note about "the existing tool-panel window
   style" to point at the shell once it exists.

## Verify

`npm test` (tool-panel controller tests, incl. the perf contract that a tick-only change must not
rebuild glyph runs), `npm run check`, `npm run build`. Browser check — each window still opens,
toggles, closes, and claims clicks over the map; panel layout unchanged — **user's eyes**.

## Source basis

Pure refactor; no mechanic or visual change intended.
