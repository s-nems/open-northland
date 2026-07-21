# Derive the home-level invariant ceiling from content

**Area:** sim · **Priority:** P3

## Context

`buildingSane` (`packages/sim/src/harness/invariants.ts`) bounds a building's level with a constant:

```ts
const MAX_HOME_LEVEL = 4;
…
if (b.level < 0 || b.level > MAX_HOME_LEVEL) out.push(`entity ${e}: level out of range (${b.level})`);
```

But content owns that bound. `Building.level` is incremented by `constructionSystem` and limited **only**
by `upgradeTierOf(type, ctx)` returning `undefined` — i.e. by the length of the `home_level_NN` tier chain
in the data. The `4` mirrors a comment on the `Building` component (`home level 00..04`), not any
code-enforced cap.

So content that adds a sixth home tier makes a **correct** sim fail `CORE_INVARIANTS`: the tripwire fires
on the content, not on a bug — golden rule 3 inverted (a system hardcoding a content fact). Since
`checkInvariantsEachTick` is the harness's actionable signal, a false positive there is expensive.

The refactor pass named the constant and pointed it at the tier chain, which is as far as it could go
without a behavior change: `Invariant` is `(world: World) => string[]` and has no `SystemContext`, so
there is no way to reach `upgradeTierOf`'s content today.

## Scope

- Widen `Invariant` to receive the content/`SystemContext` (e.g. `(world, ctx) => string[]`), or give the
  harness a content-aware invariant kind beside the world-only one.
- Derive the ceiling by walking the `home` tier chain (`upgradeTierOf`) instead of hardcoding it.
- Update `checkInvariants` / `CORE_INVARIANTS` / `Scenario.run`'s `checkInvariantsEachTick` and the fuzz
  harness accordingly.

## Verify

- A content set with an extra `home_level_05` tier passes `CORE_INVARIANTS` with a legitimately level-5 home.
- `npm test` green, zero golden movement (invariants are reporting-only — they never feed `hashState`).
