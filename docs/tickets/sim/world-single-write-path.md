# Replace World's manual touch discipline with one write seam

**Area:** sim (ecs) · **Priority:** P3

`ecs/world.ts` tracks changes through five parallel channels (`componentGenerations`,
`componentValueGenerations`, `membershipJournals`, the `touched`/`mutations` clone-cache log,
`canonicalCache`), and keeping them coherent is a manual call contract: writers must remember
`touch()` vs `touchComponent()` vs both, documented in `world.ts` and repeated verbatim three
times inside `systems/settlers/effects-goods/harvest.ts`. `registerCacheVerifier`/`verifyCaches`
exists specifically to catch missed calls, a verifier standing in for a seam. A forgotten touch
is a silent determinism/staleness bug the type system cannot catch.

## Scope

One bounded outcome: a single public write entry point, for example
`world.write(entity, Component, mutator)`, that performs the in-place mutation and feeds every
channel itself; migrate the callers that currently pair a mutation with manual
`touch`/`touchComponent` calls and make those two methods non-public. The five internal channels
stay as implementation details behind the seam; collapsing them further is explicitly out of
scope. Pure refactor, no behavior change; the cache verifier stays but should no longer be
load-bearing for new writes.

## Verify

`npm test`, `npm run check`, `npm run build`. Golden state hashes must be byte-identical; that is
the primary proof the refactor changed no behavior. Headless scenario suite green.
