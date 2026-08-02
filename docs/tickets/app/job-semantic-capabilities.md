# Bind semantic job capabilities at the content boundary

**Area:** app, data, sim · **Focus:** content · **Priority:** P3

Several job classifications key on the extracted `jobtypes.ini` id slug, because no readable field flags
the role: `core/content-index/jobs.ts` (fighter/scout/hunter), `stores/workplace.ts` `isCarrierJob`
(`carrier`), `readviews/jobs.ts` `isSeaJob` (`_sea`), `family/eligibility.ts` `isFemaleJobId`. A content
set whose job table is renamed or localized resolves an empty set for one of them and degrades in
silence: the load succeeds, no diagnostic fires, and the symptom is behavioural (an army that never
auto-engages, a store nobody hauls for, a settlement that never marries).

`packages/app/test/content/job-roles.test.ts` catches a rename in our own pipeline output, but not a
third-party content set at runtime. Reporting the miss would expose the failure but leave sim systems
parsing source identifiers for mechanics, contrary to the content boundary: the clean-room meaning
must be materialized once in validated content and consumed semantically.

## Scope

- Add validated semantic capabilities for the distinctions the sim consumes: soldier, hero, scout,
  hunter, carrier, female, and sea work. Use composable capabilities where one job has more than one;
  do not force them into a mutually exclusive enum.
- Author the committed fallback bindings directly. Resolve the current real-content bindings once at
  the app/content boundary from the source slugs and name that join as an approximation where no
  readable flag exists; sim systems must not inspect those slugs.
- Allow third-party content to supply the bindings without adopting the current English identifiers.
- Surface an empty-but-expected capability as a `RealContentMerge` gap alongside the existing ones and
  report it through `logRealContentGaps`. Keep it diagnostic rather than a load failure because content
  with no soldiers, carrier, or sea jobs can be legal.
- Keep extracted per-job flags in their own fields; they state related behavior but do not distinguish
  every semantic capability above.

## Verify

Schema tests round-trip the capabilities. Sim tests use synthetic non-English ids to prove fighter,
carrier, family, and sea behavior follows capabilities rather than strings. A merge test with a missing
expected capability reports the gap while loading successfully. Run `npm test`, `npm run check`, and
`npm run build`; run `npm run test:content` when local content exists.
