# Report the job classifications a content set fails to resolve

**Area:** app, sim · **Focus:** content · **Priority:** P3

Several job classifications key on the extracted `jobtypes.ini` id slug, because no readable field flags
the role: `core/content-index/jobs.ts` (fighter/scout/hunter), `stores/workplace.ts` `isCarrierJob`
(`carrier`), `readviews/jobs.ts` `isSeaJob` (`_sea`), `family/eligibility.ts` `isFemaleJobId`. A content
set whose job table is renamed or localized resolves an empty set for one of them and degrades in
silence: the load succeeds, no diagnostic fires, and the symptom is behavioural (an army that never
auto-engages, a store nobody hauls for, a settlement that never marries).

`packages/app/test/content/job-roles.test.ts` catches a rename in our own pipeline output, but not a
third-party content set at runtime.

## Scope

- Surface an empty-but-expected classification as a `RealContentMerge` gap alongside the existing ones
  (`unbalancedGoods`, `unfarmedFieldGoods`, `uncatalogedBuildings`) and report it through
  `logRealContentGaps`. Cover the slug classifications listed above, not just the job roles.
- Keep it a diagnostic, not a load failure: a content set with no soldiers is legal.

## Verify

`npm test`, `npm run check`, `npm run build`. A unit test over a job table with renamed soldier/carrier
rows proving the gap is reported and the load still succeeds.
