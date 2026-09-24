# Bound the hunter scans that grow with the hunter count

**Area:** sim · **Focus:** conflict/hunting · **Priority:** P3

Four hunter scans grow with the number of hunters or the density of their grounds rather than with
work done. On `magiczny_las_12_players` with 13 AI seats the map holds 4-10 hunters, and in the
trust-clean `npm run bench:profile` from the 40k checkpoint none of these terms passes 0.16% of the
tick (`huntingGroundHoldsCarcass`; `preyHeldByOthers` is below the sampler's resolution). They matter
only for hunter-heavy lobbies. Every box below is sized off `HUNTER_WORK_FLAG_RADIUS` (48 nodes).

- **The prey-claim set.** `preyHeldByOthers` (`conflict/hunting/spec.ts`) builds a `Set` over every
  holding hunter, per hunting hunter per acquisition tick: O(hunters²) map reads and one allocation
  per hunter per tick. Measured in a synthetic setup when the claim set landed at about 0.008 ms per
  tick for 10 holders and 1.9 ms per tick for 120.
- **The carcass probe.** An actively chasing hunter re-probes `huntingGroundHoldsCarcass`
  (`conflict/hunting/kill-claim.ts`) each tick, and a carcass-less probe tests every indexed resource
  in the radius-plus-slack box, so a resource-dense ground pays the full box per chase tick. A hit that
  survives the cheap rejects and is a carcass also resolves its killer's stance, failed-route memo and
  ground (`claimedByAnotherHunter`, about 1.5 µs per call, bounded by carcasses in the ground).
- **The carcass-reach sort.** An idle hunter's bounded harvest scan collects the carcass-reach box
  through `near` (`systems/spatial/region.ts`), which sorts it, once per planner tick, and an idle
  hunter re-plans every tick.
  [gatherer-rung-scans-foreign-candidates.md](gatherer-rung-scans-foreign-candidates.md) narrows which
  resources that scan resolves and
  [idle-settler-ladder-dormancy.md](idle-settler-ladder-dormancy.md) thins the repeat to its cadence; the
  collect-and-sort itself stays here.
- **The last-resort preempt.** A hunter holding last-resort livestock pays the preempt walk every chase
  tick, un-amortized (`HuntRest` does not rest an `Engagement`), out to `2 x radius + slack` from the
  anchor at the leash edge.

## Scope

- Stage a hunter-heavy bench first (about 120 hunters on wildlife-rich, resource-dense grounds, in
  `bench:sim` or a real-map knob) and bound only the terms it shows above noise.
- Prey-claim set: an O(H) per-world memo keyed on `World.componentGeneration(HuntFocus)` that keeps
  the intra-tick visibility the rule depends on (a hold stamped earlier the same tick is seen).
- Carcass probe: visit only resources the hunter's atomics allow. Carcass-reach sort: merge the
  ascending region lists instead of sorting per call, keeping the ascending-id order the first-wins
  tie-break depends on.
- Those three are pure cost work: the state hash stays identical.
- Last-resort preempt: bound the walk to the hunting-ground radius around the anchor, so the winner
  becomes the livestock nearest the anchor instead of nearest the hunter, keeping today's tie-break.
  This changes which animal a hunter takes, so state hashes change: land it as its own commit,
  regenerate the goldens in it and name the behaviour change.

## Verify

- Unit: the prey-claim memo matches a fresh set after holds are stamped and dropped within one tick.
- Unit: a hunter holding last-resort livestock picks the one nearest its anchor, and none beyond the
  ground radius.
- `npm run bench:compare` before and after on the hunter-heavy bench, on an idle box, trust clean: the
  staged terms fall; only the preempt commit moves goldens.
- `npm test`, `npm run check`.
