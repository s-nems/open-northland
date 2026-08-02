import { Building, CraftSelection, JobAssignment, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { goodTypeByContentId, ownedSettlers } from '../shared.js';

/** Product restrictions per workplace, by stable content ids (user plan 2026-07-25, extended
 *  2026-07-26: the joinery crafts iron tools only, and the level-2 pottery alternates brick and roof
 *  tile - the building materials the plan consumes; its crockery is of no interest to the seat). */
export const CRAFT_RESTRICTIONS_BY_BUILDING_ID: Readonly<Record<string, readonly string[]>> = {
  work_joinery_01: ['tool_iron'],
  work_pottery_01: ['brick', 'tile'],
};

/**
 * Craft tuning (claims no men): keep every operator of a restricted workplace on the plan's product
 * list. `CraftSelection` is per WORKER, not per building, and any employment change clears it
 * (`reidleAsJob`), so the check must run every decision - but the command is issued only when the
 * live selection differs (`goods` is stored ascending/deduped, so exact array equality is the
 * comparison). Restricted goods the workplace's recipes cannot make are dropped, and an empty
 * result issues nothing - `setCraftGoods []` would mean "every product", the opposite of a
 * restriction. A worker assigned THIS decision has no binding yet and is picked up next decision.
 */
export function tuneCraftSelections(world: World, ctx: SystemContext, player: number): Command[] {
  const commands: Command[] = [];
  const index = contentIndex(ctx.content);
  for (const e of ownedSettlers(world, player)) {
    const assignment = world.tryGet(e, JobAssignment);
    if (assignment === undefined) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
    const building = world.tryGet(assignment.workplace, Building);
    const type = building === undefined ? undefined : index.buildings.get(building.buildingType);
    if (type === undefined) continue;
    const restriction = CRAFT_RESTRICTIONS_BY_BUILDING_ID[type.id];
    if (restriction === undefined) continue;
    const produced = new Set(type.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
    const goods = restriction
      .map((id) => goodTypeByContentId(ctx.content, id)?.typeId)
      .filter((g): g is number => g !== undefined && produced.has(g))
      .sort((a, b) => a - b);
    if (goods.length === 0) continue;
    const current = world.tryGet(e, CraftSelection)?.goods ?? [];
    if (current.length === goods.length && current.every((g, i) => g === goods[i])) continue;
    commands.push({ kind: 'setCraftGoods', entity: e, goods });
  }
  return commands;
}
