# Move the app tests to real good ids after the real-content switch

**Area:** app tests · **Origin:** global-content plan reconciliation, 2026-07-12 · **Blocked by:**
[real-content-switch](real-content-switch.md)

Five app tests still assert fabricated sandbox ids: `details-panel.test.ts` and
`gathering-render.test.ts` import `GOOD_WOOD` etc. from `game/sandbox/ids.ts`;
`vertical-slice.test.ts`, `resource-gfx.test.ts`, `scenes.test.ts` build on sandbox content.

Sim-package goldens are built from `packages/sim/test/fixtures/content.ts` (`testContent()`), never
`sandboxContent` — they must stay byte-identical throughout.

Note: there is no committed shot PNG golden to rebuild — `packages/app/scripts/shot.mjs` generates
on demand for human/agent eyeballing.

## Scope

- Update the five app tests to real good ids / real stock; this is the intentional app-golden move
  of the chain, done last so it happens once.

## Verify

- `npm test` + `npm run check` + `npm run build`; sim goldens byte-identical.
