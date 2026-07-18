# Unit-test the extracted action-ring pure functions

**Area:** app · **Origin:** refactor/settler-actions-split, 2026-07-18 · **Priority:** P3

The `refactor/settler-actions-split` change broke `view/unit-controls/action-ring/settler-actions.ts`
into per-concern modules and pulled two pure, snapshot-only functions out of the mount closure:

- `action-ring/selection-centre.ts` — `selectionCentre(snapshot, selection)`: the selected settlers'
  world-px centroid + ids + common trade (undefined when the selection mixes trades).
- `action-ring/menu-state.ts` — `menuStateFor(snapshot, ids, uniformJobType)`: which per-settler
  buttons the ring offers (canChangeJob / canMarry / canAssignHouse / canOrderChild / erectSignpost),
  with the single-selection, adult, widow/marrying, on-mission, and one-child-limit gates.

The now-deleted `hud-view-packaging-splits.md` ticket justified the split partly on these becoming
"separately unit-testable," but no test was landed — existing `test/action-ring-layout.test.ts` covers
only the layout/hit-test geometry, not these two. The split was a pure move (behavior verified by
build + the existing suite), so the tests were deferred, not dropped.

## Scope

Add a headless unit test (e.g. `test/action-ring-menu-state.test.ts`) over a small built sim/snapshot:

- `selectionCentre`: empty selection → null; single settler → its projected feet anchor + `[id]`;
  a mixed-trade multi-selection → `jobType: undefined`; a uniform-trade selection → that jobType;
  entities without a position are skipped.
- `menuStateFor`: multi-selection or missing/non-settler → `DEFAULT_MENU_STATE` (+ erectSignpost keyed
  on the uniform jobType, so a multi-scout selection keeps it); a child → `canChangeJob: false`, no
  family buttons; a man → `canChangeJob: true`; a woman → `canChangeJob: false`; `canMarry` off when
  bound-by-marriage / already marrying / on a mission / no eligible partner; `canOrderChild` needs a
  living spouse, female, no still-growing child, and no pending child order.

Use the sandbox scene builders / snapshot readers already in the app test harness rather than
hand-rolling entity fixtures. Assert against the snapshot shape, not sim internals.

## Verify

`npm test` (the new suite green), `npm run check`, `npm run build`. No production code change expected —
this only adds coverage for the extracted functions.

## Source basis

Test-coverage follow-up; no mechanic or behavior change.
