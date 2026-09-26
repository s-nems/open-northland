import { entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  builtFractionOf,
  isBuilding,
  ownerPlayerOf,
  type SnapshotEntity,
} from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { compareLabels } from '../../i18n/index.js';
import { healthBar, pct } from '../details-panel/model/bars.js';
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
 * additionally carry what the bill still needs, which the original leaves to its own window. Owner rule:
 * another seat's building, ally or enemy, shows its health in place of its goods or bill.
 */

export interface BuildingHoverContext extends BuildingStockContext {
  /** Whose store the card may list: the viewer's own buildings, or every one on the whole map. */
  readonly viewer: ViewerSeat;
}

/** The card's model for the building under the cursor, or null when `entityId` is not a building. */
export function buildingHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: BuildingHoverContext,
): BuildingHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isBuilding(ent)) return null;
  const typeId = buildingTypeOf(ent);
  const def = buildingDef(ctx, typeId);
  const site = ent.components.UnderConstruction !== undefined;
  const seat = pickableSeat(ctx.viewer);
  const owner = ownerPlayerOf(ent);
  // An ownerless house (a scene's ruin) is nobody else's.
  const foreign = seat !== null && owner !== undefined && owner !== seat;
  return {
    kind: 'building',
    entityId,
    title: buildingTitle(ctx, typeId),
    state: hoverState(ent),
    health: foreign ? healthBar(ent) : null,
    rows: foreign ? [] : sortByLabel(site ? billRows(ctx, def, ent) : held(ctx, def, ent)),
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
  const compare = compareLabels();
  return rows.sort((a, b) => compare(a.label, b.label));
}
