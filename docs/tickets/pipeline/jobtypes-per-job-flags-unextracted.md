# Extract the per-job flags from jobtypes.ini

**Area:** pipeline · **Priority:** P3

`tools/asset-pipeline/src/decoders/ini/types/jobs.ts` keeps only the atomic vocabulary and the base
job. `Data/logic/jobtypes.ini` also carries a per-job flag block that nothing reads (line counts over
the 55 `[jobtype]` sections): `canBeTrainedFlag` 55, `canHaveWorkHouseFlag` 41,
`mustHaveFinishedWorkHouseFlag` 39, `userCanChangeProductionFlag` 37, `mustHaveWorkHouseFlag` 36,
`ignoresHomeHouseFlag` 19, `UserShouldAttachWorkPlaceAfterJobChangeFlag` 17, `needsReligionFlag` 3.

Two consumers already approximate what these state outright:

- `packages/sim/src/core/content-index/jobs.ts` `jobRoleOfId` reads the soldier/hero/scout/hunter
  roles off the extracted id slug because "jobtypes.ini declares no role field". `ignoresHomeHouseFlag
  1` is the closest readable signal, covering exactly {25 trader, 27 scout, 31..47}. It is only
  partial: it does not split soldier from hero (the fight-XP routing needs that) and does not isolate
  the hunter, so it cannot replace the slug reading on its own.
- `packages/sim/src/systems/settlers/targets/workplaces.ts` `boundWorkplaceTarget` cites
  `mustHaveFinishedWorkHouseFlag` in prose and hardcodes the gate it describes.

## Scope

- Extract the flags onto `JobType` and regenerate; confirm each key's real per-job values against the
  owned copy first (they are case-sensitive and not all 55 sections carry every key).
- Replace `boundWorkplaceTarget`'s hardcoded finished-workhouse gate with the extracted flag, and
  record whether the real values change its behaviour.
- Keep `jobRoleOfId` as the named slug approximation: `ignoresHomeHouseFlag` does not distinguish the
  soldier, hero, or hunter roles it needs.

## Verify

`npm run test:pipeline` against the owned copy, plus a unit test pinning the extracted flags of a job
that sets each one. `npm test`, `npm run check`, `npm run build`.
