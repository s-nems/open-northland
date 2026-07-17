import { Building } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

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
