# Let a staged AI band answer fire it cannot reach

**Area:** sim · **Priority:** P2

The AI's army forms up short of its objective on the DEFEND stance, which is what keeps the band
together: an idle ATTACK fighter auto-acquires anything hostile in sight, so a group waiting inside the
enemy's town would each walk off at a different house
(`packages/sim/src/systems/ai-player/military/muster.ts`, `gatherAt`).

DEFEND's radius is the guard-post default: `DEFEND_RADIUS_NODES = 8` with `DEFEND_LEASH_NODES = 12`
(`packages/sim/src/systems/conflict/engagement.ts`). The base data's `long_bow` carries `maximumrange
23`, and an ATTACK enemy acquires at `max(maxRange, SIGHT_RADIUS_NODES)`. So an enemy archer standing
13-23 nodes off the band's anchor shoots a staged band that never turns, never advances, and may not
legally step past the leash. Confirmed by probe: a held band ignores an intruder outside its radius.

The exposure is bounded - the band rolls to charge every decision, so a full band leaves quickly - but a
band sitting at the wave minimum can wait a minute of game time.

## Scope

Pick one and name it as the rule:

- give a FIELD rally its own hold radius (the hold ring plus the longest hostile reach) rather than
  reusing the guard-post default, keeping the guard post's own radius unchanged; or
- drop a held band to ATTACK the moment one of its men takes damage, so it answers fire but still
  gathers quietly while nothing is shooting.

Do not simply hold the band on ATTACK: that is the dissolution this stance exists to prevent, and it has
its own regression test (`ai-player-military.test.ts`, the formed-up hold cases).

## Verify

- Headless: a band held at a staging point with a hostile archer inside its weapon reach but outside
  `DEFEND_RADIUS_NODES` stops being a free target - it either engages or closes.
- The existing muster cases still pass: the band does not scatter house by house while nothing shoots
  at it, and `takeCensus` still fills.
