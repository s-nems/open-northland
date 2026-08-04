# Split the app's `isSettler` into the two questions its callers ask

**Area:** app · **Priority:** P3

`isSettler` (`game/snapshot-base.ts`) tests for the `Settler` component, which wildlife carries too. The
sim now separates the two with the `Person` marker, and `cloneEntity` is generic over the component
table, so `Person` is already in every snapshot and this side can key on it.

Its 25 call sites ask two different questions and the name hides which:

- "a person" - shelter occupancy (`hud/details-panel/worker-selection.ts`), building workers, the house
  and assign highlights, the action-ring menu state, the family reads in `game/snapshot-family.ts`;
- "anything with a body" - selection and order targets (`view/unit-controls/`), the life hearts, the
  minimap dots. A claimed cow the player can click is correct there.

Nothing is wrong on today's content: no decoded animal tribe shares an id with a civilization. The cost
is that a reader cannot tell which meaning a call site intends, and the two drift apart the moment one
of them matters.

## Scope

- Add a person-only predicate beside `isSettler`, and move each call site to the one it means. Decide
  per site; a blanket rename is the wrong answer.
- The opening camera (`game/map-start.ts`) centres on owned settlers - a claimed herd currently pulls
  it. Decide that one deliberately rather than by inheritance.

## Verify

- `npm run check`, `npm run build`, `npm test`.
- Selection, the action ring, and the minimap are player-visible: name the scene and what to click.
