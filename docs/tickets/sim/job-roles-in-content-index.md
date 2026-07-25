# Derive job roles in content-index instead of hardcoded id ranges

**Area:** sim · **Priority:** P2

Job taxonomy lives as magic numeric ids: `systems/readviews/stances.ts` exports `SCOUT_JOB = 27`
and tests fighters via the ranges `SOLDIER_JOB_MIN..SOLDIER_JOB_MAX` (31..41) and
`HERO_JOB_MIN..HERO_JOB_MAX` (42..47) in `isFighterJob`, and `readviews/tribes/relations.ts` adds
`HUNTER_JOB`. Roughly 20 production files consume these (vision, movement collision, gossip,
signposts, employment, family eligibility, needs, experience, conflict engagement/combat, hit
reactions, several `ai-player/` sites). This violates the repository rule that systems must not
grow id-specific rules, and it bypasses the existing seam: `core/content-index/` already derives
capability sets such as `harvestJobs` and `commandJobs` from content.

Consequence: any content set whose job ids do not match the viking fallback numbering silently
misclassifies fighters, scouts, and hunters across combat, vision, and AI.

## Scope

- Derive job roles (`fighter`, `scout`, `hunter`) in `core/content-index/` from job content data
  (weapon slots, granted atomics, worker class) or an explicit content role field with a fallback
  catalog default, mirroring how other capability sets are built.
- Replace every consumer of the numeric constants with the role lookup; delete the constants.
- Non-goal: changing which jobs count as which role. The derived sets must equal the current
  ranges for the committed fallback catalog, proven by a test.

## Verify

A unit test asserting the derived role sets over the fallback catalog equal the current numeric
ranges. `npm test`, `npm run check`, `npm run build`. Golden state hashes must not move.
