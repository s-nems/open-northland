import { BUILDING_KIND } from '@open-northland/data';
import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** The stable content id of the start building a fortress-style map opens with — the seat's
 *  headquarters. Both the AI's per-seat HQ resolver and the combat siege-priority classifier
 *  ({@link buildingCombatClass}) key on it. Lives here (the building read views) because it is a
 *  building content fact, not an AI-only constant. */
export const HEADQUARTERS_BUILDING_ID = 'headquarters';

/** A building's siege-priority class: the {@link HEADQUARTERS_BUILDING_ID} headquarters and a
 *  {@link BUILDING_KIND.tower} defensive tower are the high-value structures a warrior auto-targets
 *  on par with an enemy unit; every other building is the low-priority `'other'` tier a warrior only
 *  turns on once no unit, HQ, or tower remains in sight. An unknown type (synthetic content) reads as
 *  `'other'`. */
export type BuildingCombatClass = 'hq' | 'tower' | 'other';

export function buildingCombatClass(ctx: SystemContext, buildingType: number): BuildingCombatClass {
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  if (type === undefined) return 'other';
  if (type.id === HEADQUARTERS_BUILDING_ID) return 'hq';
  if (type.kind === BUILDING_KIND.tower) return 'tower';
  return 'other';
}

/** Whether `t` is a low-priority (`'other'`) building — the autofocus fallback tier. A settler, an HQ,
 *  or a tower is NOT low-priority; the two-pass target search prefers those and drops to this tier only
 *  when none is in sight. A non-building entity is never low-priority. */
export function isLowPriorityBuildingTarget(world: World, ctx: SystemContext, t: Entity): boolean {
  const b = world.tryGet(t, Building);
  return b !== undefined && buildingCombatClass(ctx, b.buildingType) === 'other';
}

/**
 * Whether a building is a temple — the satisfier site for the piety need (where a settler runs the `pray`
 * atomic). The original's "work temple" (`logichousetype` `logictype 37`, the `HOUSE_TYPE_WORK_TEMPLE`
 * constant) is a `logicmaintype 3` workplace that, unlike a real production workplace, declares no
 * `logicworker`, no `logicstock`, no `logicproduction` — so it surfaces in the IR as `kind === 'workplace'`
 * with an empty `workers`, empty `stock`, and no `recipes`. That "workplace with nothing to make and no one to
 * staff it" shape is how a temple is told apart from a sawmill/mill.
 *
 * Approximated: the temple→pray need→satisfier link lives below the readable rule files (the original binds
 * the religious building to the pray slot at the engine level, not in `houses.ini`), so the satisfier is
 * inferred from this structural signature — like the food→eat-slot binding ({@link isFood}) is inferred from
 * the `food_` id prefix. Refine to a content flag if the building→need binding is later decoded. Cross-system:
 * the AI pray-drive planner uses it to find the nearest temple to walk to.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipes.length === 0 && type.workers.length === 0;
}
