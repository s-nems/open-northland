# Extract `mustHaveFinishedWorkHouseFlag` instead of applying it as a blanket

## Problem

Three sim seams refuse to work a building that is still going up:

- `settlers/targets/workplaces.ts` `boundWorkplaceTarget` (the bound-producer loop),
- `settlers/drives/farming/drive.ts` (the field trades),
- `settlers/drives/economy/site-staff.ts` `planSiteStaff` (staff posted to a site).

All three cite `jobtypes.ini` `mustHaveFinishedWorkHouseFlag` and then apply it to every trade, because the
flag is not extracted into `content/ir.json`. The data does not say that. Verified on the owned copy:
`Data/logic/jobtypes.ini` carries `mustHaveFinishedWorkHouseFlag 0` on the hunter, the scout and the jester.

The hunter is the one that bites: `ir.json` gives the headquarters and every warehouse tier a hunter slot
(`count 3`), and the app deliberately posts a gatherer into it. So a hunter posted to a store stops hunting
for the whole of that store's upgrade, where the flag says he should carry on. Nothing in the field needs
the building he delivers into.

## Scope

1. Extract the per-job flag in the asset pipeline and add it to the job rows in the IR (`tools/asset-pipeline`
   + the `JobType` schema in `packages/data`).
2. Read it in the three seams above instead of assuming 1. Keep the blanket as the fallback for content that
   does not carry the flag.
3. Cover the hunter case: a hunter posted to a warehouse keeps harvesting while that warehouse is upgraded,
   while a baker posted to a bakery still stands down.

## Verification

`npm test`, plus `npm run test:pipeline` and `npm run test:content` against the owned copy (the extraction
and the join both change). Expect the upgrade-standdown and site-staff cases to gain a gatherer arm.
