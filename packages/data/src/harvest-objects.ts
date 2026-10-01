/** The `[GfxLandscape]` record fields the harvest join reads. */
export interface HarvestJoinRecord {
  readonly index: number;
  readonly editName?: string | undefined;
}

/** The gathering-pipeline fields the harvest join reads. */
export interface HarvestJoinPipeline {
  readonly goodId: string;
  readonly harvest?: { readonly gfxIndices: readonly number[] } | undefined;
}

/** A harvestable placed-object `EditName`'s good and its own harvest-stage record. */
export interface HarvestObject<Row> {
  readonly goodId: string;
  readonly record: Row;
}

/**
 * Each placed landscape-object `EditName` the original treats as harvestable, with the good it yields:
 * a good's gathering pipeline lists the `[GfxLandscape]` indices of its standing harvest-stage forms, so
 * inverting that list (index to EditName to goodId) names them, and decor is absent by construction.
 * A name two pipelines list resolves to the later one.
 */
export function harvestObjectsByEditName<Row extends HarvestJoinRecord>(
  landscapeGfx: readonly Row[],
  pipelines: readonly HarvestJoinPipeline[],
): ReadonlyMap<string, HarvestObject<Row>> {
  const recordByIndex = new Map<number, Row>();
  for (const record of landscapeGfx) {
    if (record.editName !== undefined) recordByIndex.set(record.index, record);
  }
  const out = new Map<string, HarvestObject<Row>>();
  for (const pipeline of pipelines) {
    for (const index of pipeline.harvest?.gfxIndices ?? []) {
      const record = recordByIndex.get(index);
      if (record?.editName !== undefined) out.set(record.editName, { goodId: pipeline.goodId, record });
    }
  }
  return out;
}
