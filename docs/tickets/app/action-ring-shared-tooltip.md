# Move the action ring onto the shared view/tooltip chip

**Area:** app (view/unit-controls/action-ring) · **Origin:** /refactor-cleanup on packages/app,
2026-07-17 · **Priority:** P3
**Needs user:** the shared chip looks and anchors differently from the hand-rolled one — a human must
sign off the visual delta (or say which of the two is correct).

`view/unit-controls/action-ring/settler-actions.ts` hand-rolls a DOM tooltip: its own `TOOLTIP_STYLE`
(~`:78`), its own `el('div', TOOLTIP_STYLE)` (~`:157`), and inlined show/position/hide
(`tooltip.style.left = clientX + 12`, `top = clientY - 22`, ~`:384-385`).

`view/tooltip.ts`'s `createTooltip()` is exactly that abstraction — a cursor-following dark DOM chip
over the WebGL canvas — and already has two real callers (`view/ground-pile-tooltip.ts:54`,
`view/runtime/game-view.ts:262`). The action ring is a third copy, well past AGENTS.md's
"deduplicate at the second real caller" bar.

Not folded in during the cleanup because it is **not behavior-preserving** — the two chips differ
visually:

| | hand-rolled ring chip | `createTooltip` |
|---|---|---|
| font | `12px/1.4 ui-monospace,…,Menlo,monospace` | `13px/1.4 system-ui,-apple-system,sans-serif` |
| anchor | above-right: `+12 / −22` | below-right: `+14 / +14` (`CURSOR_OFFSET`) |
| viewport clamp | none | clamps to `window.innerWidth` with `EDGE_MARGIN` |
| wrap | none | `max-width:300px`, `white-space:pre-line` |

Behavior-preservable only by parameterising the offset (and accepting the font/clamp change, or
parameterising those too). The clamp is arguably an improvement — the ring's chip can currently run off
the right edge.

**Source basis:** structural dedup; the chip styling is OpenNorthland's own HUD convention, not an
original-game visual.

## Scope

- Decide with the user: adopt `createTooltip` as-is (accept sans font + below-right + clamping), or add
  an optional offset (e.g. `createTooltip({ offsetX, offsetY })`) so the ring keeps its above-right
  anchor while gaining the shared element/clamp.
- Replace `TOOLTIP_STYLE` + the inlined show/position/hide in `settler-actions.ts` with the shared
  `Tooltip`; call `destroy()` on the ring's teardown path (the hand-rolled div is removed today —
  do not leak an element).
- Delete `TOOLTIP_STYLE` and any now-dead `el(...)` helper use.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: `npm run dev` → `?scene=sandbox`, select a
settler, hover each action-ring button near the screen edge and confirm the chip reads correctly and
stays on-screen — **user's eyes** on the font/anchor delta.
