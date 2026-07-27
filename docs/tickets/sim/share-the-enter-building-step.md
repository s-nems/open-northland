# Share the "walk to the door and step inside" step between the rungs that use it

**Area:** sim · **Priority:** P3

Three rungs now perform the identical three steps — resolve the building's `interactionCell`, `atOrWalk`
to it, and stamp `Resting { at: building }` on arrival:

- `enterHome` — `systems/family/children.ts` (a spouse going in to make a child)
- `sleepAtHome` — `systems/settlers/sleep-at-home.ts` (a tired settler going to bed)
- `planTraining` — `systems/settlers/training.ts` (a recruit going in to drill at the barracks)

Three real callers, so it is time for one `enterBuilding(world, ctx, terrain, e, building, then)`.

The reason this is worth more than the usual dedup: `Resting` has subtle ownership rules that every call site
has to get right independently, and one of them already got it wrong. The marker means "this settler is inside
and the render must not draw it"; `planner/replan.ts` strips it on every re-plan except under `FamilyDuty`,
`drive-ladder.ts` strips it when a needs drive fires except when the settler just got into its own bed, and
`children.ts` reads it as the is-inside test. A shared helper is the place to state that contract once, rather
than having each caller re-derive who may hold the marker and when.

## Scope

- One `enterBuilding` helper every call site uses, carrying the marker contract in its doc.
- No behaviour change intended → **no golden movement**; a moved golden means the refactor changed
  something.

## Verify

- `npm test`, including the existing family/child-order suites and `test/settlers/sleep-at-home.test.ts`.
