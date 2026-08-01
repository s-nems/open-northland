# Align AI collector staffing with the chosen XP-gate rule

**Area:** sim · **Priority:** P3
**Needs user:** choose whether AI collectors bypass civilian good-experience gates with the rest of
the AI economy.

`experienceGatesApply` (`packages/sim/src/systems/progression/unlocks.ts`) exempts every AI seat from
the experience tree on civilian targets, so `settlerMeetsNeed(..., 'good', ...)` is constant `true`
for the settlers the workforce allocator governs. That makes `meetsNeed`
(`packages/sim/src/systems/ai-player/workforce/collectors/wanted-goods.ts`) a no-op at both its call
sites: the first post and the veteran repost accept any spare man, iron included.

The surrounding machinery still runs. `needsVeteran` reads the tribe's requirement rows directly, so the
veteran repost still fires for iron when the spare pool is dry, moving an ungated good's collector
onto it — currently harmless but pointless, since the same fresh man `meetsNeed` accepts could have
taken the iron post directly.

Two unit tests pin the gated behaviour against a fixture seat that carries no `AiPlayer` entity
(`packages/sim/test/systems/ai-player-modules.test.ts`, "hires the iron collector only once the
build order reaches its gated entry" and "gates the iron post on accrued XP"), so they pass while
describing behaviour a real seat cannot reach.

## Scope

Apply the chosen rule consistently:

- if the exemption stands, delete `meetsNeed`, `needsVeteran` and the veteran repost, and rewrite the
  two tests against what an AI seat actually does;
- if collectors should still earn iron, narrow `experienceGatesApply` so `needforgood` keeps applying
  to AI seats, and give those two tests a seat that is really an AI player.

## Verify

`npm test`, `npm run check`, `npm run build`.
