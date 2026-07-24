import type { WorldSnapshot } from '@open-northland/sim';
import { type entityById, num } from '../../../game/snapshot.js';
import { messages } from '../../../i18n/index.js';
import { pctRatio } from './bars.js';
import {
  type BuildingDef,
  goodDef,
  goodLabel,
  recipeOutputs,
  type UnitPanelModelContext,
} from './context.js';

// The building's Produkcja model: a workshop's per-product recipe rows, or a farm's live field state.

/** One product row of a workshop's Produkcja section — its icon/name on the left, the bar's live
 *  progress, and the hover tooltip naming the recipe's inputs. */
export interface ProductionRow {
  readonly goodType: number;
  /** The product's string id — the row's icon key (like {@link StockRow.goodId}). */
  readonly goodId?: string;
  readonly label: string;
  /**
   * The row's bar: the FRONT-RUNNER batch of this product — the highest progress among the in-flight
   * `Production.cycles` crafting it (a finished batch deposits and leaves the list, so the bar hands
   * over to the next-furthest batch). 0 when none runs.
   */
  readonly pct: number;
  /** The hover tooltip's ingredient list — one "- Żelazo ×2" line per recipe input (newline-joined; the
   *  panel prefixes the product name line), or the no-materials label for an input-less craft; empty
   *  when the inputs are unknown (no recipe). */
  readonly inputs: string;
}

/**
 * The Produkcja section's content, one of two shapes:
 *  - `recipe` — a workshop's per-product rows (one bar per producible good — a smithy 2 lists all
 *    five wares; see {@link ProductionRow});
 *  - `fields` — a farm's live field state (the produced good's icon + the sown/growing/ripe counters),
 *    for a workplace producing a field-farmed good (`farming` on the good, no recipe): there is no
 *    recipe to show, the "production" is the fields its farmers work around the building.
 */
export type ProductionModel =
  | {
      readonly kind: 'recipe';
      /** One row per producible good (recipe order) — the single source both the layout's height math
       *  and the section's row loop consume, so they can never drift apart. Never empty. */
      readonly rows: readonly ProductionRow[];
    }
  | {
      readonly kind: 'fields';
      /** The farmed good's string id — the icon key (like {@link StockRow.goodId}). */
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

/** Count a farm's fields in the snapshot: every `Crop` whose `farm` is this building, split into still
 *  growing vs ripe (`stage >= stages`). One entity pass, shared shape with the other snapshot scans. */
function fieldCounts(snapshot: WorldSnapshot, buildingId: number): { growing: number; ripe: number } {
  let growing = 0;
  let ripe = 0;
  for (const e of snapshot.entities) {
    const crop = e.components.Crop as { farm?: unknown; stage?: unknown; stages?: unknown } | undefined;
    if (crop === undefined || num(crop.farm) !== buildingId) continue;
    const stage = num(crop.stage) ?? 0;
    const stages = num(crop.stages) ?? Number.POSITIVE_INFINITY;
    if (stage >= stages) ripe++;
    else growing++;
  }
  return { growing, ripe };
}

export function productionModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: NonNullable<ReturnType<typeof entityById>>,
): ProductionModel | null {
  // A farm produces a field-farmed good — checked before the recipes, mirroring the sim: farmWorkGood
  // ignores recipe presence and ai.ts ranks the farmer rung above the producer rung precisely because
  // real extracted content synthesizes abstract recipes from `logicproduction` for every producer.
  // Wherever the sim farms, the panel must show live field state, never a dead recipe bar.
  const fieldGood = (def?.produces ?? []).map((g) => goodDef(ctx, g)).find((g) => g?.farming !== undefined);
  if (fieldGood !== undefined) {
    const { growing, ripe } = fieldCounts(snapshot, ent.id);
    return {
      kind: 'fields',
      label: fieldGood.name ?? fieldGood.id,
      sown: growing + ripe,
      growing,
      ripe,
      ...(fieldGood.id !== undefined ? { goodId: fieldGood.id } : {}),
    };
  }
  const outputs = recipeOutputs(def);
  if (outputs.length === 0) return null; // not a producer — no Produkcja window
  // The front-runner batch per product: the highest progress among the cycles crafting that good
  // (a completed batch deposits and leaves the list, so the bar hands over to the runner-up).
  const production = ent.components.Production as { cycles?: unknown } | undefined;
  const bestPct = new Map<number, number>();
  for (const c of Array.isArray(production?.cycles) ? production.cycles : []) {
    const cycle = c as { elapsed?: unknown; duration?: unknown; goodType?: unknown } | null;
    const good = num(cycle?.goodType);
    if (good === undefined) continue;
    const pct = pctRatio(num(cycle?.elapsed), num(cycle?.duration));
    if (pct > (bestPct.get(good) ?? -1)) bestPct.set(good, pct);
  }
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

/** A recipe's inputs as the tooltip's ingredient lines — one "- Żelazo ×2" per line — or the
 *  no-materials label for an input-less craft (the well). */
function recipeInputsLabel(
  ctx: UnitPanelModelContext,
  inputs: readonly { goodType: number; amount: number }[],
): string {
  if (inputs.length === 0) return messages().hud.recipeNoInputs;
  return inputs.map((i) => `- ${goodLabel(ctx, i.goodType)} ×${i.amount}`).join('\n');
}
