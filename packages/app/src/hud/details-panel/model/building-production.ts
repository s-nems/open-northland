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
import { pctRatio } from './bars.js';
import { liveAmounts } from './building-materials.js';
import {
  type BuildingDef,
  goodDef,
  goodLabel,
  recipeOutputs,
  type UnitPanelModelContext,
} from './context.js';
import { goodEffectText } from './good-effect.js';

/** One product row of a workshop's Production section. */
export interface ProductionRow {
  readonly goodType: number;
  /** The product's string id - the row's icon key. */
  readonly goodId?: string;
  readonly label: string;
  /** What the product does when carried, for a draught or an amulet; otherwise empty. */
  readonly effect: string;
  /** The highest progress among the in-flight `Production.cycles` crafting this product; 0 when none
   *  runs, since a finished batch deposits and leaves the list. */
  readonly pct: number;
  /** A batch of this product is in flight, however far along. */
  readonly running: boolean;
  /** What one cycle takes against what the house holds; empty for a craft that takes nothing. */
  readonly inputs: readonly RecipeInputModel[];
}

/** One ingredient of a product's recipe: the units one cycle takes and the whole units on the shelf. */
export interface RecipeInputModel {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  readonly have: number;
  readonly need: number;
}

/**
 * The Production section's content: `recipe` for a workshop's per-product rows, `fields` for a workplace
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

const CROPS_BY_FARM = groupedBy(
  (e) => {
    const crop = cropOf(e);
    return crop === undefined ? undefined : num(crop.farm);
  },
  'crops by farm',
  { values: ['Crop'] },
);

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
  if (outputs.length === 0) return null; // not a producer - no Production window
  const held = liveAmounts(ent.components.Stockpile);
  const inputsByProduct = new Map<number, RecipeInputModel[]>();
  for (const recipe of def?.recipes ?? []) {
    const product = recipe.outputs[0]?.goodType;
    if (product === undefined || inputsByProduct.has(product)) continue;
    inputsByProduct.set(product, recipeInputs(ctx, recipe.inputs, held));
  }
  const rows = outputs.map((o) => {
    const good = goodDef(ctx, o.goodType);
    const goodId = good?.id;
    return {
      goodType: o.goodType,
      label: o.amount > 1 ? `${goodLabel(ctx, o.goodType)} ×${o.amount}` : goodLabel(ctx, o.goodType),
      effect: goodEffectText(good?.equip),
      pct: bestPct.get(o.goodType) ?? 0,
      running: bestPct.has(o.goodType),
      inputs: inputsByProduct.get(o.goodType) ?? [],
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
 * A livestock workplace's Production: one row per species it breeds, named after the species and carrying
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
      effect: '',
      pct: bestPct.get(species) ?? 0,
      running: bestPct.has(species),
      // What one breeding costs.
      inputs: recipeInputs(ctx, recipe.inputs, held),
      ...(goodId !== undefined ? { goodId } : {}),
    });
  }
  return rows;
}

function recipeInputs(
  ctx: UnitPanelModelContext,
  inputs: readonly { goodType: number; amount: number }[],
  held: ReadonlyMap<number, number>,
): RecipeInputModel[] {
  return inputs.map((input) => {
    const goodId = goodDef(ctx, input.goodType)?.id;
    return {
      goodType: input.goodType,
      label: goodLabel(ctx, input.goodType),
      have: held.get(input.goodType) ?? 0,
      need: input.amount,
      ...(goodId !== undefined ? { goodId } : {}),
    };
  });
}
