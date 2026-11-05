# Move the AI build order from code data into a content-IR profile

**Area:** sim, data · **Priority:** P3

`DEFAULT_BUILD_ORDER` (`packages/sim/src/systems/computer-player/build-order/order/default-order.ts`) and the tables
that shape it per seat (`build-order/order/seat-order.ts`: the archetype tuning, the side rules, the phase and
defence raises) are const tables of stable content ids inside the sim: data in shape, but not authorable
per map or scenario. A validated IR profile would allow map and difficulty variants. No extraction source
exists for the original strategic AI's internals, so this is authored content, not pipeline output.

## Scope

- A strict content schema for the `BuildOrder`: named lines of ordered `BuildOrderEntry` steps and a line
  priority. The entry union as it stands: `place` (affinities, ground rule, resource gate, `unlessWithin`,
  `onlyWhen`, `belowTier`, `role`, `holdUntil`), `upgrade`, `collector` (`fromTick`, `stockedAt`),
  `towerCoverage`, `storeCoverage` and `housing`, with the site pace and lane rules.
- The archetype and side tables (`ARCHETYPE_TUNING`, `SIDE_RULES`, `PHASE_RAISES`, `DEFENCE_LINES`) in
  the same profile, keyed by the strategy ids the seat brief chooses.
- Move the current authored tables into the committed fallback catalog, resolve the selected profile once
  per AI seat, and leave no content-id table in sim source. The difficulty profiles' building caps and
  dropped entries (`computer-player/difficulty.ts`) trim the resolved lines and move with it. Workforce
  policy stays in [ai-workforce-content-profile](ai-workforce-content-profile.md).

## Verify

- Schema round-trips through `parseContentSet`; a fixture profile drives the executor in the existing
  module tests; fallback content preserves the current command sequence and goldens.
- `npm test`, `npm run check`, `npm run build`.
