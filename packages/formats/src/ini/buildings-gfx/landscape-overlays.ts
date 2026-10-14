import { BuildingLandscapeOverlay } from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import { makeSource, type SourceRef } from '../ir-fields.js';
import { findProps, getStr } from '../props.js';
import { gfxHouseLogicRecords } from './shared.js';

export function extractBuildingLandscapeOverlays(
  sections: readonly RuleSection[],
  src: SourceRef,
): BuildingLandscapeOverlay[] {
  const rows: BuildingLandscapeOverlay[] = [];
  for (const { rec, tribeType, typeByLevel } of gfxHouseLogicRecords(sections)) {
    for (const prop of findProps(rec, 'gfxoverlaylandscape')) {
      if (prop.values.length !== 5) continue;
      const [level, slot, x, y] = prop.values.slice(0, 4).map(Number);
      if (level === undefined) continue;
      const parsed = BuildingLandscapeOverlay.safeParse({
        tribeId: tribeType,
        typeId: typeByLevel.get(level),
        level,
        slot,
        x,
        y,
        landscape: prop.values[4],
        editName: getStr(rec, 'EditName'),
        source: makeSource(src, 'GfxHouse'),
      });
      if (parsed.success) rows.push(parsed.data);
    }
  }
  return rows;
}
