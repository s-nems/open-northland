import type { ContentSet, LandscapeGfx } from '@open-northland/data';
import { CHEST_LANDSCAPE_SLUG, type ChestKind, type ResourceFootprintData } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { resourceFootprintFromLandscapeGfx } from '../footprint/resources.js';

/**
 * The `[GfxLandscape]` record a `kind` chest stands on: the map's own when `gfxIndex` names a record of the
 * kind's landscape type, else the kind's first record, else none.
 */
export function chestRecord(
  content: ContentSet,
  kind: ChestKind,
  gfxIndex?: number,
): LandscapeGfx | undefined {
  const index = contentIndex(content);
  const logicType = index.landscapeTypeBySlug.get(CHEST_LANDSCAPE_SLUG[kind]);
  const byIndex = gfxIndex === undefined ? undefined : index.landscapeGfxByIndex.get(gfxIndex);
  if (byIndex !== undefined && byIndex.logicType === logicType) return byIndex;
  return content.landscapeGfx.find((g) => g.logicType === logicType);
}

/** The inert graphics record paired with a closed chest record (`chest wooden open`, etc.). */
export function openedChestRecord(
  content: ContentSet,
  kind: ChestKind,
  gfxIndex?: number,
): LandscapeGfx | undefined {
  const closed = chestRecord(content, kind, gfxIndex);
  if (closed?.editName === undefined) return undefined;
  const openName = `${closed.editName} open`;
  return content.landscapeGfx.find((g) => g.editName === openName);
}

/** The footprint `record` declares, or for content shipping no chest record the stand-in of a chest
 *  blocking its own cell and worked from a neighbour (the wooden record's shape), minted fresh per stamp. */
export function chestFootprint(record: LandscapeGfx | undefined): ResourceFootprintData {
  if (record === undefined) return { walk: [{ dx: 0, dy: 0 }], build: [], work: [] };
  return resourceFootprintFromLandscapeGfx(record);
}
