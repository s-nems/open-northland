# Move component stores into the World (kill the singleton-store footgun)

**Area:** sim (+ every store consumer in app/render tests) · **Origin:** pre-release quality audit 2026-07-13 · **Priority:** P3

Component stores are module-level singletons: `defineComponent` (`packages/sim/src/ecs/world.ts:26`)
creates one shared `Map`, and `new World()` resets the id counter but **not** the stores. Every
multi-sim process must run the `clearComponentStores()` ritual (`src/harness/stores.ts`) or the
earlier run's entities leak onto reused ids — the contract calls it "the loop's most-rediscovered
trap" and fences it with a hygiene test, `beforeEach` calls in every suite, and warnings in three
docs. The fences work, but the design means the core data layer corrupts itself by default in any
harness that forgets the ritual; it is the first thing a sharp external reviewer will flag once the
repo is public.

Target: stores owned by the `World` instance, so `new World()` is a complete reset and
`clearComponentStores()`, the harness ritual, and the multi-sim hygiene scan all become deletable.

## Scope

Investigate first — the migration shape depends on how component data is accessed today:

1. Map the access patterns: sites going through `World` methods (`world.add/get/remove`) migrate
   for free; sites touching `SomeComponent.store` directly (grep `\.store` across sim/app/render
   src + tests) need the new lookup. Count them before choosing the design.
2. Likely design: `Component<T>` becomes a pure key (name + type brand, no Map); `World` holds
   `Map<Component<unknown>, Map<Entity, unknown>>` created lazily on first registration. Keep the
   existing `World` method signatures so most call sites don't change. Iteration order of a store
   must stay insertion order of that store (determinism contract) — a per-World Map gives exactly
   that.
3. Delete `harness/stores.ts` (`clearComponentStores`), the `beforeEach` calls, the hand-picked
   store-clear hygiene scan in `test/core/hygiene.test.ts`, and the multi-sim warnings in
   `packages/sim/AGENTS.md` + root `AGENTS.md` durable gotchas + `docs/ECS.md` — update, don't
   leave stale prose.
4. If the direct-`.store` site count makes one session unrealistic, split: first a mechanical pass
   routing all direct store access through `World`, then the ownership flip as a follow-up ticket.

## Verify

`npm test` with **unmoved goldens** — this is a pure refactor; a moved golden state-hash or atomic
trace means behavior changed, stop and reassess. `npm run check`, `npm run build`. The fuzz
determinism suite (`test/core/fuzz-determinism.test.ts`) is the strongest tripwire for accidental
iteration-order changes.

## Source basis

Pure architecture refactor; no mechanic or extracted-data change.
