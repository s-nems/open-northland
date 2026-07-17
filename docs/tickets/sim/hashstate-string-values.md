# Hash string values in `Simulation.hashState()`

**Area:** sim · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P1

`hashState()`'s `hashValue` (`packages/sim/src/simulation.ts:314-337`) branches on number,
boolean, null/undefined, array, `Map`, and object — a **string value matches no branch and mixes
nothing** into the FNV-1a hash (object *keys* are mixed char-by-char; string *values* are silently
skipped). Hashed component state carries strings today:

- `CurrentAtomic.effect.kind` — the discriminant of every `AtomicEffect`
  (`src/core/atomic-effect.ts`, stored on the hashed `CurrentAtomic`,
  `components/settler.ts`). The payload-free variants (`sleep`, `pray`, `enjoy`, `make_love`,
  `drop`, `idle`) are pairwise hash-identical — verified empirically: `{kind:'sleep'}` and
  `{kind:'pray'}` both hash to `d913e243` under a faithful replica of `hashValue`.
- `ChildOrder.child: 'female' | 'male'` (`components/family.ts:50`) — both values hash `e5a0205d`.

Consequence: two runs diverging **only** in a string field produce byte-identical `hashState()` at
that tick. The golden state-hash tests, `test/core/fuzz-determinism.test.ts`'s run-twice equality,
the `inspect/hashtrace.ts` ring, and `replay/localize-divergence.ts` (keys on `hashState()`) all
pass straight through such a divergence — it surfaces only later when a downstream numeric field
differs, exactly the "distant unexplained divergence" the tripwire exists to prevent, and a hole in
any future lockstep sync check. (`inspect/snapshot.ts` does clone strings, so `snapshot-diff` sees
it; nothing hash-based does.)

## Scope

- Add a string branch to `hashValue`, e.g. mix `v.length` then `charCodeAt` per char (mirroring the
  existing object-key mixing).
- This intentionally moves every golden hash whose state contains a `CurrentAtomic` — update the
  goldens in the same commit and name this mechanic (per the sim golden discipline).
- Add a regression test: two worlds differing only in a string-typed component field must produce
  different `hashState()` (e.g. two one-settler sims with `sleep` vs `pray` atomics, and/or a
  direct `hashValue`-level unit if one can be extracted cleanly).

## Verify

`npm test` (goldens moved intentionally — name it in the commit), `npm run check`,
`npm run build`.
