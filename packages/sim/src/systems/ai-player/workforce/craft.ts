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
import { FetchableStock } from '../../settlers/targets/index.js';
import { isCarrierJob } from '../../stores/index.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { ownedSettlers } from '../seat-roster.js';

/**
 * One operator seat's products, by stable content ids. A plain list is worked as is. A `glut` seat drops
 * each of its `goods` while the seat holds at least that many units of it fetchable (stores, workshop
 * shelves and heaps: the units nobody is taking), and takes it back once the stock has fallen
 * {@link CRAFT_GLUT_BAND_UNITS} under the glut; while every capped good is dropped it works `otherwise`,
 * or the whole list when there is none.
 */
export type CraftSeat =
  | readonly string[]
  | {
      readonly goods: readonly string[];
      readonly glut: Readonly<Record<string, number>>;
      readonly otherwise?: readonly string[];
    };

/** A workplace type's product plan, by stable content ids (authored). */
export interface CraftPlan {
  /** One seat per operator, counted across every building of the type the seat owns and handed out in
   *  canonical settler order, wrapping when more operators work the type than it lists. */
  readonly seats: readonly CraftSeat[];
  /** What the type's only operator works while it employs just one, instead of the first seat. */
  readonly alone?: readonly string[];
  /** The seats while the type employs at least `crew` operators, instead of `seats`. */
  readonly crowded?: { readonly crew: number; readonly seats: readonly CraftSeat[] };
  /** The seats from {@link LATE_CRAFT_FROM_TICK} on. */
  readonly late?: readonly CraftSeat[];
}

/** When a {@link CraftPlan}'s late lists take over (authored): an hour and a half of game time. */
export const LATE_CRAFT_FROM_TICK = 90 * 60 * TICKS_PER_SECOND;

/** How far under its glut a good's stock falls before a seat takes the good back (authored), so a stock
 *  hovering at the line does not flip the seat with every unit made or taken. */
export const CRAFT_GLUT_BAND_UNITS = 8;

/**
 * The product plans per workplace type (authored). The lists interleave so a partly staffed type already
 * runs its main lines. The smithies' eight seats open on plate armour and long swords, then add the iron
 * spear, whose wooden shaft the first armourer makes between his long bows, and mail; the last seat forges
 * the short swords only the strength amulet takes. One druid in eight boils holy oil (the first, since the
 * big potion waits on herbs the later herb hut grows). The first two mints' four coiners work one on coins
 * and three on defence amulets; once a fifth joins at the third mint, the crew splits two each over coins,
 * defence and strength amulets. The second joiner takes the furniture. The potters split bricks and tiles,
 * a lone one working both, and add the crockery only late. The first tailor sews shoes and the
 * second leather armour, turning to shoes while the armour piles up unworn, as it does once plate armour
 * has come in, and back once the amulet makers and recruits have drawn it down; the small tailor's one
 * man sews shoes too. The first armourer works long bows and wooden spears, dropping whichever has piled
 * up so the other, the spear the smithy's iron spear needs or the bow, gets his whole time. Bakers bake
 * only bread and breeders keep only cattle.
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
  work_sewery_01: {
    seats: [['shoes'], { goods: ['armor_leather'], glut: { armor_leather: 16 }, otherwise: ['shoes'] }],
  },
  work_bakery_01: { seats: [['bread']] },
  work_smithy_01: {
    seats: [
      ['armor_plate'],
      ['sword_long'],
      ['spear_iron'],
      ['armor_chain'],
      ['armor_plate'],
      ['sword_long'],
      ['armor_chain'],
      ['sword_shord'],
    ],
  },
  work_armory_01: {
    seats: [{ goods: ['bow_long', 'spear_wooden'], glut: { bow_long: 20, spear_wooden: 20 } }, ['bow_long']],
  },
  work_druid_01: {
    seats: [
      ['holy_oil'],
      ['potion_heal_big'],
      ['potion_heal_big'],
      ['potion_heal_big'],
      ['potion_heal_big'],
      ['potion_heal_big'],
      ['potion_heal_big'],
      ['potion_heal_big'],
    ],
  },
  work_coin_mint: {
    seats: [['coin'], ['amulet_defense'], ['amulet_defense'], ['amulet_defense']],
    crowded: {
      crew: 5,
      seats: [
        ['coin'],
        ['amulet_defense'],
        ['coin'],
        ['amulet_defense'],
        ['amulet_strength'],
        ['amulet_strength'],
      ],
    },
  },
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
  const stock = FetchableStock.of(world, ctx);
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
    const crowded = plan.crowded !== undefined && crew.length >= plan.crowded.crew ? plan.crowded : plan;
    const seats = (ctx.tick >= LATE_CRAFT_FROM_TICK ? plan.late : undefined) ?? crowded.seats;
    for (const [seat, e] of crew.entries()) {
      const workplace = workplaces[seat];
      const opening = workplace === undefined ? null : openingRun(world, ctx, workplace, type);
      const current = world.tryGet(e, CraftSelection)?.goods ?? [];
      const listed =
        opening !== null
          ? [opening]
          : crew.length === 1 && plan.alone !== undefined
            ? plan.alone
            : seatProducts(ctx, stock, player, current, seats[seat % seats.length] ?? []);
      const goods = [
        ...new Set(
          listed
            .map((id) => goodTypeByContentId(ctx.content, id)?.typeId)
            .filter((g): g is number => g !== undefined && produced.has(g)),
        ),
      ].sort((a, b) => a - b);
      if (goods.length === 0) continue;
      if (current.length === goods.length && current.every((g, i) => g === goods[i])) continue;
      commands.push({ kind: 'setCraftGoods', entity: e, goods });
    }
  }
  return commands;
}

/**
 * What a {@link CraftSeat} works right now. A capped good the worker has on his `current` selection is
 * dropped at its glut; one he does not have comes back only under the glut by the band, so the two lines
 * a stock crosses are the hysteresis and no state beyond the live selection is kept.
 */
function seatProducts(
  ctx: SystemContext,
  stock: FetchableStock,
  player: number,
  current: readonly number[],
  seat: CraftSeat,
): readonly string[] {
  if (!('goods' in seat)) return seat;
  const kept = seat.goods.filter((id) => {
    const glut = seat.glut[id];
    const good = glut === undefined ? undefined : goodTypeByContentId(ctx.content, id);
    if (glut === undefined || good === undefined) return true;
    const dropAt = current.includes(good.typeId) ? glut : glut - CRAFT_GLUT_BAND_UNITS;
    return !stock.exceeds(player, good.typeId, dropAt - 1);
  });
  if (kept.length > 0) return kept;
  return seat.otherwise ?? seat.goods;
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
