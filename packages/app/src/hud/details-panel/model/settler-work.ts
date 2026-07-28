import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { goodUnlockedFor } from '../../../game/profession-unlocks.js';
import { num, settlerExperienceOf } from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import {
  buildingDef,
  buildingTitle,
  type Comp,
  goodDef,
  goodLabel,
  isCarrierJob,
  recipeOutputs,
  type UnitPanelModelContext,
} from './context.js';

/** The Praca section's model: the workplace/product line and the gather or craft product menus. */
export interface SettlerWorkModel {
  readonly place: string;
  readonly product: string;
  readonly gatherChoices: readonly {
    readonly goodType: number | null;
    readonly label: string;
    /** The good's string id — the key the round button draws its icon by; absent for the "Wszystko"
     *  (gather-everything) choice, which has no single good and draws the generic pile instead. */
    readonly goodId?: string;
  }[];
  readonly selectedGood: number | null;
  /** A craft operator's product toggles — one per product its workplace's recipes make (in recipe
   *  order), multi-selectable (the crafting twin of {@link gatherChoices}; the two never coexist).
   *  Empty for a non-craft settler. */
  readonly craftChoices: readonly {
    readonly goodType: number;
    readonly label: string;
    readonly goodId?: string;
  }[];
  /** The EFFECTIVE craft selection: the settler's `CraftSelection` goods, or every product when it
   *  has none (the all-products default reads as everything selected). */
  readonly selectedCraftGoods: readonly number[];
}

/**
 * The Praca section: the settler's workplace name and the good it makes. The workplace is the building
 * its `JobAssignment` points at; the product is that building's first recipe output (or `produces`
 * entry), falling back to what the settler is carrying. A settler with no `JobAssignment` reads
 * "brak miejsca pracy" — a pinned Polish fallback (the model returns the string directly; it matches
 * the original's `humanwindow` 41 wording but isn't resolved from the decoded table like the section
 * titles are).
 */
export function settlerWork(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  comps: Comp,
  progressionGated: boolean,
): SettlerWorkModel {
  const carry = comps.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
  const carried =
    carry === undefined
      ? undefined
      : `${goodLabel(ctx, num(carry.goodType) ?? -1)} ×${num(carry.amount) ?? 0}`;
  const settlerComp = comps.Settler as { tribe?: unknown; jobType?: unknown } | undefined;
  const jobType = num(settlerComp?.jobType);
  // The settler's earned-goods filter (`needforgood`, mirrored sim-side by the rotation/harvest gates):
  // both product menus offer only what this settler may actually make or dig right now.
  const experience = settlerExperienceOf(comps);
  const earned = (goodType: number): boolean =>
    goodUnlockedFor(ctx, progressionGated, num(settlerComp?.tribe), experience, goodType);
  const workFlag = comps.WorkFlag as { goodType?: unknown } | undefined;
  if (workFlag !== undefined) {
    const selectedGood = num(workFlag.goodType) ?? null;
    const goods = harvestableGoodsFor(ctx, jobType).filter((good) => earned(good.typeId));
    return gatherWork(ctx, messages().hud.workFlag, goods, selectedGood);
  }
  const assignment = comps.JobAssignment as { workplace?: unknown } | undefined;
  const workplaceId = num(assignment?.workplace);
  if (workplaceId === undefined) {
    return {
      place: messages().hud.noWorkplace,
      product: carried ?? '-',
      gatherChoices: [],
      selectedGood: null,
      craftChoices: [],
      selectedCraftGoods: [],
    };
  }
  const ent = entityById(snapshot, workplaceId);
  const rawType = num((ent?.components.Building as { buildingType?: unknown } | undefined)?.buildingType);
  const def = buildingDef(ctx, rawType);
  // A building-employed GATHERER (a harvest-capable trade, no flag) forages only what its workplace
  // stockpiles — its menu is the workplace-stored slice of its harvest vocabulary, its pick the sim's
  // GatherSelection (absent = every stored good). The gather menu WINS over the craft menu for a job
  // that is both harvest-capable and an operator slot (such a job runs the gather drive in the sim's
  // planner ladder, never the craft loop), so the two menus can't coexist.
  const harvestable = harvestableGoodsFor(ctx, jobType);
  if (harvestable.length > 0) {
    const stored = new Set((def?.stock ?? []).map((slot) => slot.goodType));
    const choices = harvestable.filter((good) => stored.has(good.typeId) && earned(good.typeId));
    if (choices.length > 0) {
      const selectedGood =
        num((comps.GatherSelection as { goodType?: unknown } | undefined)?.goodType) ?? null;
      return gatherWork(ctx, buildingTitle(ctx, rawType), choices, selectedGood);
    }
  }
  const craft = craftChoicesFor(ctx, def, comps, earned);
  if (craft !== null) {
    const selectedLabels = craft.choices
      .filter((choice) => craft.selected.includes(choice.goodType))
      .map((choice) => choice.label);
    const allSelected = selectedLabels.length === craft.choices.length;
    // A long multi-selection is summarized as a count ("Wybrano: 3") — the highlighted product buttons
    // below already name the picks, and four joined labels overflow the panel column.
    const product = allSelected
      ? messages().hud.gatherAll
      : selectedLabels.length > 2
        ? formatMessage(messages().hud.selectedCount, { count: selectedLabels.length })
        : selectedLabels.join(', ');
    return {
      place: buildingTitle(ctx, rawType),
      product,
      gatherChoices: [],
      selectedGood: null,
      craftChoices: craft.choices,
      selectedCraftGoods: craft.selected,
    };
  }
  const outputs = recipeOutputs(def);
  const product = outputs[0] === undefined ? undefined : goodLabel(ctx, outputs[0].goodType);
  return {
    place: buildingTitle(ctx, rawType),
    product: product ?? carried ?? '-',
    gatherChoices: [],
    selectedGood: null,
    craftChoices: [],
    selectedCraftGoods: [],
  };
}

