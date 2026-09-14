import { type ContentSet, fullStateBlockAreaCells, type LandscapeGfx } from '@open-northland/data';
import type { ChestKind, ResourceFootprintData } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';

/** The `landscapetypes.ini` slugs of the two chest landscapes, the join from a chest kind to its record. */
const CHEST_LANDSCAPE_SLUG: Readonly<Record<ChestKind, string>> = {
  wooden: 'chest_wooden',
  magical: 'chest_magical',
};

/** The druid trade's `jobtypes` slug, the one civilian who may open a magical chest. */
const DRUID_JOB_SLUG = 'druid';

interface ChestTables {
  readonly recordByKind: ReadonlyMap<ChestKind, LandscapeGfx>;
  readonly druidJobType: number | null;
}

const tablesByContent = new WeakMap<ContentSet, ChestTables>();

/** Per content set: each chest kind's first `[GfxLandscape]` record, and the druid job. Pure derived data. */
function chestTables(content: ContentSet): ChestTables {
  let tables = tablesByContent.get(content);
  if (tables === undefined) {
    const typeBySlug = new Map(content.landscape.map((l) => [l.id, l.typeId]));
    const recordByKind = new Map<ChestKind, LandscapeGfx>();
    for (const kind of ['wooden', 'magical'] as const) {
      const typeId = typeBySlug.get(CHEST_LANDSCAPE_SLUG[kind]);
      const record = content.landscapeGfx.find((g) => g.logicType === typeId);
      if (record !== undefined) recordByKind.set(kind, record);
    }
    tables = {
      recordByKind,
      druidJobType: content.jobs.find((j) => j.id === DRUID_JOB_SLUG)?.typeId ?? null,
    };
    tablesByContent.set(content, tables);
  }
  return tables;
}

export function druidJobType(content: ContentSet): number | null {
  return chestTables(content).druidJobType;
}

/**
 * The footprint a `kind` chest stamps: the map's own record when `gfxIndex` names one the content carries,
 * else the kind's first record, else the stand-in of a chest that blocks its own cell and is worked from
 * a neighbour (the wooden record's shape).
 */
export function chestFootprint(
  content: ContentSet,
  kind: ChestKind,
  gfxIndex?: number,
): ResourceFootprintData {
  const byIndex =
    gfxIndex === undefined ? undefined : contentIndex(content).landscapeGfxByIndex.get(gfxIndex);
  const record = byIndex ?? chestTables(content).recordByKind.get(kind);
  if (record === undefined) return { walk: [{ dx: 0, dy: 0 }], build: [], work: [] };
  return {
    walk: fullStateBlockAreaCells(record.walkBlockAreas),
    build: fullStateBlockAreaCells(record.buildBlockAreas),
    work: fullStateBlockAreaCells(record.workAreas),
    sourceGfxIndex: record.index,
  };
}
