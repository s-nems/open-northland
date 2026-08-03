# Release a chase whose target is walled in by buildings, not by terrain

**Area:** sim · **Priority:** P3

`chase` (`packages/sim/src/systems/conflict/chase.ts`) refuses a contact cell in another static walk
component, so an enemy across a river no longer benches its watcher. A target sealed off by the
*dynamic* overlay instead - an enemy standing inside a walled compound, a unit ringed by standing
bodies - is still in the chaser's own component, so the chase keeps issuing a route that keeps
failing, and the `Engagement` marker keeps the unit out of the economy for as long as the seal holds.

That was left alone deliberately: a crowd-sealed contact cell usually clears within a few ticks, and
releasing there would drop a fighter out of a live battle. A building ring does not clear.

The failing search is not free in this shape. `find-path.ts` documents the profiled case (magiczny_las,
6 AI seats): a goal sealed inside a 494-node overlay pocket cost ~123k settles per request before the
goal-side exhaust was added, and a pocket wider than `POCKET_PROBE_MAX_EXPLORED` still falls back to
the full forward flood.

## Scope

- Decide when an overlay seal is durable enough to release on (a repeat count, the seal's owner being
  built structures rather than bodies, or a cheap re-probe), and release only then.
- Keep the second-rank hold and the per-tick retry for a genuinely transient seal.
- Record the choice as an approximation with its reasoning; the original's rule is not readable.

## Verify

- Headless: a besieger whose target is enclosed by finished buildings hands back to the economy; one
  whose contact cell is briefly ringed by allied bodies keeps its `Engagement` and takes the slot when
  the rank shifts.
- A counted probe on the settle cost of the sealed case before and after.
- `npm test`; combat goldens move only if the release changes a scenario that had one.
