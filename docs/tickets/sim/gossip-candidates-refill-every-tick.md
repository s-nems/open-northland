# Keep the gossip chat candidates current per change instead of refilling them every tick

**Area:** sim · **Focus:** social/gossip · **Priority:** P3

`GossipCandidates.ensure` (`systems/social/gossip/plan.ts`) refills the shared chat-candidate buckets
whenever another instance filled them last, and the planner pass builds a new instance every tick
(`settlers/planner/pass.ts`). So on any tick where one settler looks for a partner, it walks every
`Person, Position`, reads each `Settler` and refills the `NodeBuckets` over the eligible ones: a
per-tick pass over the population, a rule-6 violation (`AGENTS.md`).

Measured on `krwawa_rzeka`, 12 AI seats (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): one refill a
tick over 1330 people at t100k (1325 at t80k); `ensure` is 1.93 to 1.97% of the sim in both profiles,
up from 0.57% in the `magiczny_las` reference. `NodeBuckets.refill` allocates 68 KB a tick for gossip.

## Scope

- The eligible set and its buckets are kept from change feeds (Person, Position, Settler job and Age
  membership, Position value writes), like the planner's spacing index (`settlers/planner/spacing.ts`),
  instead of refilled per tick; the buckets stay ascending by id.
- Hash-identical.

## Verify

- State hash unchanged over 2000 ticks from the reference's t100k checkpoint; the gossip tests pass.
- Refills per tick (temporary counter) and the `ensure` share in `bench:profile`, against the numbers
  above.
- `npm test`, `npm run check`.
