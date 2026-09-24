# Drop the dead XP gate from AI collector staffing

**Area:** sim · **Priority:** P3

AI seats skip the experience tree for gathering and crafting alike: a bot's smith forges long swords
and its collector digs iron from the first day.

`experienceGatesApply` (`packages/sim/src/systems/progression/unlocks.ts`) exempts every AI seat from
the experience tree on civilian targets, so `settlerMeetsNeed(..., 'good', ...)` is constant `true`
for the settlers the workforce allocator governs. The discovery gates carry the same exemption
(`tribeUnlockEnabled` in `availability.ts` and the house loop of `discoveries.ts`), which the original's
behavior corroborates for its AI seats. That makes `meetsNeed`
(`packages/sim/src/systems/ai-player/workforce/collectors/wanted-goods.ts`) a no-op at both its call
sites: the first post and the veteran repost accept any spare man, iron included.

The surrounding machinery still runs. `needsVeteran` reads the tribe's requirement rows directly, so the
veteran repost still fires for iron when the spare pool is dry, moving an ungated good's collector
onto it - currently harmless but pointless, since the same fresh man `meetsNeed` accepts could have
taken the iron post directly.

Two unit tests pin the gated behaviour against a fixture seat that carries no `AiPlayer` entity
(`packages/sim/test/systems/ai-player-modules.test.ts`, "hires the iron collector only once the
build order reaches its gated entry" and "gates the iron post on accrued XP"), so they pass while
describing behaviour a real seat cannot reach.

## Scope

Delete `meetsNeed`, `needsVeteran` and the veteran repost, and rewrite the two tests against what an
AI seat actually does.

## Verify

`npm test`, `npm run check`, `npm run build`.
