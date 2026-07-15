# Survey and rank the missing left-panel HUD windows, file per-window tickets

**Area:** app (hud) · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P2

The decoded GUI atlas pins **9** left-panel buttons but the HUD implements only a few of their
windows. Source basis: the project-maintained GUI-button table in
`packages/app/src/content/gui-atlas-map.ts`, with tooltip ids from the decoded string tables —
`0x2a` buildings, `0x2b` population, `0x2c` diplomacy, `0x2d` extras, `0x2e` mission, `0x2f`
options, `0x30` help, `0x32` statistics, `0x38` tech-tree. Implemented under
`packages/app/src/hud/tool-panel/` (2026-07-13): `building-menu.ts`, `stats-window.ts`,
`goods-window.ts`, `menu-window.ts` (plus speed/goods-drop controls). Missing (after the survey
reconciles which decoded button `goods-window`/`menu-window` actually correspond to — likely
`extras` and/or none): **population, diplomacy, mission/objectives, options, help, tech-tree**. The
art/icons are already decoded — this is app work, not pipeline work.

This is a **survey ticket**: deliverable is a ranking + one filed ticket per window pursued, with
implementing the single top-ranked window in the same session in scope if it fits.

## Scope

1. Reconcile the implemented windows against the 9 decoded buttons (which stringId each maps to;
   which buttons are currently dead or absent in the tool panel, checking uncertain mappings in the
   running original).
2. Rank the missing windows by player value against what the sim/app can already feed them
   (suggested starting order: **options, mission/objectives, tech-tree** — options needs no sim
   data; mission pairs with docs/tickets/features/victory-defeat-conditions.md; tech-tree depends on
   whether any tech/progress data exists in the IR — check before ranking it high). Population and
   diplomacy need sim surfaces that may not exist yet; say what's missing.
3. File one self-contained ticket per window the survey decides to pursue (context: decoded button
   frame + stringId, data source in sim/content, and what the original window shows through direct
   observation).
4. If the top-ranked window is small (options likely is), implement it in the same session:
   button wired in the tool panel, window built on the shared `tool-panel/window-shell.ts` lifecycle
   (open flag + text runs + graphics buffer + open-gated claim) — the seam menu/goods/stats already share.

## Verify

- Deliverable check: every pursued window has a filed ticket naming its data source and decoded art.
- If a window was implemented: browser check — button opens/closes it, tooltip string matches the
  decoded stringId table, no layout breakage in the tool panel — **user's eyes**; `npm test`,
  `npm run check`, `npm run build`.
