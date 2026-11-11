import { resolveJobAtomics } from '@open-northland/data';
import { num, settlerLearnedOf } from '../../../game/snapshot/index.js';
import type { Comp, GoodDef, UnitPanelModelContext } from './context.js';
import { goodExperienceLock } from './settler-unlocks.js';

export const HIDDEN = Symbol('hidden');
/** A settler's gate on making or gathering one good: hidden while the mission forbids the good, else
 *  locked with the reason, else open. */
export type GoodGate = (goodType: number) => string | null | typeof HIDDEN;

/** {@link GoodGate} for the settler `comps` describes: a good learned at a school is open, any other
 *  waits on the tribe's `needforgood` experience. */
export function settlerGoodGate(
  ctx: UnitPanelModelContext,
  comps: Comp,
  progressionGated: boolean,
): GoodGate {
  const settler = comps.Settler as { tribe?: unknown } | undefined;
  const tribe = num(settler?.tribe) ?? 0;
  const owner = num((comps.Owner as { player?: unknown } | undefined)?.player);
  const learned = settlerLearnedOf(comps, 'good');
  return (goodType) => {
    if (!(ctx.goodAllowed?.(goodType, tribe, owner) ?? true)) return HIDDEN;
    if (learned.includes(goodType)) return null;
    return goodExperienceLock(ctx, comps, progressionGated, goodType);
  };
}

/** The non-farmed goods `jobType` may harvest, in goods-catalog order. Shares `resolveJobAtomics` with
 *  the sim's permission gate, so the list cannot offer what the planner would refuse. */
export function harvestableGoodsFor(
  ctx: Pick<UnitPanelModelContext, 'goods' | 'jobs'>,
  jobType: number | undefined,
): GoodDef[] {
  if (jobType === undefined) return [];
  const allowed = resolveJobAtomics(ctx.jobs).get(jobType);
  if (allowed === undefined) return [];
  return ctx.goods.filter(
    (good) =>
      good.farming === undefined && good.atomics.harvest !== undefined && allowed.has(good.atomics.harvest),
  );
}
