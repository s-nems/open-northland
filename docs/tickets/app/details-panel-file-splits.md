# Split the details-panel hotspots and dedupe the text kits

## Problem

Review of the sandbox-village branch flagged three growth points in `packages/app/src/hud/details-panel/`:

- `panel.ts` (~557 lines) mixes the controller with a coherent extractable concern: the cursor-tooltip
  probes (`hitStockGood`, `hitBarValue`, `gatherChoiceHint`, `productionRowHint`, `assignButtonHint`,
  `updateTooltip`).
- `model/settler.ts` (~415 lines) grew past the ~300-line split guideline (work model, gather/craft
  choice builders, equipment, experience, status in one file).
- `chrome.ts` duplicates `text.ts`'s `textLeftMiddle` signature + doc verbatim (`Chrome` re-declares
  the `TextKit` methods); the branch had to update both in lockstep — evidence the duplication costs.

## Task

- Extract the tooltip probes from `panel.ts` into a sibling module (e.g. `hover-hints.ts`) consumed by
  the controller; keep draw/hit sources shared (`visibleStockRows`, layout rects) unchanged.
- Split `model/settler.ts` by concern (work/choices vs equipment/experience/status) under `model/`.
- Make `Chrome` extend/compose `TextKit` instead of re-declaring its method signatures.

Pure refactor: no behavior change, goldens and panel tests must stay green as-is.
