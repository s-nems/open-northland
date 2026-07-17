# Reconcile the build menu and goods palette's fractional UI scale

**Area:** app (hud/tool-panel) · **Origin:** /refactor-cleanup on packages/app, 2026-07-17 ·
**Priority:** P2
**Needs user:** which of the two is correct is a visual/fidelity call against the original — an agent
cannot self-judge whether the original's windows scale fractionally or snap to integer steps.

The two tool-panel windows resolve the same `opts.scale` differently:

- `hud/tool-panel/building-menu.ts:163` — `const s = Math.max(1, opts.scale);`
- `hud/tool-panel/goods-menu.ts:98` — `const s = Math.max(1, Math.floor(opts.scale));`

`DEFAULT_UI_SCALE` is `1.4` (`hud/tool-panel/layout.ts:105`), parsed once in
`view/runtime/game-view.ts:137` (`floatParam(params, 'uiscale', DEFAULT_UI_SCALE)`, fractional
allowed) and handed to both windows. So at the **default** the build menu draws at 1.4× and the goods
palette at 1.0×: two windows in the same strip at different scales. Player-visible, and neither
`Math.floor` nor its absence carries a comment saying why.

Whichever way it resolves, one of the two moves — a **behavior change** either way.

**Source basis:** unknown, and this is the investigate-first item. `Math.floor` looks like a
pixel-art nearest-integer choice (a 1.4× paletted blit resamples); the build menu's fractional path
looks like the deliberate one, since `game-view.ts` documents the scale as "fractional allowed". Pin
the answer against the original's behavior or the panel's atlas metrics before picking.

## Scope

- Determine which resolution is intended (fractional everywhere, or integer-snap everywhere) and apply
  it to both files, with a comment naming the basis.
- Grep for other `opts.scale` / `uiscale` consumers in `hud/tool-panel/` and the action ring, and make
  them agree — this ticket is about the whole strip resolving one scale one way, not just these two
  lines.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: `npm run dev` → `?scene=sandbox`, open the
build menu and the goods palette side by side at the default `?uiscale=1.4`, then at `?uiscale=2` and
`?uiscale=1` — the two windows must read as one strip at every scale. **User's eyes** sign off.
