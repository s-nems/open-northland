import { resolveJobAtomics } from '@open-northland/data';
import { entityById, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { goodUnlockedFor } from '../../../game/profession-unlocks.js';
import { num, settlerExperienceOf, settlerLearnedOf } from '../../../game/snapshot.js';
import { technologyLabel } from '../../../game/technology.js';
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
    /** The good's string id, the button's icon key; absent for the "Wszystko" choice, which has no
     *  single good. */
    readonly goodId?: string;
  }[];
  readonly selectedGood: number | null;
  /** A craft operator's product toggles, in recipe order, multi-selectable. Never non-empty together
   *  with `gatherChoices`. */
  readonly craftChoices: readonly {
    readonly goodType: number;
    readonly label: string;
    readonly goodId?: string;
  }[];
  /** The settler's `CraftSelection` goods, or every product when it has none. */
  readonly selectedCraftGoods: readonly number[];
}

/**
 * The Praca section: the settler's workplace and the good it makes. The no-workplace text is a pinned
 * fallback matching the original's `humanwindow` 41 wording, not a lookup into the decoded table.
 */
export function settlerWork(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  comps: Comp,
  progressionGated: boolean,
): SettlerWorkModel {
  const training = comps.TrainingOrder as
    | { drillTicksLeft?: number; lesson?: { kind: 'job' | 'good'; typeId: number } }
    | undefined;
  if (training?.lesson !== undefined) {
    return {
      place: messages().hud.schoolTitle,
      product: formatMessage(messages().hud.schoolProgress, {
        target: technologyLabel(ctx, training.lesson.kind, training.lesson.typeId),
        seconds: Math.ceil(Math.max(0, training.drillTicksLeft ?? 0) / TICKS_PER_SECOND),
      }),
      gatherChoices: [],
      selectedGood: null,
      craftChoices: [],
      selectedCraftGoods: [],
    };
  }
  const carry = comps.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
  const carried =
    carry === undefined
      ? undefined
      : `${goodLabel(ctx, num(carry.goodType) ?? -1)} ×${num(carry.amount) ?? 0}`;
  const settlerComp = comps.Settler as { tribe?: unknown; jobType?: unknown } | undefined;
  const jobType = num(settlerComp?.jobType);
  // The `needforgood` filter the sim's rotation and harvest gates apply, so both product menus offer
  // only what this settler may make or dig right now.
  const experience = settlerExperienceOf(comps);
  const owner = num((comps.Owner as { player?: unknown } | undefined)?.player);
  const earned = (goodType: number): boolean =>
    (ctx.goodAllowed?.(goodType, num(settlerComp?.tribe) ?? 0, owner) ?? true) &&
    (settlerLearnedOf(comps, 'good').includes(goodType) ||
      goodUnlockedFor(ctx, progressionGated, num(settlerComp?.tribe), experience, goodType));
  const workFlag = comps.WorkFlag as { goodType?: unknown } | undefined;
  if (workFlag !== undefined) {
    const selectedGood = num(workFlag.goodType) ?? null;
    const goods = harvestableGoodsFor(ctx, jobType).filter((good) => earned(good.typeId));
    return gatherWork(ctx, messages().hud.workFlag, goods, selectedGood);
  }
  const siteAssignment = comps.SiteAssignment as { site?: unknown; pinned?: unknown } | undefined;
  const pinnedSiteId = siteAssignment?.pinned === true ? num(siteAssignment.site) : undefined;
  const pinnedSite = pinnedSiteId === undefined ? undefined : entityById(snapshot, pinnedSiteId);
  const pinnedType = num(
    (pinnedSite?.components.Building as { buildingType?: unknown } | undefined)?.buildingType,
  );
  if (pinnedSite !== undefined && pinnedType !== undefined) {
    return {
      place: buildingTitle(ctx, pinnedType),
      product: carried ?? messages().hud.buildSite.assignedSite,
      gatherChoices: [],
      selectedGood: null,
      craftChoices: [],
      selectedCraftGoods: [],
    };
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
  // The sim's forage filter: a building-employed gatherer forages what its workplace stockpiles, a
  // good's edible form counting too, so a hunter's kill banks as food at an HQ that has no meat slot.
  // The gather menu wins over the craft menu, because such a job runs the sim's gather drive and never
  // the craft loop.
  const harvestable = harvestableGoodsFor(ctx, jobType);
  if (harvestable.length > 0) {
    const stored = new Set((def?.stock ?? []).map((slot) => slot.goodType));
    const isStocked = (goodType: number): boolean =>
      stored.has(goodType) || stored.has(ctx.edibleGoodForm?.(goodType) ?? goodType);
    const choices = harvestable.filter((good) => isStocked(good.typeId) && earned(good.typeId));
    if (choices.length > 0) {
      const selectedGood =
        num((comps.GatherSelection as { goodType?: unknown } | undefined)?.goodType) ?? null;
      return gatherWork(ctx, buildingTitle(ctx, rawType), choices, selectedGood);
    }
  }
  const craft = craftChoicesFor(
    ctx,
    def,
    comps,
    (good) => earned(good) && !ctx.technologyReason?.('good', good, num(settlerComp?.tribe) ?? 0, owner),
  );
  if (craft !== null) {
    const selectedLabels = craft.choices
      .filter((choice) => craft.selected.includes(choice.goodType))
      .map((choice) => choice.label);
    const allSelected = selectedLabels.length === craft.choices.length;
    // A long multi-selection is summarized as a count, because four joined labels overflow the column.
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
  const outputs = recipeOutputs(ctx, def);
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

type GoodEntry = UnitPanelModelContext['goods'][number];

/** The non-farmed goods `jobType` may harvest, in goods-catalog order. Shares `resolveJobAtomics` with
 *  the sim's permission gate, so the menu cannot offer what the planner would refuse. */
function harvestableGoodsFor(ctx: UnitPanelModelContext, jobType: number | undefined): GoodEntry[] {
  if (jobType === undefined) return [];
  const allowed = resolveJobAtomics(ctx.jobs).get(jobType);
  if (allowed === undefined) return [];
  return ctx.goods.filter(
    (good) =>
      good.farming === undefined && good.atomics.harvest !== undefined && allowed.has(good.atomics.harvest),
  );
}

/** A gatherer's Praca model: the "Wszystko" choice plus one per allowed good. */
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
 * The craft product toggles for a settler bound to a recipe workplace, or null when there is nothing to
 * choose. Operator slots follow the sim's `operatorJobsOf`: worker slots minus the carrier transport
 * slot, unless every slot is a carrier one, when the carrier does choose.
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
