# Re-plan an idle settler on a staggered cadence

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

The planner is the largest sim system on `magiczny_las_12_players` with 13 AI seats (the session in
`docs/DEVELOPMENT.md`, Measuring performance): the trust-clean `npm run bench:profile` from the 40k
checkpoint puts it at 46% of the tick (median 7.95 of 18.7 ms, 922 settlers, 210 buildings; profiled
timings are inflated by the sampler), and `planAdult` at 29%. The busy-machine profile from 60k shows
52% (1,055 settlers, 238 buildings), and a busy-machine 60k-tick `bench:map` run suggests the planner
grows about 5x while settlers grow 1.4x (growth suspect).

Most of that growth is idle settlers repeating failed searches. An exact call count over 200 ticks
from each checkpoint shows the ladder (`drives/ladder.ts` `planAdult`) running for 70 adults per tick
at 10k and 159 at 60k, and the idle tail of `planEconomy` (`pass.standing.add`) reached 23 times per
tick at 10k and 67 at 60k. `planGatherer` is called 73 times per tick at 60k and starts 0.3 harvests;
the rest search and fail, every tick, for the same settlers. Of the settlers standing with no atomic
or route after a tick at 60k, most are women (49), soldiers not holding a DEFEND post (about 35),
builders (11), and flag collectors at an exhausted flag (7). An idle flag collector stands beside its
flag with no atomic (`planFlagGatherer`), so it rescans its whole flag area next tick: 5.5 scans per
tick at 60k, `planFlagGatherer` 3.9% of the tick at 40k.

`releaseStaleIntent` holds a busy settler off the ladder (850 of 1008 per tick at 60k), but nothing
holds an idle one: with no atomic and no route it runs `planAdult` again. Only the porter rung has
dormancy (`drives/economy/porter-dormancy.ts`). Per-tick work therefore scales with the idle
population times the search size, which `packages/sim/AGENTS.md` "Scale" rules out.

Expected gain: about 2 ms of the 18.7 ms tick at 40k, inferred rather than measured: the idle-tail and
flag stand-by runs are 74 of the 159 ladder runs per tick at 60k and the ones that walk every rung,
against `planAdult`'s 5.5 ms at 40k. That excludes the flag scan, whose per-candidate work cells the
scan's anchor prefilter already cut.

## Scope

- A settler whose ladder ended in the idle tail, or in `planFlagGatherer`'s stand-by-the-flag branch,
  re-runs `planAdult` only on ticks where `(tick + entity) % IDLE_REPLAN_PERIOD_TICKS === 0`, staggered
  by entity id as `ASSISTANT_SCAN_PERIOD_TICKS` is in `planner/recruit-arming.ts`. Between those ticks
  it stays idle. It removes up to (N-1)/N of the idle ladder cost whichever rung fails.
- Start with N = 12 (1 s at 12 ticks/s) and measure; any N up to 36 (3 s) is acceptable. Name the
  chosen value as a constant with its unit.
- A command addressed to the settler still acts on the tick it applies; the cadence gates only the
  settler's own search.
- Behaviour change: an idle settler reacts up to N/12 s later to new work (a new site, a dropped good, a
  freed seat, a grown tree). State hashes change; regenerate the goldens in the same commit and name the
  behaviour change in it.
- Immediate-reaction assertions in `test/settlers/porter-dormancy.test.ts` and
  `test/settlers/gossip.test.ts` may need to step the settler to its next due tick; keep what they
  assert, do not drop it.
- Later refinement, only if the cadence leaves the planner above budget: a per-input dormancy gate like
  `porterDormancy`, keyed to the settler's reach, with a `verifyCaches` verifier.

## Verify

- Headless: an idle settler re-plans on its due ticks only, and takes up a new site within N ticks.
- Counter: `planAdult` runs per tick over 200 ticks from the 60k checkpoint fall from 159 toward the
  busy settlers plus the idle ones divided by N, and the idle-tail reaches from 67 likewise.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner median falls by about 2 ms. The
  state hash changes knowingly and the goldens move in the same commit.
- `verifyCaches` stays clean in the harness invariants; `npm test`.
