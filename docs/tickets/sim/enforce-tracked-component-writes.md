# Make cache-observable component writes explicit

**Area:** sim · **Focus:** ecs · **Priority:** P3

`World.write` advances the touched log and a component value generation used by snapshot and derived-cache
invalidation, but `World.get` and `World.tryGet` return the same mutable objects held by the stores. Direct
field assignments in rules, family, assistant, and AI command paths already bypass those generations. A
normal system step advances the tick and masks the snapshot-memo case, but the API cannot enforce the
invalidation contract for pre-tick setup, same-tick probes, new caches, or restored state.

## Scope

- Separate read access from tracked mutation so ordinary reads are typed `Readonly` and cache-observable
  writes pass through one explicit mutation seam.
- Migrate component writers without cloning component values or adding per-access allocations. Keep
  membership mutations on `add`/`remove`/`destroy` and value generations independent.
- Preserve a narrowly named internal escape hatch only for values proven private to one system and unseen
  by snapshots, hashes, persistence, or derived caches. Document that ownership at the escape hatch.
- Add a development/test guard that detects an untracked observable mutation. Do not ship a proxy or deep
  freeze in the production tick path without a benchmark proving its cost acceptable.

## Verify

- A same-tick snapshot followed by a tracked component mutation cannot return the stale memo.
- Cache verifier fixtures fail on an intentional untracked observable write and remain clean through a
  representative full schedule.
- Existing state hashes and goldens remain unchanged. Before/after `npm run bench:sim` samples use the
  same axes and stay within the benchmark's recorded noise/trust envelope.
- `npm test`, `npm run check`, and `npm run build`.
