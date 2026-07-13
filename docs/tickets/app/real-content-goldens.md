# Move the app tests to real good ids after the real-content switch

**Area:** app tests · **Origin:** global-content plan reconciliation, 2026-07-12 · **Blocked by:**
[real-content-switch](real-content-switch.md) · **Priority:** P2

Seven app test files still assert fabricated sandbox ids: `details-panel-model.test.ts` and
`details-panel-layout.test.ts` (the 2026-07-13 split of `details-panel.test.ts`) plus
`gathering-bindings.test.ts` and `gathering-scene-render.test.ts` import from `game/sandbox/index.js`;
`vertical-slice.test.ts`, `resource-gfx.test.ts`, `scenes.test.ts` build on sandbox content.

Sim-package goldens are built from `packages/sim/test/fixtures/content.ts` (`testContent()`), never
`sandboxContent` — they must stay byte-identical throughout.

Note: there is no committed shot PNG golden to rebuild — `packages/app/scripts/shot.mjs` generates
on demand for human/agent eyeballing.

## Scope

- Update the seven app test files to real good ids / real stock; this is the intentional app-golden
  move of the chain, done last so it happens once.

## Verify

- `npm test` + `npm run check` + `npm run build`; sim goldens byte-identical.
