# Evict animals and unowned units from newly-blocked footprints

**Area:** sim · **Priority:** P2

`evictSettlersFromFootprint` (packages/sim/src/systems/movement/evict.ts) displaces settlers standing
on a plot when building placement, construction completion, or a home upgrade makes it impassable.
It deliberately moves only **player-owned settlers** (the same Owner gate as the spacing
drives in `systems/agents/destack.ts`, keeping unowned scenario fixtures byte-identical).

Two occupant classes therefore still end up standing inside walls:

- **Herd animals** (`HerdMember` creatures): they carry no `Settler`, so a deer standing where a
  house is placed stays inside the finished building.
- **Unowned settlers**: neutral/scenario units on the plot are left in place by the Owner gate.

A related gap on the *destination* side: `nearestFreeCellOutside` builds its `occupancy` only from the
owned, non-travelling settlers it also considers for eviction. So an evictee can be placed on a cell
already occupied by a travelling settler, an unowned settler, or an animal, producing a transient stack.
Owned stacks resolve via the spacing drive next tick, but an unowned/animal co-occupant will not
de-stack. When widening who gets evicted, also widen the occupancy filter so displaced units don't land
on top of the very classes this ticket adds.

## Scope

- Evict herd animals and settlers regardless of ownership when a new footprint covers their node.
- Build destination occupancy from every physical unit, not only the entities eligible in the old
  owner-filtered pass.
- Reuse `nearestFreeCellOutside` and keep canonical ascending-id order. Name any intentional golden
  change caused by moving a previously ignored neutral fixture.

## Verify

Cases beside `packages/sim/test/movement/evict.test.ts` cover an animal and neutral settler on the
new footprint, plus an occupied destination that must be skipped. Run `npm test`, `npm run check`,
and `npm run build`.
