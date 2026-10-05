import { type BuildingBobRef, lookupFrame, type SpriteSheet } from '@open-northland/render';
import { entitiesWith, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { buildingTribeOf, buildingTypeOf, positionOf } from '../../game/snapshot-base.js';
import type { AuthoredPlacement } from '../../game/world/authored-placements.js';
import { type AuthoredHolyFireVariant, holyFireLookup, servedAtlasStem } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';
import { HOUSE_ATLAS, skinPalettePool } from './families.js';

/** Bind once, before the first draw; subsequent frames only look up the entity id. On restore the map
 *  is rejoined by anchor and type. Approximation: a replacement of the same type on that exact anchor
 *  inherits its authored appearance after loading a save; saves carry no presentation provenance. */
export function authoredBuildingSheet(
  sheet: SpriteSheet,
  placements: readonly AuthoredPlacement[],
  snapshot: WorldSnapshot,
  ir: ContentIr | null = null,
): { sheet: SpriteSheet; skipped: number } {
  const binding = sheet.bindings.building;
  if (binding === undefined || typeof binding === 'number') return { sheet, skipped: 0 };
  const byAnchor = new Map(
    placements.flatMap((p) =>
      p.kind === 'building' && p.graphics !== undefined ? [[`${p.x},${p.y}`, p] as const] : [],
    ),
  );
  const byEntity = new Map<
    number,
    {
      readonly typeId: number;
      readonly tribe: number;
      readonly body: BuildingBobRef;
      readonly flagPoint?: { readonly x: number; readonly y: number };
    }
  >();
  const fireVariants = new Map<number, AuthoredHolyFireVariant>();
  let skipped = 0;
  for (const entity of entitiesWith(snapshot, 'Building')) {
    const position = positionOf(entity);
    if (position === undefined) continue;
    const { hx, hy } = nodeOfPosition(position.x, position.y);
    const placement = byAnchor.get(`${hx},${hy}`);
    if (placement?.graphics === undefined) continue;
    // A civilization chosen in the lobby takes its own canonical body.
    if (buildingTypeOf(entity) !== placement.typeId || buildingTribeOf(entity) !== placement.tribe) continue;
    const row = skinPalettePool(placement.graphics, entity.id)[0];
    if (row === undefined) continue;
    const stem = servedAtlasStem(row);
    if (stem === undefined) continue;
    const isDefault = stem === HOUSE_ATLAS;
    const atlas = isDefault ? sheet.kindLayers?.building?.atlas : sheet.families?.[stem]?.atlas;
    if (atlas === undefined || lookupFrame(atlas, row.bobId) === null) {
      skipped++;
      continue;
    }
    fireVariants.set(entity.id, {
      typeId: placement.typeId,
      tribe: placement.tribe,
      editName: row.editName,
      level: row.level,
    });
    byEntity.set(entity.id, {
      typeId: placement.typeId,
      tribe: placement.tribe,
      body: isDefault ? row.bobId : { layer: stem, bob: row.bobId },
      ...(row.flagPoint !== undefined ? { flagPoint: row.flagPoint } : {}),
    });
  }
  if (byEntity.size === 0) return { sheet, skipped };
  return {
    sheet: {
      ...sheet,
      bindings: { ...sheet.bindings, building: { ...binding, byEntity } },
      ...(ir !== null && sheet.holyFire !== undefined ? { holyFire: holyFireLookup(ir, fireVariants) } : {}),
    },
    skipped,
  };
}
