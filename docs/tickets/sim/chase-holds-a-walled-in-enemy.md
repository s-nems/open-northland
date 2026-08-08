# Release a chase whose target is walled in by buildings, not by terrain

**Area:** sim · **Priority:** P2

`chase` (`packages/sim/src/systems/conflict/chase.ts`) only deals contact cells in the chaser's own
static walk component, so an enemy across a river no longer benches its watcher. A target sealed off
by the *dynamic* overlay instead - an enemy standing inside a walled compound, a unit ringed by
standing bodies - is still in the chaser's own component, so the chase keeps issuing a route that
keeps failing, and the `Engagement` marker keeps the unit out of the economy for as long as the seal
holds. That marker now also means the unit answers a need only from its own rations, so an indefinite
seal starves it rather than merely benching it - about 400 s of game time from the eat trigger to
death. The same applies to the second-rank hold, where men who never swing hold an `Engagement` for as
long as the front rank stands.

That was left alone deliberately: a crowd-sealed contact cell usually clears within a few ticks, and
releasing there would drop a fighter out of a live battle. A building ring does not clear.

Two costs ride on the same shape. The failing search is not free: `find-path.ts` documents the
profiled case (magiczny_las, 6 AI seats) where a goal sealed inside a 494-node overlay pocket cost
~123k settles per request before the goal-side exhaust was added, and a pocket beyond
`GOAL_EXHAUST_MAX_EXPLORED` still falls back to the full forward flood. And it is paid *every tick*,
not once per cadence: `clearNavState` on the failed route makes `isTravelling` false, so the
`ctx.tick < engagement.repathAt` guard never fires and the retry outruns its own throttle. This is
the throttle half of the original unreachable-target ticket, which the terrain release did not need.

## Scope

- Hold the chase cadence over a failed route, so a sealed target is re-searched at most once per
  `REPATH_CADENCE` instead of every tick. Keep the retry itself - a transient seal must still be
  re-tried - and keep the second-rank hold.
- Decide when an overlay seal is durable enough to release on (a repeat count, the seal's owner being
  built structures rather than bodies, or a cheap re-probe), and release only then.
- Record the choice as an approximation with its reasoning; the original's rule is not readable.

## Verify

- Headless: a besieger whose target is enclosed by finished buildings hands back to the economy; one
  whose contact cell is briefly ringed by allied bodies keeps its `Engagement` and takes the slot when
  the rank shifts.
- A counted probe on issued requests and on settle cost for the sealed case, before and after.
- `npm test`; combat goldens move only if the release changes a scenario that had one.
