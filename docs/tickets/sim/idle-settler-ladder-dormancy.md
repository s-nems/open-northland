# Keep an idle settler off the drive ladder until something it reads changes

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
against `planAdult`'s 5.5 ms at 40k. That excludes the flag scan (0.7 ms at 40k), whose saving this
ticket shares with
[gatherer-rung-scans-foreign-candidates.md](gatherer-rung-scans-foreign-candidates.md).

## Scope

- A settler whose ladder ended in the idle tail, or in `planFlagGatherer`'s stand-by-the-flag branch,
  skips the ladder until an input of a rung above that point changes. Behaviour stays byte-identical:
  the gate compares every input the skipped rungs read, like `porterDormancy`, with a coherence
  verifier registered for `verifyCaches`.
- Measure first which of those inputs move per tick at 60k. A world-wide generation that moves every
  tick buys nothing at this scale, so the keys must be scoped to the settler's reach, for example a
  per-region version of the resource and ground-drop indexes plus the settler's own position, job,
  load, flag, and experience.
- Start with the rungs that dominate the idle cost: the flag stand-by and the gatherer and pile scans.
  The gatherer ticket makes each failed scan cheaper; this ticket stops repeating it. Either helps
  alone.

**Gameplay limit option, needs the user's decision:** re-plan an idle settler every N ticks, staggered
by entity id as the assistant's `ASSISTANT_SCAN_PERIOD_TICKS` is, instead of every tick. It removes up
to (N-1)/N of the idle ladder cost whichever rung fails, with no per-input keys. Visible effect: an
idle settler reacts up to N/12 s later to new work (a new site, a dropped good, a freed seat, a grown
tree); N = 12 is up to one second. It changes behaviour and state hashes, so it is not the default.

## Verify

- Counter: `planAdult` runs per tick over 200 ticks from the 60k checkpoint fall from 159 toward the
  settlers that have something new to read, and the idle-tail reaches from 67.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner median falls by about 2 ms. The
  state hash stays identical for the dormancy gate; the cadence option moves it knowingly and
  regenerates goldens in the same commit.
- `verifyCaches` stays clean in the harness invariants; `test/settlers/porter-dormancy.test.ts` and
  `test/settlers/gossip.test.ts` keep their immediate-reaction assertions; `npm test`.
