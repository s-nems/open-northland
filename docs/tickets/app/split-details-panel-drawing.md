# Decompose the details-panel drawing modules

**Area:** packages/app · **Origin:** /refactor-cleanup app (Tier C, deferred), 2026-07-12 · **Priority:** P3

The bottom-right selection details panel (`packages/app/src/hud/details-panel/`) was split into a
pure `model/` + drawing/mount modules in an earlier pass. Two of its three over-budget drawing
modules have since been decomposed into subfolders — `layout.ts` → `layout/` and `sections.ts` →
`sections/`, both now under budget — and the text + frame-border kits were extracted from
`chrome.ts` (2026-07-13, `text.ts`/`frame-border.ts`). One drawing module remains marginally over
the ~300-line split rule:

- `hud/details-panel/chrome.ts` (332 lines) — the `createChrome` layer/factory.

## Scope

Behavior-preserving decomposition of what remains in `chrome.ts` by concern. Bodies move verbatim;
any rename/logic change rides its own hunk. Keep the `details-panel/` barrel (`index.ts`) import
surface stable. Diagnose the real seams by reading the callers (`panel.ts`, `unit-controls.ts`)
before cutting — do not split a cohesive factory just to hit a line count; at 332 lines, concluding
the remaining factory is cohesive and **deleting this ticket** (say why in the commit) is a valid
outcome.

## Verify

`npm test` (the details-panel model tests stay green), `npm run check`, `npm run build`; boot a
`?scene=` with a selection and eyeball the building + settler + compact cards (human sign-off for the
pixels — an agent can't self-judge the panel art).
