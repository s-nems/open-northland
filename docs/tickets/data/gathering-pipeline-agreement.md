# Reconcile the gathering pipeline with the goods it is derived from

**Area:** data (+ pipeline) · **Priority:** P2

`GatheringPipeline` (`packages/data/src/schema/landscape/objects.ts`) restates four facts that
`GoodType` already owns, and nothing checks that the two agree:

| fact | owner | copy |
| --- | --- | --- |
| `bioLandscape` | `GoodGathering.bioLandscape` | `GatheringPipeline.bioLandscape` |
| harvest atomic | `GoodAtomics.harvest` | `GatheringPipeline.harvestAtomic` |
| stage landscape ids | `GoodGathering.harvest/pickup/store` | `GatheringStage.landscapeType` x3 |
| good slug | `GoodType.id` | `GatheringPipeline.goodId` |

`stages/ir/gathering-pipeline.ts` makes the copy, and the schema states the derivation in prose only.
`validateCrossReferences` walks each side independently, so a set where a good's gathering chain and
its materialized pipeline disagree passes every check.

Both sides have live readers: the sim resolves resource footprints from the pipeline while the app
joins collision through `good.gathering`. A stale or hand-edited `ir.json` would therefore load clean
and drive the two off different lanes.

## Scope

Add a check that the pipeline agrees with its source good on each duplicated field, or drop the
derived fields and have both readers join through `GoodType`. The check is the smaller first move; the
drop is the durable fix and needs the sim read sites costed first.

## Verify

New reject rows in the `REJECT_CASES` table of `packages/data/test/cross-references.test.ts`, one per
duplicated field, plus an accept case for a consistent set. `npm test`, `npm run check`,
`npm run build`. Regenerating from the owned copy must stay clean, since the extractor derives both
sides from the same source.
