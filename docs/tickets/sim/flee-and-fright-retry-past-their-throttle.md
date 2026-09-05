# Hold the flee and fright throttles on a failed route

**Area:** sim · **Priority:** P3

`fleeDrive` (`packages/sim/src/systems/conflict/flee.ts`) and `animalFrightSystem`
(`packages/sim/src/systems/conflict/fright.ts`) both read the failed-route flag as
`if (failed) clearNavState(...) else if (travelling && tick < repathAt) return;`, so a failed route
skips the cadence check and the drive re-aims the same tick, every tick.

`fleeDestination` picks an away-cell by walkability and bounds, never by routability, and it is a pure
function of (here, threat), so a fleer cornered against water or a map edge re-picks the same
unreachable cell and re-issues the same request until the threat moves. Same shape in the fright
drive against its scare node.

This is the pattern the chase drive just answered (`chase.ts` refuses a contact cell in another static
walk component before asking for a route); the same connectivity read is available to both callers. The
cadence hold over a refused route is in place there too: `chase.ts` stands the refused route out until
`repathAt` instead of re-aiming on the failure tick, the shape to copy.

## Scope

- Keep the cadence throttle over a failed route in both drives.
- Prefer an away-cell in the runner's own walk component, so the drive stops choosing a destination it
  can never reach; keep the boxed-in "stand and hope" fallback.
- One change per drive; do not fold the two drives together.

## Verify

- Headless: a FLEE civilian cornered against water re-aims at most once per `FLEE_REPATH_CADENCE`, and
  a frightened animal likewise per `FRIGHT_REPATH_CADENCE`.
- A counted probe on issued path requests, as in `melee-engagement/autonomous.cases.ts`.
- `npm test`.
