# Group the needs drives into `systems/agents/needs/`

**Area:** sim · **Origin:** needs-pacing worktree review, 2026-07-20 · **Priority:** P3

`systems/agents/` now holds ten loose files beside its four subfolders, and the needs slice is three of
them: `drives-needs.ts`, `rest-spot.ts` (where a settler lies down outdoors) and `sleep-at-home.ts`
(where it lies down indoors). AGENTS.md says to deepen rather than widen, and group by feature — the
tests already do exactly this under `test/agents/needs/`.

## Scope

- Move `drives-needs.ts`, `rest-spot.ts` and `sleep-at-home.ts` into `systems/agents/needs/` with an
  `index.ts` barrel so import paths stay stable.
- While there, reconsider two placements the move makes obvious:
  - `HUNGER_BUBBLE_THRESHOLD` / `FATIGUE_BUBBLE_THRESHOLD` (`drives-needs.ts`) drive no rung — their
    only consumer is the app's bubble projection. `systems/readviews/` is the documented home for
    content-derived rule tables the app reads (`readviews/hud.ts` already exports `IDLE_JOB` this way).
    Keeping the need thresholds together is also defensible; decide it explicitly.
  - `planNeeds` is up to ten positional parameters, with `limit` and `spacing` adjacent and both
    nullable-ish. `PlannerContext` (`agents/planner-context.ts`) is the established shape for this in
    the same folder; a `NeedsPlan` object would follow the local idiom and make the call sites
    self-describing.

## Verify

- `npm test` with **no** golden movement — pure structure, no behaviour.
- `npm run scan:structure`.
