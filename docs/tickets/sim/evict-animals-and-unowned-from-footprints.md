# Evict animals and unowned units from newly-blocked footprints

`evictSettlersFromFootprint` (packages/sim/src/systems/movement/evict.ts) displaces settlers standing
on a plot the moment it becomes impassable — building placement, construction finish, home tier
upgrade. It deliberately moves only **player-owned settlers** (the same Owner gate as the spacing
drives in `systems/agents/destack.ts`, keeping unowned scenario fixtures byte-identical).

Two occupant classes therefore still end up standing inside walls:

- **Herd animals** (`HerdMember` creatures) — they carry no `Settler`, so a deer standing where a
  house is placed stays inside the finished building.
- **Unowned settlers** — neutral/scenario units on the plot are left in place by the Owner gate.

A related gap on the *destination* side: `nearestFreeCellOutside` builds its `occupancy` only from the
owned, non-travelling settlers it also considers for eviction. So an evictee can be placed on a cell
already occupied by a travelling settler, an unowned settler, or an animal, producing a transient stack.
Owned stacks resolve via the spacing drive next tick, but an unowned/animal co-occupant will not
de-stack. When widening who gets evicted, also widen the occupancy filter so displaced units don't land
on top of the very classes this ticket adds.

Task: extend the eviction to herd animals (and decide whether unowned settlers should keep the
byte-identical stance or be displaced too — if they move, the affected goldens must be updated
intentionally); widen the free-cell `occupancy` filter to match. Reuse the existing displacement search
(`nearestFreeCellOutside`), keep canonical ascending-id order, and cover with a test beside
`packages/sim/test/movement/evict.test.ts`.
