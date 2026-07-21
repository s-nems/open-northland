# Share the "walk to the door and step inside" step between the family and sleep rungs

**Area:** sim · **Priority:** P3

Two rungs now perform the identical three steps — resolve the building's `interactionCell`, `atOrWalk`
to it, and stamp `Resting { at: building }` on arrival:

- `enterHome` — `systems/family/children.ts` (a spouse going in to make a child)
- `sleepAtHome` — `systems/agents/sleep-at-home.ts` (a tired settler going to bed)

Second real caller, so it is time for one `enterBuilding(world, ctx, terrain, e, building, then)`.

The reason this is worth more than the usual dedup: `Resting` has subtle ownership rules that both
call sites have to get right independently, and one of them already got it wrong. The marker means
"this settler is inside and the render must not draw it"; `replan.ts` strips it on every re-plan except
under `FamilyDuty`, `ai.ts` strips it when a needs drive fires except when the settler just got into
its own bed, and `children.ts` reads it as the is-inside test. A shared helper is the place to state
that contract once, rather than having each caller re-derive who may hold the marker and when.

Related loose end to settle in the same pass: `components/economy/farming.ts` documents `Resting` as
"purely a render fact, no sim decision reads it", which has been false since `children.ts` started
using it as the inside test.

## Scope

- One `enterBuilding` helper both call sites use, carrying the marker contract in its doc.
- Fix the stale `Resting` doc comment.
- No behaviour change intended → **no golden movement**; a moved golden means the refactor changed
  something.

## Verify

- `npm test`, including the existing family/child-order suites and `test/agents/sleep-at-home.test.ts`.
