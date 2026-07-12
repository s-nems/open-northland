# Decompose the details-panel drawing modules

**Area:** packages/app · **Origin:** /refactor-cleanup app (Tier C, deferred), 2026-07-12

The bottom-right selection details panel (`packages/app/src/hud/details-panel/`) was split into a
pure `model/` + drawing/mount modules in an earlier pass, but three of its drawing modules are still
well over the ~300-line split rule and were left out of the Tier A+B decomposition pass (the user
scoped that pass to the god-functions/data-modules elsewhere):

- `hud/details-panel/chrome.ts` (~590 lines) — the `createChrome` layer/factory.
- `hud/details-panel/layout.ts` (~504 lines) — layout constants + the `layoutDetails` union builders.
- `hud/details-panel/sections.ts` (~497 lines) — `drawBuilding`/`drawSettler`/`drawCompact` + their
  per-section draw helpers.

## Scope

Behavior-preserving decomposition of these three by concern (e.g. `sections.ts` → per-face draw
modules for building / settler / compact; `layout.ts` → shared constants vs the per-face layout
builders; assess `chrome.ts` for a text/layers split). Bodies move verbatim; any rename/logic change
rides its own hunk. Keep the `details-panel/` barrel (`index.ts`) import surface stable. Diagnose the
real seams by reading the callers (`panel.ts`, `unit-controls.ts`) before cutting — do not split a
cohesive factory just to hit a line count.

## Verify

`npm test` (the details-panel model tests stay green), `npm run check`, `npm run build`; boot a
`?scene=` with a selection and eyeball the building + settler + compact cards (human sign-off for the
pixels — an agent can't self-judge the panel art).
