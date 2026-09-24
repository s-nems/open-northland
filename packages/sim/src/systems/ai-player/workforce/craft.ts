import type { BuildingType } from '@open-northland/data';
import { Building, CraftSelection, JobAssignment, Settler } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { ownedSettlers } from '../seat-roster.js';

/**
 * Product restrictions per workplace type, by stable content ids (authored). One list per operator seat,
 * counted across every building of the type the seat owns and handed out in canonical settler order,
 * wrapping when more operators work the type than it lists. The lists interleave so a partly staffed
 * type already runs every line: the smithies' eight seats are three long-sword and five plate-armour
 * makers, one druid in four boils holy oil, one coiner in four strikes coins. At the animal farm the
 * products are the two herds themselves, so a seat apiece keeps both species tended.
 */
export const CRAFT_RESTRICTIONS_BY_BUILDING_ID: Readonly<Record<string, readonly (readonly string[])[]>> = {
  work_joinery_01: [['tool_iron']],
  work_pottery_01: [['brick', 'tile']],
  work_mason_hut_01: [['pillar', 'ornament']],
  work_animal_farm: [['cattle'], ['sheep']],
  work_smithy_01: [
    ['sword_long'],
    ['armor_plate'],
    ['sword_long'],
    ['armor_plate'],
    ['armor_plate'],
    ['sword_long'],
    ['armor_plate'],
    ['armor_plate'],
  ],
  work_armory_01: [['bow_long']],
  work_druid_01: [['potion_heal_big'], ['holy_oil'], ['potion_heal_big'], ['potion_heal_big']],
  work_coin_mint: [['coin'], ['amulet_defense'], ['amulet_defense'], ['amulet_defense']],
};

interface RestrictedCrew {
  readonly type: BuildingType;
  readonly restriction: readonly (readonly string[])[];
  readonly crew: Entity[];
}

/**
 * Keep every operator of a restricted workplace type on the plan's product list for its seat. `CraftSelection`
 * is per worker, not per building, and any employment change clears it (`reidleAsJob`), so the check runs
 * every decision and issues a command only when the live selection differs. An empty result issues
 * nothing, because `setCraftGoods []` would mean "every product", the opposite of a restriction.
 */
export function tuneCraftSelections(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const index = contentIndex(ctx.content);
  // Restricted workplace type -> its operators across the seat, gathered first because a seat's share
  // depends on how many men the whole type employs. Insertion follows the canonical settler walk, so the
  // seats and the emitted command order are both deterministic.
  const crews = new Map<number, RestrictedCrew>();
  for (const e of ownedSettlers(world, player)) {
    const assignment = world.tryGet(e, JobAssignment);
    if (assignment === undefined) continue;
    const job = world.get(e, Settler).jobType;
    if (job === null || isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
    const building = world.tryGet(assignment.workplace, Building);
    if (building === undefined) continue;
    const seated = crews.get(building.buildingType);
    if (seated !== undefined) {
      seated.crew.push(e);
      continue;
    }
    const type = index.buildings.get(building.buildingType);
    if (type === undefined) continue;
    const restriction = CRAFT_RESTRICTIONS_BY_BUILDING_ID[type.id];
    if (restriction === undefined) continue;
    crews.set(building.buildingType, { type, restriction, crew: [e] });
  }
  for (const { type, restriction, crew } of crews.values()) {
    const produced = new Set(type.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
    // An under-manned crew works the union instead of its seat's share: splitting two lines between
    // fewer men than lines would leave a line unworked for as long as the pool is short.
    const lines = new Set(restriction.map((listed) => listed.join()));
    const split = crew.length >= lines.size;
    for (const [seat, e] of crew.entries()) {
      const listed = split ? (restriction[seat % restriction.length] ?? []) : restriction.flat();
      const goods = [
        ...new Set(
          listed
            .map((id) => goodTypeByContentId(ctx.content, id)?.typeId)
            .filter((g): g is number => g !== undefined && produced.has(g)),
        ),
      ].sort((a, b) => a - b);
      if (goods.length === 0) continue;
      const current = world.tryGet(e, CraftSelection)?.goods ?? [];
      if (current.length === goods.length && current.every((g, i) => g === goods[i])) continue;
      commands.push({ kind: 'setCraftGoods', entity: e, goods });
    }
  }
  return commands;
}
