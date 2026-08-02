# Extract the per-job flags from jobtypes.ini

**Area:** pipeline · **Priority:** P3

`tools/asset-pipeline/src/decoders/ini/types/jobs.ts` keeps only the atomic vocabulary and the base
job. `Data/logic/jobtypes.ini` also carries a per-job flag block that nothing reads (line counts over
the 55 `[jobtype]` sections): `canBeTrainedFlag` 55, `canHaveWorkHouseFlag` 41,
`mustHaveFinishedWorkHouseFlag` 39, `userCanChangeProductionFlag` 37, `mustHaveWorkHouseFlag` 36,
`ignoresHomeHouseFlag` 19, `UserShouldAttachWorkPlaceAfterJobChangeFlag` 17, `needsReligionFlag` 3.

Two consumers already approximate what these state outright:

- The semantic job-capability bindings tracked in
  [job-semantic-capabilities](../app/job-semantic-capabilities.md) currently
  read soldier/hero/scout/hunter roles from id slugs. `ignoresHomeHouseFlag 1` is the closest readable
  signal, covering exactly {25 trader, 27 scout, 31..47}, but it neither splits soldier from hero nor
  isolates the hunter. Extract it as source data without treating it as a replacement role field.
- `packages/sim/src/systems/settlers/targets/workplaces.ts` `boundWorkplaceTarget` cites
  `mustHaveFinishedWorkHouseFlag` in prose and hardcodes the gate it describes.

## Scope

- Extract the flags onto `JobType` and regenerate; confirm each key's real per-job values against the
  owned copy first (they are case-sensitive and not all 55 sections carry every key).
- Replace `boundWorkplaceTarget`'s hardcoded finished-workhouse gate with the extracted flag, and
  record whether the real values change its behaviour.
- Keep the extracted behavioral flags separate from the authored semantic capabilities: none of these
  flags alone distinguishes the soldier, hero, or hunter roles.

## Verify

`npm run test:pipeline` against the owned copy, plus a unit test pinning the extracted flags of a job
that sets each one. `npm test`, `npm run check`, `npm run build`.
