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
 * wrapping when more operators work the type than it lists. The first seat's list is what a lone man
 * works, and the lists interleave so a partly staffed type already runs its main lines: the smithies'
 * eight seats are three long-sword and five plate-armour makers, one druid in four boils holy oil (the
 * first, since the big potion waits on herbs the later herb hut grows), one coiner in four strikes coins,
 * and the second joiner and potter take the furniture and the crockery.
 * At the animal farm the products are the two herds themselves, so a seat apiece keeps both species tended.
 */
export const CRAFT_RESTRICTIONS_BY_BUILDING_ID: Readonly<Record<string, readonly (readonly string[])[]>> = {
  work_joinery_01: [['tool_iron'], ['tool_iron', 'furniture']],
  work_pottery_01: [['brick', 'tile'], ['crockery']],
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
  work_druid_01: [['holy_oil'], ['potion_heal_big'], ['potion_heal_big'], ['potion_heal_big']],
  work_coin_mint: [['coin'], ['amulet_defense'], ['amulet_defense'], ['amulet_defense']],
};

/** Workplace types whose short crew works every listed line instead of the first seat's: there each line
 *  is a herd, and one left untended while the pool is short dies out (authored). */
const SHORT_CREW_WORKS_EVERY_LINE: ReadonlySet<string> = new Set(['work_animal_farm']);

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
    const lines = new Set(restriction.map((listed) => listed.join()));
    const union = crew.length < lines.size && SHORT_CREW_WORKS_EVERY_LINE.has(type.id);
    for (const [seat, e] of crew.entries()) {
      const listed = union ? restriction.flat() : (restriction[seat % restriction.length] ?? []);
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
