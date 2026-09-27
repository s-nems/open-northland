import {
  groupedBy,
  indexesOf,
  nodeOfPosition,
  ONE,
  positionedWithin,
  positionOfNode,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import { num, positionOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { pctRatio } from './bars.js';
import { liveAmounts } from './building-materials.js';
import {
  type BuildingDef,
  goodDef,
  goodLabel,
  recipeOutputs,
  type UnitPanelModelContext,
} from './context.js';

/** One product row of a workshop's Produkcja section. */
export interface ProductionRow {
  readonly goodType: number;
  /** The product's string id - the row's icon key. */
  readonly goodId?: string;
  /** Further icon keys drawn beside {@link goodId} - a livestock chain row shows every ware the
   *  species' visit yields (meat + wool, meat + leather). */
  readonly extraGoodIds?: readonly string[];
  readonly label: string;
  /** The highest progress among the in-flight `Production.cycles` crafting this product; 0 when none
   *  runs, since a finished batch deposits and leaves the list. */
  readonly pct: number;
  /** The hover tooltip's ingredient lines, one "- Żelazo ×2" per recipe input; empty when the inputs are
   *  unknown. */
  readonly inputs: string;
}

/**
 * The Produkcja section's content: `recipe` for a workshop's per-product rows, `fields` for a workplace
 * producing a field-farmed good (`farming` on the good, no recipe), whose production is the fields its
 * farmers work around the building rather than a recipe.
 */
export type ProductionModel =
  | {
      readonly kind: 'recipe';
      /** One row per producible good, in recipe order; never empty. */
      readonly rows: readonly ProductionRow[];
    }
  | {
      readonly kind: 'fields';
      /** The farmed good's string id - the icon key. */
      readonly goodId?: string;
      /** The farmed good's display name. */
      readonly label: string;
      /** All standing fields of this farm (growing + ripe). */
      readonly sown: number;
      /** Fields still growing (below their top stage). */
      readonly growing: number;
      /** Ripe fields awaiting the scythe. */
      readonly ripe: number;
    };

interface CropSnapshot {
  readonly farm?: unknown;
  readonly goodType?: unknown;
  readonly stage?: unknown;
  readonly stages?: unknown;
}

function cropOf(e: SnapshotEntity): CropSnapshot | undefined {
  return e.components.Crop as CropSnapshot | undefined;
}

/** A field past its top stage awaits the scythe; one without a stage count never ripens. */
function isRipe(crop: CropSnapshot): boolean {
  return (num(crop.stage) ?? 0) >= (num(crop.stages) ?? Number.POSITIVE_INFINITY);
}

const CROPS_BY_FARM = groupedBy((e) => {
  const crop = cropOf(e);
  return crop === undefined ? undefined : num(crop.farm);
});

/** Tiles a position reaches past its half-cell node's lattice point: the node spans half a tile, and the
 *  row stagger shifts it by up to half a tile more. */
const NODE_REACH_TILES = 1;

export function productionModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): ProductionModel | null {
  // A field-farmed good is checked before the recipes, as the sim does: extracted content synthesizes an
  // abstract recipe for every producer, so a farm would otherwise draw a dead recipe bar.
  const fieldGood = (def?.produces ?? []).map((g) => goodDef(ctx, g)).find((g) => g?.farming !== undefined);
  if (fieldGood !== undefined) {
    let growing = 0;
    let ripe = 0;
    for (const field of indexesOf(snapshot).get(CROPS_BY_FARM).get(ent.id) ?? []) {
      const crop = cropOf(field);
      if (crop === undefined) continue;
      if (isRipe(crop)) ripe++;
      else growing++;
    }
    const pos = positionOf(ent);
    if (pos !== undefined && fieldGood.farming !== undefined) {
      const anchor = nodeOfPosition(pos.x, pos.y);
      const radius = fieldGood.farming.fieldRadius;
      // Every position whose node lies within the radius on either axis; the exact test follows.
      const low = positionOfNode(anchor.hx - radius, anchor.hy - radius);
      const high = positionOfNode(anchor.hx + radius, anchor.hy + radius);
      const box: TileBox = {
        minX: low.x / ONE - NODE_REACH_TILES,
        minY: low.y / ONE - NODE_REACH_TILES,
        maxX: high.x / ONE + NODE_REACH_TILES,
        maxY: high.y / ONE + NODE_REACH_TILES,
      };
      for (const field of positionedWithin(snapshot, box, [])) {
        const crop = cropOf(field);
        const at = positionOf(field);
        if (crop?.farm !== null || at === undefined || num(crop.goodType) !== fieldGood.typeId) continue;
        const node = nodeOfPosition(at.x, at.y);
        if (Math.abs(node.hx - anchor.hx) + Math.abs(node.hy - anchor.hy) > radius) continue;
        if (isRipe(crop)) ripe++;
        else growing++;
      }
    }
    return {
      kind: 'fields',
      label: fieldGood.name ?? fieldGood.id,
      sown: growing + ripe,
      growing,
      ripe,
      ...(fieldGood.id !== undefined ? { goodId: fieldGood.id } : {}),
    };
  }
  const bestPct = cycleFrontRunners(ent);
  const herdRows = livestockHerdRows(ctx, def, ent, bestPct);
  if (herdRows.length > 0) return { kind: 'recipe', rows: herdRows };
  // A self-filling house (the well, the hive) runs no craft cycle, so a production bar would never move.
  if (def?.refillsOwnStock === true) return null;
  // A vehicle good is built on a hidden yard beside the workshop, never as a cycle, so its bar would
  // never move; the worker picks it in the settler window's craft choices instead.
  const outputs = recipeOutputs(ctx, def).filter((o) => goodDef(ctx, o.goodType)?.vehicleHouse === undefined);
  if (outputs.length === 0) return null; // not a producer - no Produkcja window
  const inputsByProduct = new Map<number, string>();
  for (const recipe of def?.recipes ?? []) {
    const product = recipe.outputs[0]?.goodType;
    if (product === undefined || inputsByProduct.has(product)) continue;
    inputsByProduct.set(product, recipeInputsLabel(ctx, recipe.inputs));
  }
  const rows = outputs.map((o) => {
    const goodId = goodDef(ctx, o.goodType)?.id;
    return {
      goodType: o.goodType,
      label: o.amount > 1 ? `${goodLabel(ctx, o.goodType)} ×${o.amount}` : goodLabel(ctx, o.goodType),
      pct: bestPct.get(o.goodType) ?? 0,
      inputs: inputsByProduct.get(o.goodType) ?? '',
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
  return { kind: 'recipe', rows };
}

function cycleFrontRunners(ent: SnapshotEntity): Map<number, number> {
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  const bestPct = new Map<number, number>();
  for (const c of Array.isArray(production?.cycles) ? production.cycles : []) {
    const cycle = c as { elapsed?: unknown; duration?: unknown; goodType?: unknown } | null;
    const good = num(cycle?.goodType);
    if (good === undefined) continue;
    const pct = pctRatio(num(cycle?.elapsed), num(cycle?.duration));
    if (pct > (bestPct.get(good) ?? -1)) bestPct.set(good, pct);
  }
  return bestPct;
}

/**
 * A livestock workplace's Produkcja: one row per species it breeds, named after the species and carrying
 * the herd its farm holds against the row's cap, barred by the breeding cycle in flight. Empty at any
 * other workplace, which falls through to the per-good rows.
 */
function livestockHerdRows(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
  bestPct: ReadonlyMap<number, number>,
): ProductionRow[] {
  if (def === undefined || ctx.isLivestockWorkplace?.(def.typeId) !== true) return [];
  const held = liveAmounts(ent.components.Stockpile);
  const rows: ProductionRow[] = [];
  for (const recipe of def.recipes) {
    const species = recipe.outputs[0]?.goodType;
    if (species === undefined || ctx.livestockTribeOfGood?.(species) == null) continue;
    const cap = def.stock.find((slot) => slot.goodType === species)?.capacity;
    const herd = held.get(species) ?? 0;
    const goodId = goodDef(ctx, species)?.id;
    rows.push({
      goodType: species,
      label: `${goodLabel(ctx, species)} ${herd}${cap === undefined ? '' : `/${cap}`}`,
      pct: bestPct.get(species) ?? 0,
      // The requirements hover: what one breeding costs.
      inputs: recipeInputsLabel(ctx, recipe.inputs),
      ...(goodId !== undefined ? { goodId } : {}),
    });
  }
  return rows;
}

/** A recipe's inputs as tooltip ingredient lines, or the no-materials label for an input-less craft. */
function recipeInputsLabel(
  ctx: UnitPanelModelContext,
  inputs: readonly { goodType: number; amount: number }[],
): string {
  if (inputs.length === 0) return messages().hud.recipeNoInputs;
  return inputs.map((i) => `- ${goodLabel(ctx, i.goodType)} ×${i.amount}`).join('\n');
}
