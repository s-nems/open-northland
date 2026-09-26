import type { MapSpecialItem } from '@open-northland/data';
import { PAPER_KINDS, type Paper } from '@open-northland/sim';
import type { WorldSetup } from './world/index.js';

/** The paper a `[specialItems]` row grants: the row's kind code indexes the engine's kind list from 1. */
export function paperOfSpecialItem(row: MapSpecialItem): Paper | undefined {
  const kind = PAPER_KINDS[row.kind - 1];
  return kind === undefined ? undefined : { kind, param: row.param };
}

/** Hand the map's authored starting papers out through the setup seam, in authored order, so a replay
 *  and every lockstep peer mint the same lists. */
export function grantStartingPapers(sim: WorldSetup, rows: readonly MapSpecialItem[]): void {
  for (const row of rows) {
    const paper = paperOfSpecialItem(row);
    if (paper !== undefined) sim.enqueueSetup({ kind: 'grantPaper', player: row.player, paper });
  }
}
