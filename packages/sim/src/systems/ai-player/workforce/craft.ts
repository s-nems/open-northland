import type { BuildingType } from '@open-northland/data';
import {
  Building,
  CompletedCycles,
  CraftSelection,
  JobAssignment,
  Settler,
  UnderConstruction,
} from '../../../components/index.js';
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
 * the second joiner and potter take the furniture and the crockery, and the first tailor sews shoes while
 * the second sews leather armour. Bakers bake only bread and breeders keep only cattle.
 */
export const CRAFT_RESTRICTIONS_BY_BUILDING_ID: Readonly<Record<string, readonly (readonly string[])[]>> = {
  work_joinery_01: [['tool_iron'], ['tool_iron', 'furniture']],
  work_pottery_01: [['brick', 'tile'], ['crockery']],
  work_mason_hut_01: [['pillar', 'ornament']],
  work_animal_farm: [['cattle']],
  work_sewery_01: [['shoes'], ['armor_leather']],
  work_bakery_01: [['bread']],
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

/** The run a workshop opens with once built, by stable content ids (authored): its whole crew works only
 *  `good` until that building has finished `cycles` of it, then the seat lists apply. Tiles and marble come
 *  only from these tiers and the next bills wait on both. */
export const CRAFT_OPENING_RUN_BY_BUILDING_ID: Readonly<
  Record<string, { readonly good: string; readonly cycles: number }>
> = {
  work_pottery_01: { good: 'tile', cycles: 5 },
  work_mason_hut_01: { good: 'ornament', cycles: 5 },
};

interface RestrictedCrew {
  readonly type: BuildingType;
  readonly restriction: readonly (readonly string[])[];
  readonly crew: Entity[];
  /** Each crew member's workplace, index for index. */
  readonly workplaces: Entity[];
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
      seated.workplaces.push(assignment.workplace);
      continue;
    }
    const type = index.buildings.get(building.buildingType);
    if (type === undefined) continue;
    const restriction = CRAFT_RESTRICTIONS_BY_BUILDING_ID[type.id];
    if (restriction === undefined) continue;
    crews.set(building.buildingType, { type, restriction, crew: [e], workplaces: [assignment.workplace] });
  }
  for (const { type, restriction, crew, workplaces } of crews.values()) {
    const produced = new Set(type.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
    for (const [seat, e] of crew.entries()) {
      const workplace = workplaces[seat];
      const opening = workplace === undefined ? null : openingRun(world, ctx, workplace, type);
      const listed = opening !== null ? [opening] : (restriction[seat % restriction.length] ?? []);
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

/** Whether `workplace`'s opening run is still unfinished; false for a type without one. */
export function openingRunPending(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  type: BuildingType,
): boolean {
  const run = CRAFT_OPENING_RUN_BY_BUILDING_ID[type.id];
  const good = run === undefined ? undefined : goodTypeByContentId(ctx.content, run.good);
  if (run === undefined || good === undefined) return false;
  return (world.tryGet(workplace, CompletedCycles)?.byGood.get(good.typeId) ?? 0) < run.cycles;
}

/**
 * The good `workplace`'s opening run still wants, or null once the run is done or its type has none. The
 * first look opts the building into {@link CompletedCycles}, so its count starts with the crew's first
 * cycle.
 */
function openingRun(world: World, ctx: SystemContext, workplace: Entity, type: BuildingType): string | null {
  if (world.has(workplace, UnderConstruction) || !openingRunPending(world, ctx, workplace, type)) return null;
  if (!world.has(workplace, CompletedCycles)) world.add(workplace, CompletedCycles, { byGood: new Map() });
  return CRAFT_OPENING_RUN_BY_BUILDING_ID[type.id]?.good ?? null;
}
