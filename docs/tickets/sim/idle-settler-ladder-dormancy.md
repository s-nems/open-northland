# Keep an idle settler off the drive ladder until something it reads changes

**Area:** sim · **Focus:** settlers/planner · **Priority:** P3 · **Complexity:** high

At tick ~48k of the fortress (13 AI seats, 586 settlers) 421 settlers stand idle on a given tick and
every one of them still runs the whole adult drive ladder (`drives/ladder.ts` `planAdult` through
`planEconomy`) each tick, ending at the idle tail. The planner is the largest sim system there
(1.5 ms of a 4.8 ms tick, `npm run bench:map` from the 48k checkpoint) with no single hotspot: the cost
is the search rungs (gatherer, producer input supply, hoard, food) finding nothing, repeated for the
same settler every tick. That is per-tick work scaling with the idle population rather than with
active work, which `packages/sim/AGENTS.md` "Scale" rules out.

Constraints: the existing porter dormancy (`drives/economy/porter-dormancy.ts`) shows the required
shape, a gate keyed on every input the skipped rungs read, so behaviour stays byte-identical and the
settler wakes the tick a relevant input changes; tests pin that immediate reaction
(`test/settlers/porter-dormancy.test.ts`, `test/settlers/gossip.test.ts`). A time-based rest is
excluded: it changes behaviour and was measured at only 8% of the planner.

## Scope

- Measure first, from the checkpoint, which rungs the idle population pays for and which world inputs
  each reads; a per-rung generation key is only worth it where the inputs change rarely at scale.
- Generalize the dormancy gate to the rungs where a provably-unchanged key holds long enough to pay,
  with a coherence verifier per gate like `porterDormancy`.

## Verify

- `bench:map` from the fortress checkpoint: planner median falls with the state hash unchanged;
  `verifyCaches` stays clean in the harness invariants; `npm test`.
