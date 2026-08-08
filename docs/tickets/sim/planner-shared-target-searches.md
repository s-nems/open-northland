# Share repeated nearest-target searches within one planner tick

**Area:** sim · **Focus:** settlers/planner, settlers/targets, family · **Priority:** P2

The planner sweeps every settler through the drive ladder each tick, and each settler re-runs its own
nearest-target search from scratch. Dozens of settlers ask the same question in the same tick - same
good, same neighborhood, same owner filters - and each pays a full ring walk over the cell index.

Evidence (rev 38de1846, magiczny_las with 6 AI seats): the planner is the largest system in both a
50k-tick `bench:map` run (47.3% share, median 1.8 -> 6.8 ms/tick, 3.7x growth as settlers grew
617 -> 968) and a live speed-3 profile at tick ~28k (45.2% share). A 45 s V8 profile names the terms:
`ringNearest` under `fetchNeededMaterial` (builder site supply) alone is 2.2% of all sampled CPU;
`nearestMissingInputSource` (workshop supply), `nearestTemple`, and `planWomanHoard`'s store search
add comparable terms. The family system's child food haul (`haulFood` -> `nearest`,
`lowestStockedFood`) is another ~2.3% and grew 19.9x in the bench, the fastest curve in the report.
This supersedes the axis-separation question the deleted `ai-planner-scale-curve` ticket asked: the
profile now names the planner-owned terms directly.

## Scope

- Memoize target searches within one tick across askers (planner pass and family drives), keyed by
  the question: target kind/good, origin bucket or region, owner/tribe filters.
- The memo must be invalidation-aware: an intra-tick claim, reservation, or stock change that can flip
  an answer must not serve a stale winner. Cache candidate bands and revalidate accepts, or key on the
  store's mutation version - do not cache a single winner across mutations.
- Decisions stay identical: goldens byte-identical. If sharing would change a winner somewhere, name
  the site and stop rather than silently reordering.
- The combat-side duplicated searches are a different term and already shared per garrison
  (`conflict/engagement.ts`); this ticket is the planner's own.

## Verify

- `npm run bench:map` before/after on the same box: planner share and growth curve drop; no other
  system's share regresses to compensate.
- Goldens and atomic traces byte-identical; `npm test`, `npm run check`, `npm run build`.