/** A goods-catalog entry the gather menus filter over. */
type GoodEntry = UnitPanelModelContext['goods'][number];

/** The non-farmed goods `jobType` may harvest (its gather-menu vocabulary), in goods-catalog order —
 *  the job's allowed+base atomics minus its forbidden ones, matched against each good's harvest atomic. */
function harvestableGoodsFor(ctx: UnitPanelModelContext, jobType: number | undefined): GoodEntry[] {
  if (jobType === undefined) return [];
  const job = ctx.jobs.find((candidate) => candidate.typeId === jobType);
  if (job === undefined) return [];
  const allowed = new Set(job.allowedAtomics ?? []);
  for (const atomic of job.baseAtomics ?? []) allowed.add(atomic);
  for (const atomic of job.forbiddenAtomics ?? []) allowed.delete(atomic);
  return ctx.goods.filter(
    (good) =>
      good.farming === undefined && good.atomics.harvest !== undefined && allowed.has(good.atomics.harvest),
  );
}

/** Assemble a gatherer's Praca model: the "Wszystko" choice plus one per allowed good, with the
 *  selected pick (or the all-mode) named in the product line. Shared by the flag-bound and the
 *  building-employed gather menus. */
function gatherWork(
  ctx: UnitPanelModelContext,
  place: string,
  goods: readonly GoodEntry[],
  selectedGood: number | null,
): SettlerWorkModel {
  const gatherChoices = [
    { goodType: null, label: messages().hud.gatherAll },
    ...goods.map((good) => ({ goodType: good.typeId, label: goodLabel(ctx, good.typeId), goodId: good.id })),
  ];
  const product =
    gatherChoices.find((choice) => choice.goodType === selectedGood)?.label ?? messages().hud.gatherAll;
  return { place, product, gatherChoices, selectedGood, craftChoices: [], selectedCraftGoods: [] };
}

/**
 * The craft product toggles for a settler bound to a recipe workplace, or null when there is nothing
 * to choose: the workplace has fewer than one product, or the settler's job is not one of the type's
 * OPERATOR slots (mirrors the sim's `operatorJobsOf`: worker slots minus the carrier transport slot —
 * a carrier ferries goods, it never picks what the smiths forge; when every slot is carrier the
 * building is carrier-operated and the carrier does choose, like the well). The effective selection
 * comes from the snapshot's `CraftSelection` goods; absent/empty reads as every product selected (the
 * sim's all-products default). `earned` narrows the toggles to this operator's unlocked products.
 */
function craftChoicesFor(
  ctx: UnitPanelModelContext,
  def: ReturnType<typeof buildingDef>,
  comps: Comp,
  earned: (goodType: number) => boolean,
): { choices: SettlerWorkModel['craftChoices']; selected: number[] } | null {
  if (def === undefined || def.recipes.length === 0) return null;
  const jobType = num((comps.Settler as { jobType?: unknown } | undefined)?.jobType);
  if (jobType === undefined) return null;
  const operatorSlots = def.workers.filter((slot) => !isCarrierJob(ctx, slot.jobType));
  const operators = operatorSlots.length > 0 ? operatorSlots : def.workers;
  if (!operators.some((slot) => slot.jobType === jobType)) return null;
  const choices = def.recipes.flatMap((recipe) => {
    const goodType = recipe.outputs[0]?.goodType;
    if (goodType === undefined || !earned(goodType)) return [];
    const good = goodDef(ctx, goodType);
    return [
      {
        goodType,
        label: goodLabel(ctx, goodType),
        ...(good?.id !== undefined ? { goodId: good.id } : {}),
      },
    ];
  });
  if (choices.length === 0) return null;
  const raw = (comps.CraftSelection as { goods?: unknown } | undefined)?.goods;
  const picked = Array.isArray(raw) ? raw.map(num).filter((g): g is number => g !== undefined) : [];
  const products = choices.map((c) => c.goodType);
  const selected = picked.length > 0 ? products.filter((g) => picked.includes(g)) : products;
  return { choices, selected: selected.length > 0 ? selected : products };
}
