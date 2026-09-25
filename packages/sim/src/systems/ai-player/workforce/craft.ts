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
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isCarrierJob } from '../../stores/index.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { ownedSettlers } from '../seat-roster.js';

/** A workplace type's product plan, by stable content ids (authored). */
export interface CraftPlan {
  /** One list per operator seat, counted across every building of the type the seat owns and handed out in
   *  canonical settler order, wrapping when more operators work the type than it lists. */
  readonly seats: readonly (readonly string[])[];
  /** What the type's only operator works while it employs just one, instead of the first seat's list. */
  readonly alone?: readonly string[];
  /** The seat lists from {@link LATE_CRAFT_FROM_TICK} on. */
  readonly late?: readonly (readonly string[])[];
}

/** When a {@link CraftPlan}'s late lists take over (authored): an hour and a half of game time. */
export const LATE_CRAFT_FROM_TICK = 90 * 60 * TICKS_PER_SECOND;

/**
 * The product plans per workplace type (authored). The lists interleave so a partly staffed type already
 * runs its main lines: the smithies' eight seats are three long-sword and five plate-armour makers, one
 * druid in four boils holy oil (the first, since the big potion waits on herbs the later herb hut grows),
 * one coiner in four strikes coins, and the second joiner takes the furniture. The potters split bricks
 * and tiles, a lone one working both, and add the crockery only late. The first tailor sews shoes and the
 * second leather armour, and the small tailor's one man sews shoes too. Bakers bake only bread and
 * breeders keep only cattle.
 */
export const CRAFT_PLANS_BY_BUILDING_ID: Readonly<Record<string, CraftPlan>> = {
  work_joinery_01: { seats: [['tool_iron'], ['tool_iron', 'furniture']] },
  work_pottery_01: {
    seats: [['brick'], ['tile']],
    alone: ['brick', 'tile'],
    late: [
      ['brick', 'crockery'],
      ['tile', 'crockery'],
    ],
  },
  work_mason_hut_01: { seats: [['pillar', 'ornament']] },
  work_animal_farm: { seats: [['cattle']] },
  work_sewery_00: { seats: [['shoes']] },
  work_sewery_01: { seats: [['shoes'], ['armor_leather']] },
  work_bakery_01: { seats: [['bread']] },
  work_smithy_01: {
    seats: [
      ['sword_long'],
      ['armor_plate'],
      ['sword_long'],
      ['armor_plate'],
      ['armor_plate'],
      ['sword_long'],
      ['armor_plate'],
      ['armor_plate'],
    ],
  },
  work_armory_01: { seats: [['bow_long']] },
  work_druid_01: { seats: [['holy_oil'], ['potion_heal_big'], ['potion_heal_big'], ['potion_heal_big']] },
  work_coin_mint: { seats: [['coin'], ['amulet_defense'], ['amulet_defense'], ['amulet_defense']] },
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
  readonly plan: CraftPlan;
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
    const plan = CRAFT_PLANS_BY_BUILDING_ID[type.id];
    if (plan === undefined) continue;
    crews.set(building.buildingType, { type, plan, crew: [e], workplaces: [assignment.workplace] });
  }
  for (const { type, plan, crew, workplaces } of crews.values()) {
    const produced = new Set(type.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)));
    const seats = (ctx.tick >= LATE_CRAFT_FROM_TICK ? plan.late : undefined) ?? plan.seats;
    for (const [seat, e] of crew.entries()) {
      const workplace = workplaces[seat];
      const opening = workplace === undefined ? null : openingRun(world, ctx, workplace, type);
      const listed =
        opening !== null
          ? [opening]
          : crew.length === 1 && plan.alone !== undefined
            ? plan.alone
            : (seats[seat % seats.length] ?? []);
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
