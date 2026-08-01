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

interface FieldCounts {
  readonly growing: number;
  readonly ripe: number;
}

/** {@link fieldCountsByFarm} keyed by snapshot, like the `snapshot-base.ts` memos: the panel re-derives
 *  its model every tick a farm stays selected, and `Crop` is outside `actorsOf`, so without this the
 *  full-entity crops walk would repeat per derive. */
const FIELD_COUNTS = new WeakMap<WorldSnapshot, ReadonlyMap<number, FieldCounts>>();

/** Every farm's field tally in one entity pass: each `Crop` grouped by its `farm`, split into still
 *  growing vs ripe (`stage >= stages`). */
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
  // A farm produces a field-farmed good — checked before the recipes, mirroring the sim: farmWorkGood ignores
  // recipe presence and planner/system.ts ranks the farmer rung above the producer rung precisely because
  // real extracted content synthesizes abstract recipes from `logicproduction` for every producer. Wherever
  // the sim farms, the panel must show live field state, never a dead recipe bar.
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
