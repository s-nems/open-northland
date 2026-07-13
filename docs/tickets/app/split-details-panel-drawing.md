# Decompose the details-panel drawing modules

**Area:** packages/app · **Origin:** /refactor-cleanup app (Tier C, deferred), 2026-07-12 · **Priority:** P3

The bottom-right selection details panel (`packages/app/src/hud/details-panel/`) was split into a
pure `model/` + drawing/mount modules in an earlier pass. Two of its three over-budget drawing
modules have since been decomposed into subfolders — `layout.ts` → `layout/` and `sections.ts` →
`sections/`, both now under budget. One drawing module is still over the ~300-line split rule:

- `hud/details-panel/chrome.ts` (500 lines) — the `createChrome` layer/factory.

## Scope

Behavior-preserving decomposition of `chrome.ts` by concern (assess it for a text/layers split).
Bodies move verbatim; any rename/logic change rides its own hunk. Keep the `details-panel/` barrel
(`index.ts`) import surface stable. Diagnose the real seams by reading the callers (`panel.ts`,
`unit-controls.ts`) before cutting — do not split a cohesive factory just to hit a line count.

## Verify

`npm test` (the details-panel model tests stay green), `npm run check`, `npm run build`; boot a
`?scene=` with a selection and eyeball the building + settler + compact cards (human sign-off for the
pixels — an agent can't self-judge the panel art).
