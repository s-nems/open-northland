# Drop the dead XP gate from AI collector staffing

**Area:** sim · **Priority:** P3

AI seats skip the experience tree for gathering and crafting alike: a bot's smith forges long swords
and its collector digs iron from the first day.

`experienceGatesApply` (`packages/sim/src/systems/progression/unlocks.ts`) exempts every AI seat
from the experience tree on civilian targets, so `settlerMeetsNeed(..., 'good', ...)` is constant
`true` for the settlers the workforce allocator governs. The discovery gates carry the same
exemption (`tribeUnlockEnabled` in `availability.ts` and the house loop of `discoveries.ts`), which
the original's behavior corroborates for its AI seats. That makes two gates no-ops:

- `meetsNeed` in `ai-player/workforce/collectors/wanted-goods.ts` at both its call sites: the first
  post and the veteran repost accept any spare man, iron included.
- the `settlerMeetsNeed` term of `gathererReach(...).takes` in `ai-player/live-resources.ts`, which
  never turns a resource down.

The surrounding machinery still runs. `needsVeteran` reads the tribe's requirement rows directly, so
the veteran repost still fires for iron when the spare pool is dry, moving an ungated good's
collector onto it - currently harmless but pointless, since the same fresh man `meetsNeed` accepts
could have taken the iron post directly.

Three cases in `packages/sim/test/systems/ai-player/workforce-allocation.cases.ts` pin the gated
behaviour against a fixture seat that carries no `AiPlayer` entity, so they pass while describing
behaviour a real seat cannot reach: "hires the iron collector only once the build order reaches its
gated entry", "gates the iron post on accrued XP" and "moves a generic flag whose circle holds only
a good the holder lacks the experience for".

## Scope

Delete `meetsNeed`, `needsVeteran`, the veteran repost and the reach's need term, and rewrite the
three cases against what an AI seat actually does.

## Verify

`npm test`, `npm run check`, `npm run build`.
