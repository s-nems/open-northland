import type { ChimneyLookup, ChimneyPoint } from '@open-northland/render';
import { bmdAtlasBase } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import { HOUSE_ATLAS } from './families.js';

/** The bob set a served atlas stem (`<bob set>.<palette>`) recolours. */
function bobSetOf(stem: string): string {
  const dot = stem.indexOf('.');
  return dot < 0 ? stem : stem.slice(0, dot);
}

/**
 * Where a drawn building body smokes from, whatever palette it wears: its `GfxChimneyPoint` anchors, in
 * bob-anchor px (+y down) at the building kind's native scale, each with the fire under it.
 */
export function chimneyLookup(ir: ContentIr | null): ChimneyLookup {
  const byBody = new Map<string, ChimneyPoint[]>();
  for (const row of ir?.buildingChimneyPoints ?? []) {
    const body = `${bmdAtlasBase(row.bmd)}:${row.bobId}`;
    const points = byBody.get(body);
    const point = { x: row.x, y: row.y, smoke: row.smoke };
    if (points === undefined) byBody.set(body, [point]);
    else points.push(point);
  }
  return (layer, bob) => byBody.get(`${bobSetOf(layer ?? HOUSE_ATLAS)}:${bob}`);
}
