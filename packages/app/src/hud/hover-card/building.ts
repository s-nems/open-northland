import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { buildingTypeOf, builtFractionOf, isBuilding, type SnapshotEntity } from '../../game/snapshot.js';
import { pct } from '../details-panel/model/bars.js';
import { constructionBillRows, stockRows } from '../details-panel/model/building-materials.js';
import {
  type BuildingDef,
  type BuildingStockContext,
  buildingDef,
  buildingTitle,
} from '../details-panel/model/context.js';
import type { BuildingHoverModel, HoverCardRow } from './model.js';

/**
 * What the cursor card over a building says. Original behavior: the engine draws a tooltip overlay for
 * the house under the cursor with its name, its construction or upgrade state as a percentage, and one
 * line per good it holds, sorted by the localized good name; goods at zero are left out. A site's lines
 * additionally carry what the bill still needs, which the original leaves to its own window.
 */

/** The card's model for the building under the cursor, or null when `entityId` is not a building. */
export function buildingHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: BuildingStockContext,
): BuildingHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isBuilding(ent)) return null;
  const typeId = buildingTypeOf(ent);
  const def = buildingDef(ctx, typeId);
  const site = ent.components.UnderConstruction !== undefined;
  return {
    kind: 'building',
    entityId,
    title: buildingTitle(ctx, typeId),
    state: hoverState(ent),
    rows: sortByLabel(site ? billRows(ctx, def, ent) : held(ctx, def, ent)),
  };
}

function hoverState(ent: SnapshotEntity): BuildingHoverModel['state'] {
  if (ent.components.UnderConstruction === undefined) return null;
  const kind = ent.components.Upgrading !== undefined ? 'upgrade' : 'construction';
  return { kind, pct: pct(builtFractionOf(ent)) };
}

/** A site lists its bill, delivered against needed, since its hold carries materials rather than wares. */
function billRows(
  ctx: BuildingStockContext,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): HoverCardRow[] {
  return constructionBillRows(ctx, def, ent).map((row) => ({
    label: row.label,
    amount: row.delivered,
    needed: row.needed,
    ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
  }));
}

/** A standing building lists what it actually holds; an empty slot is no line, as in the original. */
function held(ctx: BuildingStockContext, def: BuildingDef | undefined, ent: SnapshotEntity): HoverCardRow[] {
  return stockRows(ctx, def, ent.components.Stockpile, ent.components.ProductionBonus)
    .filter((row) => row.amount > 0)
    .map((row) => ({
      label: row.label,
      amount: row.amount,
      ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
    }));
}

/** The original's order: the localized good name, so one store's lines never swap places mid-work. */
function sortByLabel(rows: HoverCardRow[]): HoverCardRow[] {
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
