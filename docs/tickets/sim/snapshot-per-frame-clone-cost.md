# Make per-frame snapshot cost follow touched entities, not the dynamic population

**Area:** sim · **Focus:** inspect/snapshot · **Priority:** P2
**Blocked by:** [tracked component writes](enforce-tracked-component-writes.md)

`takeSnapshot` runs once per rendered frame that advanced the sim and walks every alive entity. The
clone cache covers only scenery (`Resource`, `Stump`, `BerryBush`), so every other entity - settlers,
buildings, animals, fields, projectiles - is deep-cloned every frame, and each clone probes all ~89
registered component stores through `World.forEachComponent`.

Evidence (rev 38de1846, `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile`,
speed 3, tick ~28k, ~36.7k entities): snapshot takes 7.6 ms of a 28 ms frame; a 45 s V8 profile
attributes 26.7% of all sampled CPU to `takeSnapshot`, the single largest consumer, ahead of the whole
sim step at 33.6%. `forEachComponent` self time is 14.6%, entirely under `takeSnapshot`. GC-inclusive
heap sampling attributes ~50 MB/s of allocation to snapshot cloning. Shares reproduced between the
live profile and a 50k-tick `bench:map` run; the box was loaded, so absolute milliseconds are
indicative only.

## Scope

- Reuse the cached clone for every entity the World's touched log did not name that tick. The log
  already drives scenery eviction and has a registered cache verifier; scenery stays a special case
  only if it still earns one.
- The blocker is real, not formal: direct field assignments in family, assistant, and AI command
  paths bypass the touched log today, so a general cache built before that seam is enforced serves
  stale clones. A partial cache over component sets with proven tracked-write coverage may land
  earlier if each covered set names its proof.
- Cut the per-clone component walk: per-entity component membership (or an equivalent) instead of
  probing every registered store.
- Keep the snapshot contract: detached plain data, canonical ascending-id order, structured-cloneable.
  Correct the API comments and clone test that describe a plain snapshot as zero-copy transferable;
  it is structured-cloneable, nothing more.
- Non-goals: a worker/postMessage transport, changing the snapshot shape consumers read.

## Verify

- Live probe `window.__opennorthland.perf()` on the same session: `snapMs` share of the frame drops
  materially and `entities` is unchanged.
- Invariant-checked runs keep the snapshot cache verifier green.
- Goldens and state hashes are byte-identical (a snapshot is a read seam).
- `npm run bench:map`, `npm test`, `npm run check`, `npm run build`.
