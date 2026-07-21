# Keep manual ground drops out of vehicle holds

**Area:** sim (goods effects) · **Priority:** P3

`dropOrStackGood` (`packages/sim/src/systems/agents/effects-goods/piles.ts`) excludes a `GroundDrop`
trunk and a `Building` store from its stack candidates, but not a `Vehicle`. A boat hull is
`Position` + `Vehicle` + an empty `Stockpile` (`systems/command/placement.ts` `placeBoat`), placed at
`positionOfNode(command.x, command.y)` — the exact position the `dropGood` command also drops at
(`systems/command/index.ts`). So a player dropping goods on a hull's node passes every filter (no
marker component, exact Position match, `have = 0` with `amounts.size === 0`) and the units land in
the hull's hold, capped at `MAX_GROUND_STACK` rather than the ship type's `stockSlots`, bypassing the
cargo-load path entirely. `dropOrStackGood` then returns the hull as if it were a pile.

Verified directly: a hull at node (9,9) + `dropOrStackGood` at that node returns the hull with the
goods in its hold. The gatherer/porter path is unaffected — `stackOntoTile` filters through
`isYardHeap` (`systems/stores/capacity.ts`), which does exclude `Vehicle`.

The spatial-index change deliberately preserved this: routing the lookup through `stockpilesAtNode`
kept every filter verbatim so goldens stayed byte-identical, and excluding vehicles there would have
been an unnamed behavior change inside a perf refactor.

## Scope

- Make `dropOrStackGood` skip a `Vehicle` like its `stackOntoTile` twin does, so a hand-dropped good
  starts a loose pile on the hull's node. Deliberate cargo loading needs the vehicle's real
  `stockSlots` capacity and cargo filter and is out of scope.
- If the pick changes, a golden may legitimately move: name the mechanic in the commit.
- Consider whether the two twins' candidate filters should converge on the single `isYardHeap`
  predicate rather than each spelling out its own marker exclusions — the drift is what let them
  disagree about vehicles in the first place.

## Verify

Unit test: a hull and a `dropGood` on its node → the goods rest as a loose ground pile, the hold
stays empty; the existing `stackOntoTile` yard behavior is unchanged. `npm test`.
