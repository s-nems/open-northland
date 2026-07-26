# `jobtypes.ini` `baseatomics` is a base-JOB id, not an atomic list

**Area:** pipeline · **Priority:** P2

`tools/asset-pipeline/src/decoders/ini/types/jobs.ts` extracts `baseatomics` as a list of atomic ids
(`JobType.baseAtomics`), and `core/content-index/atomics.ts` `jobAtomicSets` unions it into each job's
allowed-atomic permission set. The values do not read as atomics. In
`Data/logic/jobtypes.ini` every trade 7..31 carries `baseatomics 6` = the `civilist` job, soldiers
32..41 and `hero_unarmed` (42) carry `31` = `soldier_unarmed`, each armed hero carries its soldier
class (43→33 `soldier_spear_iron`, 44→34, 45→35, 46→39, 47→41), and `adult_animal` (49) carries `48` =
`baby_animal` — so 6→31→42..47 is one inheritance chain. Every value is a valid `[jobtype]` `type`;
read as atomic ids they are nonsense (a spear soldier does not base-inherit the hunter's atomic 33).
The one pair the reading does not explain is `baby_male` (2) and `child_female` (3), which both carry
`1` = `baby_female`: 2's parent would be its opposite-sex sibling. Settle that pair before relying on
the chain for the life-stage jobs; it does not affect 6→31→42..47.

So the field is a parent-job pointer: a job inherits the base job's atomics. Two knock-on effects
already visible in the tree:

- `jobAtomicSets` grants soldiers 32..41 atomic 31 (herb harvest) and heroes atomics 33/34/35/39/41,
  and grants them none of `soldier_unarmed`'s real atomics (81 attack, 90).
- `harvestCapableJobs` had to exclude `baseAtomics` outright to stop the soldier band being classified
  as herb gatherers (`core/content-index/atomics.ts`) — a workaround for this misreading.

Related unextracted signal, for whoever picks this up: `jobtypes.ini` also carries per-job
`ignoresHomeHouseFlag`, `canBeTrainedFlag`, `canHaveWorkHouseFlag`, `mustHaveWorkHouseFlag`,
`mustHaveFinishedWorkHouseFlag`, `userCanChangeProductionFlag`,
`UserShouldAttachWorkPlaceAfterJobChangeFlag` and `needsReligionFlag`, none of which the extractor keeps.
`ignoresHomeHouseFlag 1` covers {25 trader, 27 scout, 31..47} — the closest readable signal to the job
roles `core/content-index/jobs.ts` currently approximates from the id slug.

## Scope

- Confirm the reading against `Data/logic/jobtypes.ini` in the owned copy (all 45 `baseatomics` lines),
  then rename the extracted field to the base-job reference it is and cross-check it against the job
  table at load like the other job cross-references.
- Resolve the inherited atomics in `core/content-index/atomics.ts` by walking the base chain, and drop
  the `harvestCapableJobs` workaround if the chain walk makes it unnecessary.
- Decide and record whether the chain changes any current behaviour (the planner's atomic permission
  gate is the main consumer); goldens move only for a named intentional change.

## Verify

`npm run test:pipeline` against the owned copy, plus a unit test pinning the resolved atomic set of a
soldier, a hero, and a civilian trade over the real IR. `npm test`, `npm run check`, `npm run build`.
