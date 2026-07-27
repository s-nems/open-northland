# Retire the AI collector's XP gating, or narrow the AI seat's tree exemption

**Area:** sim · **Priority:** P3

`experienceGatesApply` (`packages/sim/src/systems/progression/unlocks.ts`) exempts every AI seat from
the experience tree on civilian targets, so `settlerMeetsNeed(..., 'good', ...)` is constant `true`
for the settlers the workforce allocator governs. That makes three things in
`packages/sim/src/systems/ai-player/workforce/collectors.ts` unreachable: `meetsNeed`, `needGated`,
and the veteran-repost fallback in `allocateCollectors` (the branch that re-posts another good's
collector when no fresh spare clears an XP-gated good).

The repost also carries a live churn bug behind that dead gate: it has no check that the good being
filled is XP-gated, so with a dry pool and two or more ungated wanted goods held by a single
collector, the same veteran is re-posted through mud → stone → wood within one decision (conflicting
`setJob`/`setWorkFlag`/`setGatherGood` triples, last wins) and the bounce repeats every decision.

Two unit tests pin the gated behaviour against a fixture seat that carries no `AiPlayer` entity
(`packages/sim/test/systems/ai-player-modules.test.ts`, "hires the iron collector only once the
build order reaches its gated entry" and "gates the iron post on accrued XP"), so they pass while
describing behaviour a real seat cannot reach.

## Scope

Decide which side is right and make the code say it:

- if the exemption stands, delete `meetsNeed`, `needGated` and the veteran repost, and rewrite the
  two tests against what an AI seat actually does;
- if collectors should still earn iron, narrow `experienceGatesApply` so `needforgood` keeps
  applying to AI seats, and add the missing "only an XP-gated good may take a veteran" guard plus a
  churn regression test (two ungated goods, one collector, empty pool, two consecutive decisions
  must not re-post the same man).

## Verify

`npm test`, `npm run check`, `npm run build`.
