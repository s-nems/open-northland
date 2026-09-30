# Approach moving livestock from a reachable summon stance

**Area:** sim · **Focus:** husbandry, movement · **Priority:** P2

A breeder can report `settlerLost` while an animal is reachable within the existing summon range.
`planSlay` in `systems/settlers/drives/husbandry/drive.ts` walks to `entityNode(animal)` exactly.
A legal diagonal crosses between two flank nodes when only one is blocked. Truncating the animal's
interpolated position can select that blocked flank, so pathfinding rejects the breeder's destination
even though an adjacent clear stance would let it summon the animal. Stranded recovery then reports
the failed walk and records that obsolete node in `UnreachableGoals`.

Source basis: current code and a synthetic full-schedule reproduction using the existing livestock
fixture; coordinates below are half-cell nodes. Put a farm and breeder at (20,20), with three adult
cows attached to it: two at (4,4) and (5,4), and the nearest at (26,18). Stamp a one-node resource walk
block at (26,19). Route the nearest
cow to (27,20) and advance it through the ordinary movement system until its legal diagonal midpoint
maps to (26,19). The next full simulation tick gives the breeder a failed request for that blocked
node. A path to the clear summon stance (25,20) exists under the same overlay. The simulation emits
`settlerLost` at tick 50 even after the cow has moved onto clear ground.

## Scope

- Approach a slaughter target from a reachable clear stance within the existing `SUMMON_RANGE`.
  Apply this to both the initial approach and following an already summoned animal.
- Refresh the approach when animal movement makes its stance obsolete, without treating a legal
  blocked-flank interpolation as proof that the animal cannot be reached.
- Preserve surplus-animal selection, breeder claims, the breeding pair and genuinely inaccessible
  livestock recovery. Keep stance searches bounded and route requests under the normal budget.

## Verify

- Add a regression under `packages/sim/test/livestock/`: use the reproduction above and confirm the
  breeder reaches summon range without `PathRequest.failed`, `settlerLost`, or an unreachable-goal
  entry for the blocked interpolation node.
- Repeat with a static water flank and a cow already assigned to the breeder's summon. Keep a control
  with an actually inaccessible animal and cover its movement while the breeder approaches.
- Run the husbandry tests and the standard gates in `docs/TESTING.md`.
