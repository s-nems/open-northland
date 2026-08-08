import type { WorldSnapshot } from '@open-northland/sim';
import { num, type SnapshotEntity } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { pctRatio } from './bars.js';
import {
  type BuildingDef,
  goodDef,
  goodLabel,
  recipeOutputs,
  type UnitPanelModelContext,
  visibleRecipes,
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

interface FieldCounts {
  readonly growing: number;
  readonly ripe: number;
}

/** Keyed by snapshot: the panel re-derives its model every tick a farm stays selected, and `Crop` is
 *  outside `actorsOf`, so the full-entity walk below would otherwise repeat. */
const FIELD_COUNTS = new WeakMap<WorldSnapshot, ReadonlyMap<number, FieldCounts>>();

/** Every farm's field tally in one entity pass, split into still growing vs ripe (`stage >= stages`). */
function fieldCountsByFarm(snapshot: WorldSnapshot): ReadonlyMap<number, FieldCounts> {
  const cached = FIELD_COUNTS.get(snapshot);
  if (cached !== undefined) return cached;
  const byFarm = new Map<number, { growing: number; ripe: number }>();
  for (const e of snapshot.entities) {
    const crop = e.components.Crop as { farm?: unknown; stage?: unknown; stages?: unknown } | undefined;
    if (crop === undefined) continue;
    const farm = num(crop.farm);
    if (farm === undefined) continue;
    let counts = byFarm.get(farm);
    if (counts === undefined) {
      counts = { growing: 0, ripe: 0 };
      byFarm.set(farm, counts);
    }
    const stage = num(crop.stage) ?? 0;
    const stages = num(crop.stages) ?? Number.POSITIVE_INFINITY;
    if (stage >= stages) counts.ripe++;
    else counts.growing++;
  }
  FIELD_COUNTS.set(snapshot, byFarm);
  return byFarm;
}

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
    const { growing, ripe } = fieldCountsByFarm(snapshot).get(ent.id) ?? { growing: 0, ripe: 0 };
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
  const chainRows = livestockChainRows(ctx, def, bestPct);
  if (chainRows.length > 0) return { kind: 'recipe', rows: chainRows };
  const outputs = recipeOutputs(ctx, def);
  if (outputs.length === 0) return null; // not a producer - no Produkcja window
  const inputsByProduct = new Map<number, string>();
  for (const recipe of visibleRecipes(ctx, def)) {
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
 * A livestock workplace's Produkcja: one row per species chain rather than per good, named after the
 * species, carrying every ware the visit yields as icons, and barred by the chain's front-runner across
 * both stages. Empty at any other workplace, which falls through to the per-good rows.
 */
function livestockChainRows(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  bestPct: ReadonlyMap<number, number>,
): ProductionRow[] {
  if (def === undefined || ctx.isLivestockWorkplace?.(def.typeId) !== true) return [];
  const recipes = visibleRecipes(ctx, def);
  const meat = ctx.livestockMeatGood ?? null;
  const rows: ProductionRow[] = [];
  for (const feed of recipes) {
    const token = feed.outputs[0]?.goodType;
    if (token === undefined || ctx.isLivestockGood?.(token) !== true) continue;
    const product = recipes.find((r) => r.inputs.some((i) => i.goodType === token))?.outputs[0]?.goodType;
    const icons = [meat, product ?? null]
      .filter((g): g is number => g !== null)
      .map((g) => goodDef(ctx, g)?.id)
      .filter((id): id is string => id !== undefined);
    const [goodId, ...extraGoodIds] = icons;
    rows.push({
      goodType: token,
      label: goodLabel(ctx, token),
      pct: Math.max(bestPct.get(token) ?? 0, product === undefined ? 0 : (bestPct.get(product) ?? 0)),
      // The requirements hover: the feed recipe's goods, plus the penned animal the batch books.
      inputs: `${recipeInputsLabel(ctx, feed.inputs)}\n- ${goodLabel(ctx, token)}`,
      ...(goodId !== undefined ? { goodId } : {}),
      ...(extraGoodIds.length > 0 ? { extraGoodIds } : {}),
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
