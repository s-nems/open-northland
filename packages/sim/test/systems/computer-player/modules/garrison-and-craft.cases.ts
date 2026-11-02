import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_RECRUIT_INTENTS,
  type AssistantCounterKind,
  AssistantRecruit,
  type AssistantRecruitIntent,
  aiControlEntity,
  Building,
  Carrying,
  CompletedCycles,
  type ComputerDifficulty,
  ComputerStrategy,
  type EconomicSide,
  Equipment,
  Garrison,
  Health,
  JobAssignment,
  type MilitaryPlan,
  type MilitaryRule,
  Owner,
  Position,
  ProductionCounters,
  Settler,
  setProfessionProgression,
  setSettlerJob,
  setStockAmount,
  TrainingOrder,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import { contentIndex } from '../../../../src/core/content-index.js';
import type { Entity, World } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { TOWER_POST_STRENGTH } from '../../../../src/systems/ai-shared/military/census.js';
import { ownedBuildings, ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { SpareForce } from '../../../../src/systems/ai-shared/workforce/pool.js';
import { COMPUTER_PUBLISHED_COUNTERS } from '../../../../src/systems/computer-player/assistant-counters.js';
import {
  AI_PROFILES,
  BUILDER_CAP,
  type ComputerProfile,
  shareOf,
} from '../../../../src/systems/computer-player/difficulty.js';
import {
  gamePhase,
  MID_GAME_FROM_TICKS,
  TRAINING_CARRIERS_FROM_TICKS,
} from '../../../../src/systems/computer-player/game-phase.js';
import {
  DEFAULT_BUILD_ORDER,
  LATE_GAME_CIVILIANS,
  SeatSupply,
  supplyLines,
} from '../../../../src/systems/computer-player/index.js';
import {
  believedDefendingPoints,
  strongestBelievedEnemy,
} from '../../../../src/systems/computer-player/military/enemy-strength.js';
import { armourFetchOrders } from '../../../../src/systems/computer-player/military/outfit.js';
import { COUNTED_ONCE, unitPoints } from '../../../../src/systems/computer-player/military/points.js';
import { PLAN_TUNING } from '../../../../src/systems/computer-player/strategy/military.js';
import {
  COIN_POTIONS_PER_DRUID,
  COINS_PER_BIG_POTION,
  CRAFT_GLUT_BAND_UNITS,
  CRAFT_OPENING_RUN_BY_BUILDING_ID,
  JOINERY_TOOL_GLUT_UNITS,
  SHOES_STOCK_UNITS,
  TEMPLE_SITE_OIL_UNITS,
  tuneCraftCounters,
  WOODEN_TOOL_GLUT_UNITS,
} from '../../../../src/systems/computer-player/workforce/craft.js';
import {
  ARMY_RESERVE_UNITS,
  OPERATOR_SHARE_UNITS,
} from '../../../../src/systems/computer-player/workforce/craft-stock.js';
import {
  ARMY_FLOOR_BUILDER_CORE,
  ARMY_FLOOR_LEAD_TICKS,
  ARMY_FLOOR_MIN,
  calledGatherers,
  claimArmyFloor,
  garrisonArms,
  trainGarrison,
  WEAPON_VETO_LIFT_STOCK,
  WEAPON_VETO_STOCK_MARGIN,
} from '../../../../src/systems/computer-player/workforce/garrison.js';
import { BUILDERS_PER_OPEN_SITE } from '../../../../src/systems/computer-player/workforce/staffing.js';
import {
  buildingStaffing,
  TRAINING_CARRIERS,
} from '../../../../src/systems/computer-player/workforce/staffing-plan.js';
import { mayMarry } from '../../../../src/systems/family/eligibility.js';
import { isFighterJob, type SystemContext } from '../../../../src/systems/index.js';
import { WEAPON_MAIN_TYPE } from '../../../../src/systems/readviews/index.js';
import { seatStockOf } from '../../../../src/systems/stores/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { stampPost } from '../../signposts/support.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  armedContent,
  BAKER,
  BARRACKS_TYPE,
  BOW,
  BOWMAN,
  BREEDER,
  BUILDER,
  CATTLE,
  CIVILIST,
  COLLECTOR,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  husbandryContent,
  IRON,
  JOINER,
  JOINERY_TYPE,
  keepCattle,
  MILL_TYPE,
  MILLER,
  makeAiSeat,
  placeHq,
  placeResources,
  SEAT,
  SPEAR,
  SPEARMAN,
  STONE,
  SWORD,
  SWORDSMAN,
  seatEconomy,
  spawnMen,
  TOOL_IRON,
  TOWER_TYPE,
  VIKING,
  WOMAN,
  WOOD,
} from '../support.js';

// The garrison sizing out of the true bachelor surplus, the weapon mix it publishes, and the
// per-seat craft restrictions.

/** Spare civilians an armed-seat case spawns by default - well past every post, reserve and
 *  collector tier. The army floor (no peace and no enemy: {@link ARMY_FLOOR_MIN}) claims men these
 *  cases count as spare anyway and publishes them in the same counters, so their totals hold. */
const SPARE_MEN = 40;

/** Each stocked weapon's units in a case that reads the draft's size: one for every man the seat could
 *  draft, since the draft takes no more men into a class than its weapons in store. */
const ARMOURY = 2 * SPARE_MEN;

interface ArmedSeat {
  readonly sim: Simulation;
  readonly ctx: SystemContext;
  /** Civilians spawned - the baseline {@link sparePool} subtracts the ladder's claims from. */
  readonly men: number;
}

interface SeatOptions {
  readonly men?: number;
  /** The content set; {@link armedContent} when absent. */
  readonly content?: ContentSet;
  /** Where the barracks stands, in nodes - the drill floor an arming reach is measured from. */
  readonly barracks?: { x: number; y: number };
  /** Turn signpost navigation on, so that reach confines anything at all. */
  readonly confined?: boolean;
  readonly difficulty?: ComputerDifficulty;
}

/** The barracks a few nodes off the HQ: one settlement, everything inside one walk range. */
const BARRACKS_AT = { x: 40, y: 16 };
/** A barracks 70 nodes from the HQ store, past a recruit's own walk range (50 nodes). */
const FAR_BARRACKS = { x: 100, y: 16 };
/** A post midway between the two, in TILE coords (`Position` is tile-space), inside the walk range
 *  of both doors - the network that makes the far store shoppable again. */
const BRIDGE_POST = { x: 32, y: 8 };

/** A seat with an HQ holding `arms`, a barracks, and `men` idle civilians, on content whose sword,
 *  spear and bow classes are equippable ({@link armedContent}). */
function armedSeat(arms: readonly { good: number; amount: number }[], options: SeatOptions = {}): ArmedSeat {
  const content = options.content ?? armedContent();
  const men = options.men ?? SPARE_MEN;
  const barracks = options.barracks ?? BARRACKS_AT;
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
  if (options.confined === true) sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: arms,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BARRACKS_TYPE,
    x: barracks.x,
    y: barracks.y,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, men);
  makeAiSeat(sim, SEAT, undefined, options.difficulty);
  sim.step();
  return { sim, ctx: { ...ctxOf(sim), content }, men };
}

/** A long sword that outranks the fixture's short one. */
const LONG_SWORD = 42;
const LONG_SWORDSMAN = 35;
const LONG_SWORD_DAMAGE = 3800;

/** {@link armedContent} with a long sword beside the short one, so the sword class has a weaker weapon. */
function longSwordContent(): ContentSet {
  const base = armedContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: LONG_SWORD, id: 'sword_long', weight: 1 }],
    jobs: [...base.jobs, { typeId: LONG_SWORDSMAN, id: 'soldier_sword_long' }],
    weapons: [
      ...base.weapons,
      {
        typeId: 8,
        id: 'viking_sword_long',
        tribeType: VIKING,
        jobType: LONG_SWORDSMAN,
        mainType: WEAPON_MAIN_TYPE.SWORD,
        goodType: LONG_SWORD,
        minRange: 1,
        maxRange: 1,
        damage: { '0': LONG_SWORD_DAMAGE },
      },
    ],
  });
}

/** The rung's standing order, by counter. A counter the decision leaves where it already sits issues
 *  no command, so an absent key means "still zero". */
function counterWants(sim: Simulation, ctx: SystemContext): Partial<Record<AssistantCounterKind, number>> {
  const wants: Partial<Record<AssistantCounterKind, number>> = {};
  for (const c of collectModule.run(sim.world, ctx, SEAT)) {
    if (c.kind === 'setAssistantCounter') wants[c.counter] = c.value;
  }
  return wants;
}

/** The men the ladder leaves over - the draft allowance, derived from the other side: the spawned
 *  civilians minus everyone a post, reserve or flag claimed this decision. */
function sparePool(seat: ArmedSeat): number {
  const claimed = new Set<Entity>();
  for (const c of collectModule.run(seat.sim.world, seat.ctx, SEAT)) {
    if (c.kind === 'setJob' || c.kind === 'assignWorker') claimed.add(c.entity);
  }
  return seat.men - claimed.size;
}

/** The free drill slots the standing order opens: what the dispatcher computes per counter - the
 *  published value less that counter's own unpaid bookings (`systems/assistant/`). A counter the
 *  decision leaves alone keeps its live value. */
function draftHeadroom(seat: ArmedSeat): number {
  const live = seat.sim.assistantCounters(SEAT);
  const wants = counterWants(seat.sim, seat.ctx);
  const booked = new Map<AssistantRecruitIntent, number>();
  for (const e of seat.sim.world.query(AssistantRecruit)) {
    const booking = seat.sim.world.get(e, AssistantRecruit);
    if (!booking.armed) booked.set(booking.intent, (booked.get(booking.intent) ?? 0) + 1);
  }
  return ASSISTANT_RECRUIT_INTENTS.reduce(
    (slots, intent) => slots + Math.max(0, (wants[intent] ?? live[intent].value) - (booked.get(intent) ?? 0)),
    0,
  );
}

/** The fixture's unarmed base soldier trade, and the bare-handed men a case spawns in it. */
const BARE_SOLDIER = 31;
const BARE_SOLDIERS = 3;
/** Enough for the seat's decision, the assistant's beats and a walk to the HQ store and back. */
const ARMING_TICKS = 3000;

function spawnBareSoldiers(seat: ArmedSeat, count: number): void {
  for (let i = 0; i < count; i++) {
    seat.sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: BARE_SOLDIER,
      x: 44 + 2 * i,
      y: 20,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  seat.sim.step();
}

/** The rival seat whose fighters the army floor matches. */
const RIVAL = 3;
/** Where the rival's fighters stand: the far end of the armed-seat map, away from the seat's settlement. */
const RIVAL_CAMP = { x: 100, y: 20 };
/** A rival stronger than the floor's minimum, so the match, not the minimum, sets the floor. */
const RIVAL_FIGHTERS = ARMY_FLOOR_MIN + 2;
/** Where the rival's tower stands: between the camps, clear of both settlements. */
const RIVAL_TOWER = { x: 80, y: 8 };
/** A crew whose posts, with no floor, leave fewer spare men than {@link RIVAL_FIGHTERS}. */
const FLOOR_CREW = 28;
/** Men beyond {@link FLOOR_CREW}, so a floor of {@link RIVAL_FIGHTERS} plus a man or two leaves some
 *  for the generic posts behind it and a case can tell the floor's size from the crew's. */
const FLOOR_SLACK = 3;

/** The generic gathering posts the ladder fills behind the floor. */
function genericPosts(seat: ArmedSeat): number {
  return [...collectModule.run(seat.sim.world, seat.ctx, SEAT)].filter(
    (c) => c.kind === 'setGatherGood' && c.goodType === null,
  ).length;
}

/** An armed seat with ground to gather on, `rivals` enemy spearmen, and its peace ending at `peaceUntil`.
 *  `setup` enqueues more before the one step that lands it all, so the seat's first decision is still the
 *  one a case reads. */
function rivalSeat(
  rivals: number,
  peaceUntil: number,
  options: SeatOptions & { readonly setup?: (sim: Simulation) => void } = {},
): ArmedSeat {
  const { setup, ...seatOptions } = options;
  const seat = armedSeat([{ good: SWORD, amount: ARMOURY }], { men: FLOOR_CREW, ...seatOptions });
  placeResources(seat.sim);
  for (let i = 0; i < rivals; i++) {
    seat.sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: RIVAL_CAMP.x + 2 * (i % 8),
      y: RIVAL_CAMP.y + 2 * Math.floor(i / 8),
      tribe: VIKING,
      owner: RIVAL,
    });
  }
  seat.sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: peaceUntil, players: [SEAT] });
  setup?.(seat.sim);
  seat.sim.step();
  // A roomy seat opens no digging posts, so the spare men read here go to the floor alone.
  seatEconomy(seat.sim, 'rich');
  const carrier = aiControlEntity(seat.sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no AI seat');
  // The floor read plain: a posture that holds the army home keeps more (`strategy/military.ts`).
  const military = seat.sim.world.tryGet(carrier, ComputerStrategy)?.military;
  if (military !== undefined) {
    seat.sim.world.mut(carrier, ComputerStrategy).military = {
      ...military,
      evidence: [...military.evidence],
      challenger: null,
      plan: 'balanced',
      posture: 'attack',
    };
  }
  return seat;
}

/** A peace so far off that no case's decision reaches the floor's lead. */
const DISTANT_PEACE = 1_000_000_000;

/** The men the standing order drafts, over every counter. */
function drafted(seat: ArmedSeat): number {
  return Object.values(counterWants(seat.sim, seat.ctx)).reduce((sum, value) => sum + value, 0);
}

/** A free fixture building slot for {@link smithyContent}'s sword smithy. */
const SMITHY_TYPE = 19;
/** Where the smithy stands: inside the settlement, clear of the HQ and the barracks. */
const SMITHY_AT = { x: 50, y: 16 };

/** {@link armedContent} with a crewless smithy forging short swords out of iron: a weapon shop. */
function smithyContent(): ContentSet {
  const base = armedContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: SMITHY_TYPE,
        id: 'work_smithy_01',
        kind: 'workplace' as const,
        workers: [],
        recipes: [
          { inputs: [{ goodType: IRON, amount: 1 }], outputs: [{ goodType: SWORD, amount: 1 }], ticks: 180 },
        ],
        construction: [{ goodType: WOOD, amount: 2 }],
        stock: [
          { goodType: IRON, capacity: 5, initial: 0 },
          { goodType: SWORD, capacity: 5, initial: 0 },
        ],
      },
    ],
  });
}

/** A {@link rivalSeat} on {@link smithyContent} with empty stores, its smithy standing finished. */
function unarmedSmithySeat(peaceUntil: number): ArmedSeat {
  const seat = rivalSeat(RIVAL_FIGHTERS, peaceUntil, { content: smithyContent() });
  setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), SWORD, 0);
  seat.sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: SMITHY_TYPE,
    x: SMITHY_AT.x,
    y: SMITHY_AT.y,
    tribe: VIKING,
    owner: SEAT,
  });
  seat.sim.step();
  return seat;
}

const FURNITURE = 13;
/** The fixture joinery's wooden tool. */
const TOOL_WOODEN = 6;
/** Wood enough for every joiner of the fixture, under any short line. */
const JOINERY_WOOD_UNITS = 40;

/** The AI content with the joinery's furniture line, so its joiners have a product to turn to. */
function furnitureContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: FURNITURE, id: 'furniture', weight: 1 }],
    buildings: base.buildings.map((b) =>
      b.typeId === JOINERY_TYPE
        ? {
            ...b,
            recipes: [
              ...b.recipes,
              {
                inputs: [{ goodType: WOOD, amount: 1 }],
                outputs: [{ goodType: FURNITURE, amount: 1 }],
                ticks: 180,
              },
            ],
          }
        : b,
    ),
  });
}

const COIN = 14;
const DEFENCE_AMULET = 15;
const STRENGTH_AMULET = 16;
const SHOES = 19;
const LEATHER_ARMOUR = 20;
const SWORD_SHORT = 22;
const BRICK = 26;
const TILE = 27;
const CROCKERY = 28;
/** The largest bill line of each building material in {@link potteryContent} (authored for the fixture). */
const MATERIAL_BILL_UNITS = 3;
/** The wood {@link potteryContent}'s recipes find in store: a cycle of each. */
const POTTERY_WOOD_UNITS = 10;
/** Free fixture slots for the tailors', breeders' and druids' goods and the temple. */
const TUNIC = 60;
const SHEEP_HERD = 61;
const CATTLE_HERD = 62;
const HOLY_OIL = 63;
const POTION_SMALL = 64;
const POTION_BIG = 65;
const TEMPLE_TYPE = 66;
/** Free fixture slots for the tailors' inputs and the upgraded joinery's handcart. */
const LEATHER = 67;
const WOOL = 68;
const HANDCART = 69;
/** Free fixture slots for the armourers' and smiths' goods. */
const BOW_SHORT = 70;
const BOW_LONG = 71;
const SPEAR_WOODEN = 72;
const ARMOUR_PLATE = 73;
const ARMOUR_CHAIN = 74;
const SWORD_LONG = 75;
const SPEAR_IRON = 76;

/** The fixture joinery recast as the mint: two operator seats, one recipe per coin or amulet. */
/** The fixture joinery recast as the workshop `id`, one wood recipe per product, so the type's own plan
 *  is what the two-seat crew works. */
function joineryRecastAs(id: string, products: readonly { typeId: number; id: string }[]): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, ...products.map((p) => ({ ...p, weight: 1 }))],
    buildings: base.buildings.map((b) =>
      b.typeId === JOINERY_TYPE
        ? {
            ...b,
            id,
            recipes: products.map((p) => ({
              inputs: [{ goodType: WOOD, amount: 1 }],
              outputs: [{ goodType: p.typeId, amount: 1 }],
              ticks: 180,
            })),
          }
        : b,
    ),
  });
}

/** The fixture joinery recast as the upgraded pottery, whose own bill takes bricks and tiles so both carry
 *  supply lines. */
function potteryContent(): ContentSet {
  const recast = joineryRecastAs('work_pottery_01', [
    { typeId: BRICK, id: 'brick' },
    { typeId: TILE, id: 'tile' },
    { typeId: CROCKERY, id: 'crockery' },
  ]);
  return parseContentSet({
    ...recast,
    buildings: recast.buildings.map((b) =>
      b.typeId === JOINERY_TYPE
        ? {
            ...b,
            construction: [
              { goodType: BRICK, amount: MATERIAL_BILL_UNITS },
              { goodType: TILE, amount: MATERIAL_BILL_UNITS },
            ],
          }
        : b,
    ),
  });
}

/** A druid hut type of {@link COIN_CONSUMER_OPERATORS} druids whose potion takes coins, the mint's coin
 *  consumer. */
const COIN_CONSUMER_TYPE = 97;
const COIN_CONSUMER_OPERATORS = 2;
const POTION_OF_COINS = 98;

/** The mint with its amulet inputs as plain goods, so the seat's stock of them can feed an amulet seat,
 *  and a druid hut drawing its coins. */
function mintContent(): ContentSet {
  const recast = joineryRecastAs('work_coin_mint', [
    { typeId: COIN, id: 'coin' },
    { typeId: DEFENCE_AMULET, id: 'amulet_defense' },
    { typeId: STRENGTH_AMULET, id: 'amulet_strength' },
  ]);
  return parseContentSet({
    ...recast,
    goods: [
      ...recast.goods,
      { typeId: LEATHER_ARMOUR, id: 'armor_leather', weight: 1 },
      { typeId: SWORD_SHORT, id: 'sword_shord', weight: 1 },
      { typeId: POTION_OF_COINS, id: 'potion_heal_big', weight: 1 },
    ],
    buildings: [
      ...recast.buildings,
      {
        typeId: COIN_CONSUMER_TYPE,
        id: 'work_druid_01',
        kind: 'workplace' as const,
        workers: [{ jobType: JOINER, count: COIN_CONSUMER_OPERATORS }],
        recipes: [
          {
            inputs: [{ goodType: COIN, amount: COINS_PER_BIG_POTION }],
            outputs: [{ goodType: POTION_OF_COINS, amount: 1 }],
            ticks: 180,
          },
        ],
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

/** Each operator's changed selection in `commands`: his goods, or `rest` when every product is stopped. */
function decisions(commands: readonly PlayerCommand[]): (readonly number[] | 'rest')[] {
  return commands.flatMap((c) => {
    if (c.kind !== 'setProductionGoods') return [];
    const stops = commands.some(
      (o) => o.kind === 'setProductionCount' && o.entity === c.entity && o.count === 0,
    );
    return [stops ? 'rest' : c.goods];
  });
}

/** One decision's craft selections, over the seat's supply at the time. */
function tune(world: World, ctx: SystemContext): PlayerCommand[] {
  const supply = SeatSupply.of(world, ctx, SEAT, ownedBuildings(world, SEAT), DEFAULT_BUILD_ORDER);
  return tuneCraftCounters(world, ctx, SEAT, supply, AI_PROFILES.hard);
}

/** A recast joinery at (40, 16) with `crew` builders hired as its joiners, lowest id first, and released
 *  to every product; the products each decision hands them, via {@link tune}, in that order. */
function crewedWorkshop(content: ContentSet, crew: number) {
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: JOINERY_TYPE,
    x: 40,
    y: 16,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, crew, BUILDER);
  sim.step();
  const workshop = entityOfBuilding(sim, JOINERY_TYPE);
  for (const man of [...sim.world.query(Settler)].sort((a, b) => a - b)) {
    if (sim.world.get(man, Settler).jobType !== BUILDER) continue;
    sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: workshop, jobPriority: [JOINER] });
    sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods: [] });
  }
  sim.step();
  const ctx = { ...ctxOf(sim), content };
  return {
    sim,
    /** Put `units` of the good into the headquarters, the seat's fetchable stock. */
    stock: (good: number, units: number) =>
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, units),
    /** The decision's product changes, applied. */
    products(): (readonly number[] | 'rest')[] {
      const commands = tune(sim.world, ctx);
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return decisions(commands);
    },
  };
}

describe('workforce module - the barracks and craft selections', () => {
  it('posts only porters to the barracks, from the late game, and never a fighter trade', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    // Men to spare past the builder reserve, so every carrier tier is reached.
    spawnMen(sim, LATE_GAME_CIVILIANS, BUILDER);
    sim.step();
    const barracks = entityOfBuilding(sim, BARRACKS_TYPE);
    const postedAt = (tick: number): number =>
      [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)].filter(
        (c) => c.kind === 'assignWorker' && c.building === barracks,
      ).length;

    // Before the late game the barracks runs no porter; from it, its target-tier pair.
    expect(postedAt(TRAINING_CARRIERS_FROM_TICKS - 1)).toBe(0);
    expect(postedAt(TRAINING_CARRIERS_FROM_TICKS)).toBe(TRAINING_CARRIERS.carrierTarget);
    // A soldier is made by the drill, never by `setJob`, and a seat that is not AI-flagged runs no
    // garrison hire at all.
    const commands = [...collectModule.run(sim.world, ctxOf(sim, TRAINING_CARRIERS_FROM_TICKS), SEAT)];
    expect(commands.filter((c) => c.kind === 'setJob' && isFighterJob(sim.content, c.jobType))).toEqual([]);
    expect(commands.filter((c) => c.kind === 'trainSoldier')).toEqual([]);
  });

  it('sizes the trainSoldiers counter to the free civilians left after the ladder', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40); // civilists, well past every post, reserve and collector tier
    makeAiSeat(sim, SEAT);
    sim.step();

    // The seat hand-picks no recruit (user rule): the rung publishes the leftover
    // free-civilian count as the standing `trainSoldiers` order and the assistant drafts from it.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => c.kind === 'trainSoldier')).toEqual([]);
    const claimed = new Set<Entity>();
    for (const c of commands) {
      if (c.kind === 'setJob' || c.kind === 'assignWorker') claimed.add(c.entity);
    }
    const counters = commands.flatMap((c) => (c.kind === 'setAssistantCounter' ? [c] : []));
    expect(counters).toEqual([
      {
        kind: 'setAssistantCounter',
        player: SEAT,
        counter: 'trainSoldiers',
        value: 40 - claimed.size,
        infinite: false,
      },
    ]);
    // Well past the old six-man garrison - no fixed size caps the army.
    expect(40 - claimed.size).toBeGreaterThan(6);
  });

  it('the assistant executes the standing order: civilians march to drill unpicked', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40);
    makeAiSeat(sim, SEAT);
    // The live loop: the seat publishes the counter, the assistant's beats pace the drafts - no
    // `trainSoldier` command from the AI anywhere in the log.
    sim.run(80);
    expect([...sim.world.query(TrainingOrder)].length).toBeGreaterThanOrEqual(2);
    expect(sim.commands.log.filter((c) => c.command.kind === 'trainSoldier')).toEqual([]);
    // Stable under in-flight drafts: each recruit left the free pool AND counts as booked, so the
    // wanted value is unchanged and the rung re-issues nothing.
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);

    const off = aiSim();
    placeHq(off);
    off.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(off, 40);
    makeAiSeat(off, SEAT, { military: false });
    off.step();
    expect(
      [...collectModule.run(off.world, ctxOf(off), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('caps the standing order at the bachelor surplus beyond the waiting brides', () => {
    const counterOf = (men: number, women: number): number => {
      const sim = aiSim();
      placeHq(sim);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: BARRACKS_TYPE,
        x: 40,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      spawnMen(sim, men);
      for (let i = 0; i < women; i++) {
        sim.enqueueSetup({
          kind: 'spawnSettler',
          jobType: WOMAN,
          x: 4 + 2 * i,
          y: 28,
          tribe: VIKING,
          owner: SEAT,
        });
      }
      makeAiSeat(sim, SEAT);
      sim.step();
      const counters = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].flatMap((c) =>
        c.kind === 'setAssistantCounter' ? [c] : [],
      );
      return counters[0]?.value ?? 0; // no command = the counter stays at its default zero
    };
    // A soldier neither marries nor fathers children, and the sons of housed couples are the army's
    // only future recruits - with a bride waiting for every bachelor, the order stays empty.
    expect(counterOf(20, 20)).toBe(0);
    // One bachelor beyond the brides: the settlement can spare exactly one man.
    expect(counterOf(21, 20)).toBe(1);
  });

  it('publishes no extra recruit for a booking whose drill was abandoned', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 40);
    makeAiSeat(sim, SEAT);
    sim.run(80); // the standing order is published and at least two drafts are in flight
    const drilling = [...sim.world.query(AssistantRecruit)].filter((e) => sim.world.has(e, TrainingOrder));
    const interrupted = drilling[0];
    expect(interrupted).toBeDefined();
    if (interrupted === undefined) return;
    // An abandoned drill (a wall, an override) drops the order while the booking survives until the
    // sweep: the man is back in the spare pool, so counting his booking too would publish one
    // recruit past the standing want. The rung must still see a settled state and re-issue nothing.
    sim.world.remove(interrupted, TrainingOrder);
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('splits the standing order between swordsmen and archers once both arms are in store', () => {
    const both = [
      { good: SWORD, amount: ARMOURY },
      { good: BOW, amount: ARMOURY },
    ];
    // The ladder's claims set the pool's parity, so of two crews one man apart, one splits evenly.
    const [even, odd] = [armedSeat(both), armedSeat(both, { men: SPARE_MEN - 1 })].sort(
      (a, b) => (sparePool(a) % 2) - (sparePool(b) % 2),
    );
    if (even === undefined || odd === undefined) throw new Error('setup: two seats');
    const evenTotal = sparePool(even);
    expect(evenTotal % 2).toBe(0);
    expect(counterWants(even.sim, even.ctx)).toEqual({
      trainSword: evenTotal / 2,
      trainBow: evenTotal / 2,
    });

    // An odd pool: the extra recruit fights in reach, never at range.
    const oddTotal = sparePool(odd);
    expect(oddTotal % 2).toBe(1);
    expect(counterWants(odd.sim, odd.ctx)).toEqual({
      trainSword: (oddTotal + 1) / 2,
      trainBow: (oddTotal - 1) / 2,
    });
  });

  it('drafts toward an even field army, leaving the tower archers out of the count', () => {
    const seat = armedSeat([
      { good: SWORD, amount: ARMOURY },
      { good: BOW, amount: ARMOURY },
    ]);
    const FIELD_ARCHERS = 4;
    for (let i = 0; i < FIELD_ARCHERS; i++) {
      seat.sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: BOWMAN,
        x: 50 + 2 * i,
        y: 24,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    seat.sim.step();
    const total = sparePool(seat);
    expect(total).toBeGreaterThan(FIELD_ARCHERS);
    // The swordsmen catch up with the archers first, then the rest splits.
    const rest = total - FIELD_ARCHERS;
    expect(counterWants(seat.sim, seat.ctx)).toEqual({
      trainSword: FIELD_ARCHERS + Math.ceil(rest / 2),
      trainBow: Math.floor(rest / 2),
    });

    // Walled into a tower, the same archers leave the field, so the draft splits evenly again.
    seat.sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
      x: 56,
      y: 8,
      tribe: VIKING,
      owner: SEAT,
    });
    seat.sim.step();
    const tower = entityOfBuilding(seat.sim, TOWER_TYPE);
    for (const archer of seat.sim.world.query(Settler)) {
      if (seat.sim.world.get(archer, Settler).jobType === BOWMAN) {
        seat.sim.world.add(archer, JobAssignment, { workplace: tower });
      }
    }
    expect(counterWants(seat.sim, seat.ctx)).toEqual({
      trainSword: Math.ceil(total / 2),
      trainBow: Math.floor(total / 2),
    });
  });

  it('drafts four archers to three swordsmen and three spearmen while every class can be armed', () => {
    const seat = armedSeat([
      { good: SWORD, amount: ARMOURY },
      { good: SPEAR, amount: ARMOURY },
      { good: BOW, amount: ARMOURY },
    ]);
    const total = sparePool(seat);
    const wants = counterWants(seat.sim, seat.ctx);
    expect((wants.trainBow ?? 0) + (wants.trainSword ?? 0) + (wants.trainSpear ?? 0)).toBe(total);
    // Each class within one man of its share of the field.
    expect(Math.abs((wants.trainBow ?? 0) - (total * 4) / 10)).toBeLessThan(1);
    expect(Math.abs((wants.trainSword ?? 0) - (total * 3) / 10)).toBeLessThan(1);
    expect(Math.abs((wants.trainSpear ?? 0) - (total * 3) / 10)).toBeLessThan(1);
  });

  it('splits evenly over the classes it can arm when one weapon line runs dry', () => {
    const seat = armedSeat([
      { good: SWORD, amount: ARMOURY },
      { good: SPEAR, amount: ARMOURY },
    ]);
    const total = sparePool(seat);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({
      trainSword: Math.ceil(total / 2),
      trainSpear: Math.floor(total / 2),
    });
  });

  it('counts its bare-handed soldiers into the class counters, on top of the draft', () => {
    const seat = armedSeat([{ good: SWORD, amount: ARMOURY }]);
    const total = sparePool(seat);
    spawnBareSoldiers(seat, BARE_SOLDIERS);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: total + BARE_SOLDIERS });
  });

  it('shares its bare-handed soldiers out over the classes it can arm', () => {
    const seat = armedSeat(
      [
        { good: SWORD, amount: ARMOURY },
        { good: BOW, amount: ARMOURY },
      ],
      { men: 0 },
    );
    spawnBareSoldiers(seat, 2 * BARE_SOLDIERS);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: BARE_SOLDIERS, trainBow: BARE_SOLDIERS });
  });

  it('has the assistant arm as many bare-handed soldiers as the store holds swords, with no equip order of its own', () => {
    const swords = BARE_SOLDIERS - 1;
    const seat = armedSeat([{ good: SWORD, amount: swords }], { men: 0 });
    spawnBareSoldiers(seat, BARE_SOLDIERS);
    const bare = ownedSettlers(seat.sim.world, SEAT).filter(
      (e) => seat.sim.world.get(e, Settler).jobType === BARE_SOLDIER,
    );
    expect(bare).toHaveLength(BARE_SOLDIERS);
    seat.sim.run(ARMING_TICKS);
    const armed = bare.filter((e) => seat.sim.world.get(e, Settler).jobType === SWORDSMAN);
    expect(armed).toHaveLength(swords);
    // The man no sword is left for stays in the field, unbooked, and ready for the campaign.
    const waiting = bare.filter((e) => !armed.includes(e));
    for (const e of waiting) expect(seat.sim.world.has(e, AssistantRecruit)).toBe(false);
    expect(seat.sim.commands.log.filter((c) => c.command.kind === 'equipGood')).toEqual([]);
  });

  it('vetoes a weaker weapon once the best one is stocked past its margin', () => {
    const seat = armedSeat(
      [
        { good: SWORD, amount: ARMOURY },
        { good: LONG_SWORD, amount: WEAPON_VETO_STOCK_MARGIN },
      ],
      { content: longSwordContent() },
    );
    const first = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    const vetoes = first.filter((c) => c.kind === 'setAssistantWeaponVeto');
    expect(vetoes).toEqual([{ kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD, vetoed: true }]);
    for (const veto of vetoes) seat.sim.enqueueSetup(veto);
    seat.sim.step();

    const again = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(again.some((c) => c.kind === 'setAssistantWeaponVeto')).toBe(false);
    // The vetoed short swords arm nobody, so only the long swords open the draft.
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: WEAPON_VETO_STOCK_MARGIN });
  });

  it('neither vetoes nor lifts while the best weapon lies between its two marks', () => {
    const between = WEAPON_VETO_STOCK_MARGIN - 1;
    expect(between).toBeGreaterThanOrEqual(WEAPON_VETO_LIFT_STOCK);
    const seat = armedSeat(
      [
        { good: SWORD, amount: ARMOURY },
        { good: LONG_SWORD, amount: between },
      ],
      { content: longSwordContent() },
    );
    const vetoes = (): readonly unknown[] =>
      collectModule.run(seat.sim.world, seat.ctx, SEAT).filter((c) => c.kind === 'setAssistantWeaponVeto');
    expect(vetoes()).toEqual([]);
    seat.sim.enqueueSetup({ kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD, vetoed: true });
    seat.sim.step();
    expect(vetoes()).toEqual([]);
  });

  it('vetoes no weaker weapon for best ones no recruit can fetch, such as those in a carrier hands', () => {
    const seat = armedSeat([{ good: SWORD, amount: ARMOURY }], { content: longSwordContent() });
    const [carrier] = ownedSettlers(seat.sim.world, SEAT);
    if (carrier === undefined) throw new Error('setup: no settler to carry');
    seat.sim.world.add(carrier, Carrying, { goodType: LONG_SWORD, amount: WEAPON_VETO_STOCK_MARGIN });
    // The seat stock counts the carried swords, which would have vetoed the short ones.
    expect(seatStockOf(seat.sim.world, SEAT).units(LONG_SWORD)).toBe(WEAPON_VETO_STOCK_MARGIN);

    const commands = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(commands.some((c) => c.kind === 'setAssistantWeaponVeto')).toBe(false);
  });

  it('calls off a waiting recruit of a class it cannot arm, and the assistant arms him for another', () => {
    const seat = armedSeat([{ good: SWORD, amount: ARMOURY }], { men: 0 });
    spawnBareSoldiers(seat, 1);
    const [man] = ownedSettlers(seat.sim.world, SEAT).filter(
      (e) => seat.sim.world.get(e, Settler).jobType === BARE_SOLDIER,
    );
    const barracks = ownedBuildings(seat.sim.world, SEAT).find(
      (b) => seat.sim.world.get(b, Building).buildingType === BARRACKS_TYPE,
    );
    if (man === undefined || barracks === undefined) throw new Error('setup: no bare soldier or barracks');
    // Booked for a bow the seat holds none of: before, his counter held him waiting for good.
    seat.sim.world.add(man, AssistantRecruit, { intent: 'trainBow', armed: false, barracks });
    expect(counterWants(seat.sim, seat.ctx).trainBow ?? 0).toBe(0);

    seat.sim.run(ARMING_TICKS);
    expect(seat.sim.world.get(man, Settler).jobType).toBe(SWORDSMAN);
  });

  it('arms with the weaker weapon while the best one is not in store, and lifts a standing veto', () => {
    // Owner ruling: the smith opens on the short sword and earns the long one later.
    const seat = armedSeat([{ good: SWORD, amount: ARMOURY }], { content: longSwordContent() });
    const first = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(first.some((c) => c.kind === 'setAssistantWeaponVeto')).toBe(false);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });

    seat.sim.enqueueSetup({ kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD, vetoed: true });
    seat.sim.step();
    const lifted = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(lifted.filter((c) => c.kind === 'setAssistantWeaponVeto')).toEqual([
      { kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD, vetoed: false },
    ]);
    // The same decision already drafts as if the veto were gone.
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });
  });

  it('arms with the weaker weapon on the easy difficulty instead of vetoing it', () => {
    const seat = armedSeat(
      [
        { good: SWORD, amount: ARMOURY },
        { good: LONG_SWORD, amount: ARMOURY },
      ],
      { content: longSwordContent(), difficulty: 'easy' },
    );
    const first = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(first.some((c) => c.kind === 'setAssistantWeaponVeto')).toBe(false);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });
  });

  it('lifts its weapon vetoes when the AI lets go of the seat or its military module', () => {
    const vetoedSeat = (): ArmedSeat => {
      const seat = armedSeat([{ good: LONG_SWORD, amount: WEAPON_VETO_STOCK_MARGIN }], {
        content: longSwordContent(),
      });
      for (const c of collectModule.run(seat.sim.world, seat.ctx, SEAT)) {
        if (c.kind === 'setAssistantWeaponVeto') seat.sim.enqueueSetup(c);
      }
      seat.sim.step();
      expect(seat.sim.assistantWeaponVetoes(SEAT)).toEqual([SWORD]);
      return seat;
    };
    const detached = vetoedSeat();
    detached.sim.enqueueSetup({ kind: 'setAiControl', player: SEAT, enabled: false });
    detached.sim.step();
    expect(detached.sim.assistantWeaponVetoes(SEAT)).toEqual([]);

    const disarmed = vetoedSeat();
    disarmed.sim.enqueueSetup({
      kind: 'setAiControl',
      player: SEAT,
      enabled: true,
      modules: { military: false, houseBuild: true },
    });
    disarmed.sim.step();
    expect(disarmed.sim.assistantWeaponVetoes(SEAT)).toEqual([]);
  });

  it('puts the whole order on the one class it can arm, never on fists', () => {
    const seat = armedSeat([{ good: BOW, amount: ARMOURY }]);
    // Swords unmade: a swordsman would stand around weaponless, so every recruit becomes an archer
    // (user rule - the fist is the last resort, not half the plan).
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainBow: sparePool(seat) });
  });

  it('falls back to fist-fighters only while the seat holds no arms at all', () => {
    const seat = armedSeat([]);
    const total = sparePool(seat);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: total });

    // The fallback follows the STORE, not the content: delivered swords flip the whole order.
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), SWORD, ARMOURY);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: total });
  });

  it('will not order a class whose weapons its recruits could never walk to', () => {
    // The store a long march from the drill floor, with no signpost network bridging the two: the
    // arming pass would never fetch these swords, and a `trainSword` order would fill the barracks
    // with men who stand around bare-handed forever - and, being booked, never march either.
    const seat = armedSeat([{ good: SWORD, amount: ARMOURY }], { confined: true, barracks: FAR_BARRACKS });
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: sparePool(seat) });

    // One post between the two puts the store back inside the drill floor's own network.
    stampPost(seat.sim, BRIDGE_POST.x, BRIDGE_POST.y, SEAT);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });
  });

  it('sends no armed man for armour his barracks network cannot reach', () => {
    const ARMOR_CHAIN = 62;
    const base = armedContent();
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: ARMOR_CHAIN, id: 'armor_chain', equip: { category: 'armor' } }],
      armor: [{ typeId: 3, id: 'armor_chain', mainType: 2, goodType: ARMOR_CHAIN, materialType: 3 }],
    });
    const seat = armedSeat([{ good: ARMOR_CHAIN, amount: ARMOURY }], {
      content,
      confined: true,
      barracks: FAR_BARRACKS,
      men: 0,
    });
    seat.sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SWORDSMAN,
      x: FAR_BARRACKS.x,
      y: FAR_BARRACKS.y + 4,
      tribe: VIKING,
      owner: SEAT,
    });
    seat.sim.step();
    const men = ownedSettlers(seat.sim.world, SEAT);
    for (const e of men) {
      seat.sim.world.mut(e, Equipment).weapon = { goodType: SWORD, degreeOfUse: fx.fromInt(0) };
    }
    expect(armourFetchOrders(seat.sim.world, seat.ctx, SEAT, men)).toEqual([]);

    stampPost(seat.sim, BRIDGE_POST.x, BRIDGE_POST.y, SEAT);
    expect(armourFetchOrders(seat.sim.world, seat.ctx, SEAT, men)).toHaveLength(men.length);
  });

  it('keeps each counter carrying its own recruits, so a new weapon drafts nobody extra', () => {
    // The regression a pooled total caused: the assistant reads headroom PER counter
    // (`counter - its own unpaid bookings`), so a shared total re-opened every booked slot the
    // moment the armable set changed, and the dispatcher filled it from married men.
    const seat = armedSeat([{ good: SWORD, amount: SPARE_MEN }]);
    seat.sim.run(200); // the sword order is published and a queue of recruits is in flight
    expect([...seat.sim.world.query(AssistantRecruit)].length).toBeGreaterThan(1);

    const before = draftHeadroom(seat);
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), BOW, SPARE_MEN);
    // Bows arriving changes which classes the seat drills, never how many men it may still take.
    expect(draftHeadroom(seat)).toBe(before);
  });

  it('books the class intents through the assistant, and re-publishes nothing while they work', () => {
    const seat = armedSeat([
      { good: SWORD, amount: 4 },
      { good: BOW, amount: 4 },
    ]);
    seat.sim.run(80); // the seat publishes its order, the assistant's beats pace the drafts

    // Every booking is a class intent - the seat drills nobody into the weaponless base class.
    const armed: readonly AssistantRecruitIntent[] = ['trainSword', 'trainBow'];
    const intents = [...seat.sim.world.query(AssistantRecruit)].map(
      (e) => seat.sim.world.get(e, AssistantRecruit).intent,
    );
    expect(intents.length).toBeGreaterThanOrEqual(2);
    expect(intents.filter((intent) => !armed.includes(intent))).toEqual([]);
    // Each draft moves one man from the allowance into its counter's bookings, so the published
    // values are unchanged and the rung re-issues nothing.
    expect(
      [...collectModule.run(seat.sim.world, seat.ctx, SEAT)].filter((c) => c.kind === 'setAssistantCounter'),
    ).toEqual([]);
  });

  it('publishes only counters the AI teardown knows how to withdraw', () => {
    // Drift guard: `setAiControl(false)` resets exactly the COMPUTER_PUBLISHED_COUNTERS kinds, so a counter
    // this rung reaches for outside that list would keep drafting after the seat's AI is detached.
    const withdrawable = new Set<string>(
      COMPUTER_PUBLISHED_COUNTERS.filter((entry) => entry.modules.includes('military')).flatMap(
        (entry) => entry.kinds,
      ),
    );
    const published = new Set<string>();
    for (const arms of [
      [],
      [{ good: SWORD, amount: 1 }],
      [{ good: SPEAR, amount: 1 }],
      [
        { good: SWORD, amount: 1 },
        { good: BOW, amount: 1 },
      ],
    ]) {
      const seat = armedSeat(arms);
      for (const kind of Object.keys(counterWants(seat.sim, seat.ctx))) published.add(kind);
    }
    expect([...published].filter((kind) => !withdrawable.has(kind))).toEqual([]);
    expect(published.size).toBe(4); // all four reached: the fallback and every armed class
  });

  it('keeps an army floor matching the strongest enemy once the peace lead is reached', () => {
    // With no floor the posts take most of the crew and leave fewer men than the rival fields.
    const peaceful = rivalSeat(RIVAL_FIGHTERS, DISTANT_PEACE);
    const spare = sparePool(peaceful);
    expect(drafted(peaceful)).toBe(spare);
    expect(spare).toBeLessThan(RIVAL_FIGHTERS);

    // The lead reached, the floor claims its men ahead of the generic posts: one recruit per enemy
    // fighter, and the generic posts get what the floor leaves of the slack.
    const slack = { men: FLOOR_CREW + FLOOR_SLACK };
    const armed = rivalSeat(RIVAL_FIGHTERS + 1, ARMY_FLOOR_LEAD_TICKS, slack);
    const outnumbered = rivalSeat(RIVAL_FIGHTERS + FLOOR_SLACK, ARMY_FLOOR_LEAD_TICKS, slack);
    expect(drafted(armed)).toBe(RIVAL_FIGHTERS + 1);
    expect(drafted(outnumbered)).toBe(RIVAL_FIGHTERS + FLOOR_SLACK);
    expect(genericPosts(armed)).toBe(genericPosts(outnumbered) + FLOOR_SLACK - 1);
  });

  it('claims the floor ahead of the surplus tier', () => {
    // A mill plans one miller at the target tier and a second in surplus. Short of the rival, the floor
    // takes the men the surplus miller would have had; with no floor to keep he is hired.
    const mill = {
      men: FLOOR_CREW + FLOOR_SLACK,
      setup: (sim: Simulation) =>
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: MILL_TYPE,
          x: SMITHY_AT.x,
          y: SMITHY_AT.y,
          tribe: VIKING,
          owner: SEAT,
        }),
    };
    const millers = (seat: ArmedSeat): number =>
      [...collectModule.run(seat.sim.world, seat.ctx, SEAT)].filter(
        (c) =>
          c.kind === 'assignWorker' &&
          c.building === entityOfBuilding(seat.sim, MILL_TYPE) &&
          c.jobPriority[0] === MILLER,
      ).length;
    expect(millers(rivalSeat(RIVAL_FIGHTERS + FLOOR_SLACK, DISTANT_PEACE, mill))).toBe(2);
    expect(millers(rivalSeat(RIVAL_FIGHTERS + FLOOR_SLACK, ARMY_FLOOR_LEAD_TICKS, mill))).toBe(1);
  });

  it("matches a rival's tower garrison one to one, whatever his post is worth to a wave marching on him", () => {
    // One rival archer holds a tower post: the world stands him on it without the walk-in.
    const seat = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS, {
      men: FLOOR_CREW + FLOOR_SLACK,
      setup: (sim) => {
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: TOWER_TYPE,
          x: RIVAL_TOWER.x,
          y: RIVAL_TOWER.y,
          tribe: VIKING,
          owner: RIVAL,
        });
        sim.enqueueSetup({
          kind: 'spawnSettler',
          jobType: BOWMAN,
          x: RIVAL_TOWER.x + 4,
          y: RIVAL_TOWER.y,
          tribe: VIKING,
          owner: RIVAL,
        });
      },
    });
    const { world } = seat.sim;
    const tower = [...world.query(Building, Owner)].find(
      (e) => world.get(e, Building).buildingType === TOWER_TYPE && world.get(e, Owner).player === RIVAL,
    );
    const archer = ownedSettlers(world, RIVAL).find((e) => world.get(e, Settler).jobType === BOWMAN);
    if (tower === undefined || archer === undefined) throw new Error('setup: the rival tower and archer');
    const post = world.get(tower, Position);
    world.add(archer, JobAssignment, { workplace: tower });
    world.add(archer, Garrison, { post: tower, returnTo: { x: post.x, y: post.y } });
    world.add(archer, Position, { x: post.x, y: post.y });
    // A wave marching on him meets the post's weight; the floor counts him as the one man he is.
    const countedOnce = believedDefendingPoints(world, seat.ctx, SEAT, RIVAL, 0, COUNTED_ONCE);
    expect(believedDefendingPoints(world, seat.ctx, SEAT, RIVAL, 0)).toBe(
      countedOnce + unitPoints(world, seat.ctx, archer) * (TOWER_POST_STRENGTH - COUNTED_ONCE),
    );
    expect(strongestBelievedEnemy(world, seat.ctx, SEAT).men).toBe(RIVAL_FIGHTERS + 1);
    expect(drafted(seat)).toBe(RIVAL_FIGHTERS + 1);
  });

  it("recounts the rival's fighters within the tick when one falls, changes sides or lays down arms", () => {
    const seat = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS);
    const { world } = seat.sim;
    const [fallen, turncoat, retired] = ownedSettlers(world, RIVAL);
    if (fallen === undefined || turncoat === undefined || retired === undefined) {
      throw new Error('setup: three rival spearmen');
    }
    expect(strongestBelievedEnemy(world, seat.ctx, SEAT).men).toBe(RIVAL_FIGHTERS);
    world.mut(fallen, Health).hitpoints = 0;
    expect(strongestBelievedEnemy(world, seat.ctx, SEAT).men).toBe(RIVAL_FIGHTERS - 1);
    world.mut(turncoat, Owner).player = SEAT;
    expect(strongestBelievedEnemy(world, seat.ctx, SEAT).men).toBe(RIVAL_FIGHTERS - 2);
    setSettlerJob(world, retired, null);
    expect(strongestBelievedEnemy(world, seat.ctx, SEAT).men).toBe(RIVAL_FIGHTERS - 3);
  });

  it("fills a standing workshop's target crew before the army floor claims its men", () => {
    // The joinery plans two joiners: the first a minimum post, the second a target-tier one. The floor is
    // short of the rival either way, and the second joiner still comes before its claim (authored: a
    // seat staffs what it built).
    const seat = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS, {
      setup: (sim) =>
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: JOINERY_TYPE,
          x: SMITHY_AT.x,
          y: SMITHY_AT.y,
          tribe: VIKING,
          owner: SEAT,
        }),
    });
    const joinery = entityOfBuilding(seat.sim, JOINERY_TYPE);
    const commands = [...collectModule.run(seat.sim.world, seat.ctx, SEAT)];
    const joiners = commands.filter(
      (c) => c.kind === 'assignWorker' && c.building === joinery && c.jobPriority[0] === JOINER,
    );
    expect(joiners).toHaveLength(2);
    // The spare men behind the joiners fall short of the rival; the floor makes up the rest out of the
    // builder reserve past its core.
    expect(drafted(seat)).toBe(RIVAL_FIGHTERS);
  });

  it('reclaims the builder reserve past its core for an army it can arm, and only for one', () => {
    // A small seat: every spare man is a builder the reserve holds, under its cap.
    const BUILDERS = 8;
    const core = shareOf(BUILDER_CAP, ARMY_FLOOR_BUILDER_CORE);
    const builderSeat = (arms: readonly { good: number; amount: number }[]): ArmedSeat => {
      const seat = armedSeat(arms, { men: 0 });
      spawnMen(seat.sim, BUILDERS, BUILDER);
      // The peace is over, so the army floor drafts.
      seat.sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: seat.sim.tick, players: [SEAT] });
      seat.sim.step();
      return seat;
    };
    const retrades = (seat: ArmedSeat): PlayerCommand[] =>
      collectModule.run(seat.sim.world, seat.ctx, SEAT).filter((c) => c.kind === 'setJob');

    const armed = builderSeat([{ good: SWORD, amount: BUILDERS }]);
    const jobs = retrades(armed).map((c) => (c.kind === 'setJob' ? c.jobType : null));
    // The scout's post comes first; the reserve holds the rest and gives up all past its core.
    const reserved = BUILDERS - jobs.filter((job) => job !== CIVILIST).length;
    expect(reserved).toBeGreaterThan(core);
    expect(jobs.filter((job) => job === CIVILIST)).toHaveLength(reserved - core);
    expect(counterWants(armed.sim, armed.ctx)).toEqual({ trainSword: reserved - core });

    // Fists alone never take a builder off his site.
    const unarmed = builderSeat([]);
    expect(retrades(unarmed).some((c) => c.kind === 'setJob' && c.jobType === CIVILIST)).toBe(false);
    expect(drafted(unarmed)).toBe(0);

    // Open sites keep the builders they call for, past the core.
    const SITES = 3;
    const building = builderSeat([{ good: SWORD, amount: BUILDERS }]);
    for (let i = 0; i < SITES; i++) {
      building.sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: JOINERY_TYPE,
        x: SMITHY_AT.x + 6 * i,
        y: SMITHY_AT.y,
        tribe: VIKING,
        owner: SEAT,
        underConstruction: true,
      });
    }
    building.sim.step();
    const siteJobs = retrades(building).map((c) => (c.kind === 'setJob' ? c.jobType : null));
    const siteReserved = BUILDERS - siteJobs.filter((job) => job !== CIVILIST).length;
    const siteNeed = SITES * BUILDERS_PER_OPEN_SITE;
    expect(siteNeed).toBeGreaterThan(core);
    expect(siteJobs.filter((job) => job === CIVILIST)).toHaveLength(siteReserved - siteNeed);
  });

  it('calls the gatherers of a comfortable good to arms only against a forecast attack, keeping the last', () => {
    // Owner ruling: on mroczny_las every man held a post before the first scripted wave.
    const seat = armedSeat(
      [
        { good: SWORD, amount: 4 },
        { good: WOOD, amount: 400 },
      ],
      { men: 0 },
    );
    const { world } = seat.sim;
    // A forecast attack lies inside the army floor's lead, as the posture's forecast lead always does.
    seat.sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: ARMY_FLOOR_LEAD_TICKS, players: [SEAT] });
    spawnMen(seat.sim, 4, COLLECTOR);
    seat.sim.step();
    const [practised, green, stoneman, apprentice] = ownedSettlers(world, SEAT).filter(
      (e) => world.get(e, Settler).jobType === COLLECTOR,
    );
    if (practised === undefined || green === undefined || stoneman === undefined || apprentice === undefined)
      throw new Error('setup: four gatherers');
    const supply = SeatSupply.of(world, seat.ctx, SEAT, ownedBuildings(world, SEAT), DEFAULT_BUILD_ORDER);
    const posts = new Map([
      [WOOD, [practised, apprentice, green]],
      [STONE, [stoneman]],
    ]);
    const called = (apprentices: ReadonlySet<Entity> = new Set()) =>
      calledGatherers(world, seat.ctx, SEAT, posts, supply, apprentices);
    const prepare = (evidence: MilitaryRule[]): void => {
      const carrier = aiControlEntity(world, SEAT);
      const military = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy)?.military;
      if (carrier === null || military === undefined) throw new Error('setup: no strategy');
      world.mut(carrier, ComputerStrategy).military = {
        ...military,
        challenger: null,
        posture: 'prepare',
        evidence,
      };
    };

    prepare(['buildingUp']);
    expect(called()).toEqual([]);
    prepare(['forecastThreat']);
    // The least practised first; wood's most practised gatherer stays, and stone, short, keeps its man.
    expect(called()).toEqual([green, apprentice]);
    // An apprentice is never called, and as he stays on the wood the most practised man may go.
    expect(called(new Set([apprentice]))).toEqual([green, practised]);

    // The floor turns a called gatherer into a civilian for the drill.
    const arms = garrisonArms(world, seat.ctx, SEAT, AI_PROFILES.hard);
    const claimGreen = () =>
      claimArmyFloor(world, seat.ctx, SEAT, new SpareForce([]), arms, AI_PROFILES.hard, {
        men: [],
        builderJob: null,
        gatherers: [green],
      });
    const claim = claimGreen();
    expect(claim.men).toEqual([green]);
    expect(claim.commands).toEqual([{ kind: 'setJob', entity: green, jobType: CIVILIST }]);
    // Mid-trip he waits: the retrade would drop his load.
    world.add(green, Carrying, { goodType: WOOD, amount: 1 });
    expect(claimGreen()).toEqual({ men: [], commands: [] });
  });

  it("keeps an iron-arms seat's iron gatherers off the call to arms, its iron stock being shelves", () => {
    const seat = armedSeat(
      [
        { good: SWORD, amount: 4 },
        { good: IRON, amount: 400 },
      ],
      { men: 0 },
    );
    const { world } = seat.sim;
    seat.sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: ARMY_FLOOR_LEAD_TICKS, players: [SEAT] });
    spawnMen(seat.sim, 2, COLLECTOR);
    seat.sim.step();
    const [practised, green] = ownedSettlers(world, SEAT).filter(
      (e) => world.get(e, Settler).jobType === COLLECTOR,
    );
    if (practised === undefined || green === undefined) throw new Error('setup: two gatherers');
    const posts = new Map([[IRON, [practised, green]]]);
    const calledOn = (sides: EconomicSide[]): readonly Entity[] => {
      seatEconomy(seat.sim, 'rich', sides);
      const carrier = aiControlEntity(world, SEAT);
      const military = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy)?.military;
      if (carrier === null || military === undefined) throw new Error('setup: no strategy');
      world.mut(carrier, ComputerStrategy).military = {
        ...military,
        challenger: null,
        posture: 'prepare',
        evidence: ['forecastThreat'],
      };
      const supply = SeatSupply.of(world, seat.ctx, SEAT, ownedBuildings(world, SEAT), DEFAULT_BUILD_ORDER);
      return calledGatherers(world, seat.ctx, SEAT, posts, supply, new Set());
    };
    // Elsewhere both go, the least practised first.
    expect(calledOn([])).toEqual([green, practised]);
    expect(calledOn(['ironArms'])).toEqual([]);
  });

  it("drafts its spare men only to its plan's share of the army cap", () => {
    const ARMY_CAP = 20;
    const capped: ComputerProfile = {
      ...AI_PROFILES.hard,
      army: { ...AI_PROFILES.hard.army, cap: ARMY_CAP, draftToCap: true },
    };
    const draftedUnder = (plan: MilitaryPlan): number => {
      const seat = armedSeat([{ good: SWORD, amount: SPARE_MEN }]);
      const { world } = seat.sim;
      const carrier = aiControlEntity(world, SEAT);
      const military = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy)?.military;
      if (carrier === null || military === undefined) throw new Error('setup: no strategy');
      world.mut(carrier, ComputerStrategy).military = {
        ...military,
        evidence: [...military.evidence],
        challenger: null,
        plan,
      };
      const spare = ownedSettlers(world, SEAT).filter((e) => world.get(e, Settler).jobType === CIVILIST);
      expect(spare.length).toBeGreaterThan(ARMY_CAP);
      const arms = garrisonArms(world, seat.ctx, SEAT, capped);
      return trainGarrison(world, seat.ctx, SEAT, new SpareForce(spare), [], arms, capped).reduce(
        (sum, c) => sum + (c.kind === 'setAssistantCounter' ? c.value : 0),
        0,
      );
    };
    for (const plan of ['defensive', 'balanced', 'aggressive'] as const)
      expect(draftedUnder(plan)).toBe(shareOf(ARMY_CAP, PLAN_TUNING[plan].draftCapShare));
  });

  it('drafts nothing for the army floor while the peace is further off than its lead', () => {
    const early = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS + 1);
    const peaceful = rivalSeat(RIVAL_FIGHTERS, DISTANT_PEACE);
    expect(counterWants(early.sim, early.ctx)).toEqual(counterWants(peaceful.sim, peaceful.ctx));
  });

  it('never drafts the army floor past the bachelor surplus', () => {
    const BACHELORS = 3;
    // A crew big enough that the brides, not the posts, bound the draft.
    const seat = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS, { men: SPARE_MEN });
    const world = seat.sim.world;
    const marriageable = (): Entity[] =>
      ownedSettlers(world, SEAT).filter((e) => mayMarry(world, seat.ctx.content, e));
    // A bride for every marriageable man but a few bachelors.
    for (let i = 0; i < marriageable().length - BACHELORS; i++) {
      seat.sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: WOMAN,
        x: 4 + 2 * i,
        y: 28,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    seat.sim.step();
    // Read after the step, which may send one more man on a mission (the seat's scout).
    const brides = marriageable().filter((e) => world.get(e, Settler).jobType === WOMAN).length;
    const surplus = marriageable().length - 2 * brides;
    expect(surplus).toBeGreaterThan(0);
    expect(surplus).toBeLessThan(RIVAL_FIGHTERS);
    expect(drafted(seat)).toBe(surplus);
  });

  it('still publishes every spare man past the army floor', () => {
    // A rival weaker than the floor's minimum: the minimum stands, and the spare men join it.
    const seat = rivalSeat(ARMY_FLOOR_MIN - 1, ARMY_FLOOR_LEAD_TICKS, { men: SPARE_MEN });
    expect(drafted(seat)).toBe(sparePool(seat));
    expect(drafted(seat)).toBeGreaterThan(ARMY_FLOOR_MIN);
  });

  it('drafts no unarmed soldier and claims no floor men once a weapon shop stands', () => {
    const atLead = unarmedSmithySeat(ARMY_FLOOR_LEAD_TICKS);
    // Only the existing bookings stand: none, so no counter asks for anybody.
    expect(counterWants(atLead.sim, atLead.ctx).trainSoldiers).toBeUndefined();
    expect(drafted(atLead)).toBe(0);
    // The floor claimed nobody: the posts and top-ups leave exactly the men they leave without a floor.
    expect(sparePool(atLead)).toBe(sparePool(unarmedSmithySeat(DISTANT_PEACE)));
  });

  it('still drafts fist-fighters for the army floor while no weapon shop stands', () => {
    const seat = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS);
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), SWORD, 0);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: RIVAL_FIGHTERS });
  });

  it('keeps a joinery operator on iron tools only, idempotently', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: JOINERY_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 2, BUILDER);
    sim.step();

    // The min pass assigns the joiner; its craft selection only exists once the binding stands.
    const first = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(first.filter((c) => c.kind === 'setProductionGoods')).toEqual([]);
    for (const c of first) sim.enqueueSetup(c);
    sim.step();

    const second = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const tuned = second.filter((c) => c.kind === 'setProductionGoods');
    const joiner = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, JOINERY_TYPE),
    );
    expect(tuned).toEqual([{ kind: 'setProductionGoods', entity: joiner, goods: [TOOL_IRON] }]);

    // Applied once, the selection matches - the next decision issues nothing.
    for (const c of second) sim.enqueueSetup(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setProductionGoods'),
    ).toEqual([]);
  });

  it('shares a plan between smithy tiers per tier, so the lower smith is never handed plate', () => {
    const base = aiContent();
    const SMITH = 81;
    const PLATE = 82;
    const LONG = 83;
    const LOWER = 84;
    const UPPER = 85;
    const smithy = (typeId: number, id: string, goods: readonly number[]) => ({
      typeId,
      id,
      kind: 'workplace' as const,
      workers: [{ jobType: SMITH, count: 1 }],
      recipes: goods.map((good) => ({ inputs: [], outputs: [{ goodType: good, amount: 1 }] })),
      stock: goods.map((good) => ({ goodType: good, capacity: 10 })),
      construction: [{ goodType: WOOD, amount: 1 }],
    });
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: PLATE, id: 'armor_plate' }, { typeId: LONG, id: 'sword_long' }],
      jobs: [...base.jobs, { typeId: SMITH, id: 'smith' }],
      buildings: [
        ...base.buildings,
        smithy(LOWER, 'work_smithy_00', [LONG]),
        smithy(UPPER, 'work_smithy_01', [PLATE, LONG]),
      ],
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const [buildingType, x] of [
      [LOWER, 40],
      [UPPER, 60],
    ] as const)
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y: 16, tribe: VIKING, owner: SEAT });
    spawnMen(sim, 2, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    const men = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
      .sort((a, b) => a - b);
    for (const [i, buildingType] of [LOWER, UPPER].entries()) {
      const man = men[i];
      if (man === undefined) throw new Error('setup: two men');
      sim.enqueueSetup({
        kind: 'assignWorker',
        entity: man,
        building: entityOfBuilding(sim, buildingType),
        jobPriority: [SMITH],
      });
      sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods: [] });
    }
    sim.step();
    expect(tune(sim.world, ctx)).toEqual([
      { kind: 'setProductionGoods', entity: men[0], goods: [LONG] },
      { kind: 'setProductionGoods', entity: men[1], goods: [PLATE] },
    ]);
  });

  it('hands a smith whose plate armour the seat has yet to earn the long sword', () => {
    const base = aiContent();
    const SMITH = 81;
    const PLATE = 82;
    const SWORD_LONG = 83;
    const SMITHY = 84;
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: PLATE, id: 'armor_plate' }, { typeId: SWORD_LONG, id: 'sword_long' }],
      jobs: [...base.jobs, { typeId: SMITH, id: 'smith' }],
      buildings: [
        ...base.buildings,
        {
          typeId: SMITHY,
          id: 'work_smithy_01',
          kind: 'workplace',
          workers: [{ jobType: SMITH, count: 1 }],
          recipes: [
            { inputs: [], outputs: [{ goodType: PLATE, amount: 1 }] },
            { inputs: [], outputs: [{ goodType: SWORD_LONG, amount: 1 }] },
          ],
          stock: [
            { goodType: PLATE, capacity: 10 },
            { goodType: SWORD_LONG, capacity: 10 },
          ],
          construction: [{ goodType: WOOD, amount: 1 }],
        },
      ],
      // The plate opens with a trade nobody of the seat holds, so the seat may not make it yet.
      tribes: base.tribes.map((t) =>
        t.typeId !== VIKING
          ? t
          : { ...t, jobEnables: [...t.jobEnables, { jobType: MILLER, kind: 'good', targetId: PLATE }] },
      ),
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: SMITHY,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 2, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    for (const c of collectModule.run(sim.world, ctx, SEAT)) sim.enqueueSetup(c);
    sim.step();

    const smith = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, SMITHY),
    );
    const tuned = collectModule.run(sim.world, ctx, SEAT).filter((c) => c.kind === 'setProductionGoods');
    expect(tuned).toEqual([{ kind: 'setProductionGoods', entity: smith, goods: [SWORD_LONG] }]);
  });

  it('keeps both joiners on iron tools to their stock line and rests them there, never on furniture', () => {
    const seat = crewedWorkshop(furnitureContent(), 2);
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
    seat.stock(TOOL_IRON, JOINERY_TOOL_GLUT_UNITS - 1);
    expect(seat.products()).toEqual([]);
    seat.stock(TOOL_IRON, JOINERY_TOOL_GLUT_UNITS);
    expect(seat.products()).toEqual(['rest', 'rest']);
    expect(seat.products()).toEqual([]);
    // The tools come back only under the band, so the stock hovering at the line flips nothing.
    seat.stock(TOOL_IRON, JOINERY_TOOL_GLUT_UNITS - CRAFT_GLUT_BAND_UNITS);
    expect(seat.products()).toEqual([]);
    seat.stock(TOOL_IRON, JOINERY_TOOL_GLUT_UNITS - CRAFT_GLUT_BAND_UNITS - 1);
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
  });

  it('turns joiners with no iron to wooden tools up to their line, and back once iron comes', () => {
    const seat = crewedWorkshop(furnitureContent(), 2);
    seat.stock(WOOD, JOINERY_WOOD_UNITS);
    expect(seat.products()).toEqual([[TOOL_WOODEN], [TOOL_WOODEN]]);
    seat.stock(IRON, JOINERY_WOOD_UNITS);
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
    // At the line they wait on the iron instead of burning the wood.
    seat.stock(IRON, 0);
    seat.stock(TOOL_WOODEN, WOODEN_TOOL_GLUT_UNITS);
    expect(seat.products()).toEqual([]);
    // An apprentice works on past the line: resting would earn him no repeats.
    const { sim } = seat;
    const ctx = { ...ctxOf(sim), content: sim.content };
    const crew = [...sim.world.query(Settler, JobAssignment)];
    const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
    const tuned = tuneCraftCounters(sim.world, ctx, SEAT, supply, AI_PROFILES.hard, new Set(crew));
    expect(decisions(tuned)).toEqual([[TOOL_WOODEN], [TOOL_WOODEN]]);
  });

  it('makes wooden tools only until the iron tool is earned', () => {
    const seat = crewedWorkshop(withUnearned(aiContent(), [TOOL_IRON]), 1);
    expect(seat.products()).toEqual([[TOOL_WOODEN]]);
  });

  it('opens an upgraded mason hut on a marble run, then alternates stone blocks and marble', () => {
    const base = aiContent();
    const MASON = 9;
    const PILLAR = 8;
    const ORNAMENT = 9;
    const HUT = 18;
    const UPGRADED_HUT = 19;
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: PILLAR, id: 'pillar' }, { typeId: ORNAMENT, id: 'ornament' }],
      jobs: [...base.jobs, { typeId: MASON, id: 'mason' }],
      buildings: [
        ...base.buildings,
        {
          typeId: HUT,
          id: 'work_mason_hut_00',
          kind: 'workplace',
          workers: [{ jobType: MASON, count: 1 }],
          produces: [PILLAR],
          recipes: [{ inputs: [], outputs: [{ goodType: PILLAR, amount: 1 }] }],
          stock: [{ goodType: PILLAR, capacity: 10 }],
          construction: [{ goodType: 1, amount: 1 }],
          upgradeTarget: UPGRADED_HUT,
        },
        {
          typeId: UPGRADED_HUT,
          id: 'work_mason_hut_01',
          kind: 'workplace',
          workers: [{ jobType: MASON, count: 1 }],
          produces: [PILLAR, ORNAMENT],
          recipes: [
            { inputs: [], outputs: [{ goodType: PILLAR, amount: 1 }] },
            { inputs: [], outputs: [{ goodType: ORNAMENT, amount: 1 }] },
          ],
          stock: [
            { goodType: PILLAR, capacity: 10 },
            { goodType: ORNAMENT, capacity: 10 },
          ],
          construction: [{ goodType: 1, amount: 1 }],
        },
      ],
    });
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    spawnMen(sim, 1, MASON);
    sim.step();
    completeSites(sim);
    const hut = entityOfBuilding(sim, HUT);
    const mason = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === MASON);
    if (mason === undefined) throw new Error('expected a mason');
    sim.world.add(mason, JobAssignment, { workplace: hut });
    expect(tune(sim.world, ctx)).toEqual([]);

    sim.enqueueSetup({ kind: 'upgradeBuilding', building: hut });
    sim.step();
    completeSites(sim);
    expect(sim.world.get(hut, Building).buildingType).toBe(UPGRADED_HUT);
    expect(sim.world.get(mason, ProductionCounters).counters).toEqual([[ORNAMENT, 0]]);

    // The upgraded hut opens on a marble run, counted on the hut itself.
    const run = { kind: 'setProductionGoods', entity: mason, goods: [ORNAMENT] } as const;
    expect(tune(sim.world, ctx)).toEqual([run]);
    sim.enqueueSetup(run);
    sim.step();
    const cycles = CRAFT_OPENING_RUN_BY_BUILDING_ID.work_mason_hut_01?.cycles ?? 0;
    sim.world.mut(hut, CompletedCycles).byGood.set(ORNAMENT, cycles - 1);
    expect(tune(sim.world, ctx)).toEqual([]);

    // With the run done, the mason alternates stone blocks and marble.
    sim.world.mut(hut, CompletedCycles).byGood.set(ORNAMENT, cycles);
    const choice = { kind: 'setProductionGoods', entity: mason, goods: [PILLAR, ORNAMENT] } as const;
    expect(tune(sim.world, ctx)).toEqual([choice]);
    sim.enqueueSetup(choice);
    sim.step();
    expect(sim.world.get(mason, ProductionCounters).counters).toEqual([]);
    expect(tune(sim.world, ctx)).toEqual([]);
  });

  it('keeps both breeders of the animal farm on the cattle', () => {
    const content = husbandryContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: ANIMAL_FARM_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 3, BUILDER);
    keepCattle(sim);
    sim.step();
    const ctx = { ...ctxOf(sim), content };

    // Both breeders are MINIMUM-tier posts.
    const hires = [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker');
    const farm = entityOfBuilding(sim, ANIMAL_FARM_TYPE);
    expect(hires.filter((c) => c.building === farm && c.jobPriority.includes(BREEDER))).toHaveLength(2);
    for (const c of hires) sim.enqueueSetup(c);
    sim.step();

    const breeders = [...sim.world.query(Settler, JobAssignment)]
      .filter((e) => sim.world.get(e, JobAssignment).workplace === farm)
      .filter((e) => sim.world.get(e, Settler).jobType === BREEDER)
      .sort((a, b) => a - b);
    expect(breeders).toHaveLength(2);
    // Released to every product, as a player may leave them.
    for (const e of breeders) sim.enqueueSetup({ kind: 'setProductionGoods', entity: e, goods: [] });
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setProductionGoods'),
    ).toEqual([
      { kind: 'setProductionGoods', entity: breeders[0], goods: [CATTLE] },
      { kind: 'setProductionGoods', entity: breeders[1], goods: [CATTLE] },
    ]);
  });

  /** `workshops` recast joineries of two operator seats each at 20-node steps, with `crew` builders hired
   *  two a workshop, lowest id first, by `hire` and released to every product; the products each decision
   *  at `tick` hands them. */
  function crewedWorkshops(content: ContentSet, workshops: number, crew: number, tick = 0) {
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(192, 32) });
    placeHq(sim);
    for (let i = 0; i < workshops; i++) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: JOINERY_TYPE,
        x: 40 + 20 * i,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, crew, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim, tick), content };
    const buildings = [...sim.world.query(Building)]
      .filter((e) => sim.world.get(e, Building).buildingType === JOINERY_TYPE)
      .sort((a, b) => a - b);
    const men = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
      .sort((a, b) => a - b);
    return {
      sim,
      buildings,
      /** Put `units` of the good into the headquarters, the seat's fetchable stock. */
      stock: (good: number, units: number) =>
        setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, units),
      hire(from: number, to: number): void {
        for (let i = from; i < to; i++) {
          const man = men[i];
          const building = buildings[Math.floor(i / 2)];
          if (man === undefined || building === undefined) throw new Error('setup: too few men or workshops');
          sim.enqueueSetup({ kind: 'assignWorker', entity: man, building, jobPriority: [JOINER] });
          sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods: [] });
        }
        sim.step();
      },
      /** The decision's product changes, applied. */
      products(): (readonly number[] | 'rest')[] {
        const commands = tune(sim.world, ctx);
        for (const c of commands) sim.enqueueSetup(c);
        sim.step();
        return decisions(commands);
      },
    };
  }

  /** Three mints of two coiners' seats each with `crew` builders to hire. */
  function crewedMints(crew: number) {
    const mints = crewedWorkshops(mintContent(), 3, crew);
    return {
      ...mints,
      stockCoins: (units: number) => mints.stock(COIN, units),
      /** Raise a standing druid hut whose potion takes the mint's coins. */
      raiseCoinConsumer(): void {
        mints.sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: COIN_CONSUMER_TYPE,
          x: 160,
          y: 16,
          tribe: VIKING,
          owner: SEAT,
        });
        mints.sim.step();
      },
    };
  }

  it('keeps coins for the druids, two big potions each, and strikes amulets with the rest', () => {
    const mints = crewedMints(6);
    mints.hire(0, 6);
    // No druid hut: no coin is wanted, and every seat strikes amulets, both lines while neither input is in.
    const amulets = [DEFENCE_AMULET, STRENGTH_AMULET];
    expect(mints.products()).toEqual([amulets, amulets, amulets, amulets, amulets, amulets]);
    // The druids' coins lack two coiners' shares: two coiners strike them, then one past the first share.
    mints.raiseCoinConsumer();
    expect(mints.products()).toEqual([[COIN], [COIN]]);
    const target = COIN_CONSUMER_OPERATORS * COIN_POTIONS_PER_DRUID * COINS_PER_BIG_POTION;
    mints.stockCoins(target - OPERATOR_SHARE_UNITS);
    expect(mints.products()).toEqual([amulets]);
    mints.stockCoins(target - 1);
    expect(mints.products()).toEqual([]);
    mints.stockCoins(target);
    expect(mints.products()).toEqual([amulets]);
    // Taken up again only under the band.
    mints.stockCoins(target - 1);
    expect(mints.products()).toEqual([]);
    mints.stockCoins(0);
    expect(mints.products()).toEqual([[COIN], [COIN]]);
  });

  it('strikes coins to earn the amulets while they are unearned', () => {
    const mints = crewedWorkshops(withUnearned(mintContent(), [DEFENCE_AMULET, STRENGTH_AMULET]), 1, 2);
    mints.hire(0, 2);
    expect(mints.products()).toEqual([[COIN], [COIN]]);
  });

  it('alternates strength-first and defence-first amulet seats, each falling back to the other line while its own input is out', () => {
    const mints = crewedMints(6);
    mints.stock(LEATHER_ARMOUR, 1);
    mints.stock(SWORD_SHORT, 1);
    mints.hire(0, 6);
    // Both inputs in store: the six amulet seats split three strength, three defence.
    const strength = [STRENGTH_AMULET];
    const defence = [DEFENCE_AMULET];
    expect(mints.products()).toEqual([strength, defence, strength, defence, strength, defence]);
    // No short sword: the strength-first seats turn to defence amulets.
    mints.stock(SWORD_SHORT, 0);
    expect(mints.products()).toEqual([defence, defence, defence]);
    // No leather armour: every seat strikes strength amulets.
    mints.stock(LEATHER_ARMOUR, 0);
    mints.stock(SWORD_SHORT, 1);
    expect(mints.products()).toEqual([strength, strength, strength, strength, strength, strength]);
    // Neither in store: every seat works both lines.
    mints.stock(SWORD_SHORT, 0);
    const amulets = [DEFENCE_AMULET, STRENGTH_AMULET];
    expect(mints.products()).toEqual([amulets, amulets, amulets, amulets, amulets, amulets]);
  });

  /** The wood's supply lines at `tick`. */
  function woodLines(content: ContentSet, tick: number) {
    const wood = supplyLines(content, DEFAULT_BUILD_ORDER, gamePhase(tick)).get(WOOD);
    if (wood === undefined) throw new Error('setup: wood takes lines');
    return wood;
  }

  /** One pottery past its opening run with both potters hired, deciding at `tick`; the bricks' lines then. */
  function crewedPottery(tick: number) {
    const content = potteryContent();
    const pottery = crewedWorkshops(content, 1, 2, tick);
    const [building] = pottery.buildings;
    const run = CRAFT_OPENING_RUN_BY_BUILDING_ID.work_pottery_01?.cycles ?? 0;
    if (building === undefined) throw new Error('setup: no pottery');
    pottery.sim.world.add(building, CompletedCycles, { byGood: new Map([[TILE, run]]) });
    pottery.hire(0, 2);
    const bricks = supplyLines(content, DEFAULT_BUILD_ORDER, gamePhase(tick)).get(BRICK);
    const tiles = supplyLines(content, DEFAULT_BUILD_ORDER, gamePhase(tick)).get(TILE);
    if (bricks === undefined || tiles === undefined) throw new Error('setup: bricks and tiles take lines');
    // Tiles sit at their comfort line: short in no phase, and under the glut the crockery sink waits for.
    pottery.stock(TILE, tiles.comfort);
    // Every recipe's wood in store, so no product's input decides a seat.
    pottery.stock(WOOD, POTTERY_WOOD_UNITS);
    return { ...pottery, bricks };
  }

  it('turns the crockery seat to bricks under the comfort line from the mid game, and holds it to the glut', () => {
    const pottery = crewedPottery(MID_GAME_FROM_TICKS);
    const { short, comfort, glut } = pottery.bricks;
    pottery.stock(BRICK, comfort - 1);
    expect(comfort - 1).toBeGreaterThanOrEqual(short);
    expect(pottery.products()).toEqual([[BRICK, TILE], [BRICK]]);
    pottery.stock(BRICK, glut - 1);
    expect(pottery.products()).toEqual([]);
    pottery.stock(BRICK, glut);
    expect(pottery.products()).toEqual([[CROCKERY]]);
  });

  it('keeps the crockery seat on crockery in the opening until the bricks fall under the short line', () => {
    const pottery = crewedPottery(0);
    const { short, comfort } = pottery.bricks;
    pottery.stock(BRICK, comfort - 1);
    expect(comfort - 1).toBeGreaterThanOrEqual(short);
    expect(pottery.products()).toEqual([[BRICK, TILE], [CROCKERY]]);
    pottery.stock(BRICK, short - 1);
    expect(pottery.products()).toEqual([[BRICK]]);
    pottery.stock(BRICK, comfort - 1);
    expect(pottery.products()).toEqual([]);
    pottery.stock(BRICK, comfort);
    expect(pottery.products()).toEqual([[CROCKERY]]);
  });

  it('releases the crew of a workshop without a plan to every product', () => {
    const seat = crewedWorkshop(
      joineryRecastAs('work_brewery', [
        { typeId: SHOES, id: 'shoes' },
        { typeId: LEATHER_ARMOUR, id: 'armor_leather' },
      ]),
      1,
    );
    expect(seat.products()).toEqual([]);
    const [smith] = [...seat.sim.world.query(Settler, JobAssignment)].filter(
      (e) => seat.sim.world.get(e, Settler).jobType === JOINER,
    );
    if (smith === undefined) throw new Error('setup: one smith');
    seat.sim.enqueueSetup({ kind: 'setProductionGoods', entity: smith, goods: [SHOES] });
    seat.sim.step();
    expect(seat.products()).toEqual([[]]);
    expect(seat.sim.world.has(smith, ProductionCounters)).toBe(false);
  });

  it('hands the seats out across every building of the type, not per building', () => {
    // One tailor in each of two sewing huts: counted per building each would be a lone man on the first
    // want, the leather armour the army lacks, counted across the type they are the pair the wants split.
    const content = joineryRecastAs('work_sewery_01', [
      { typeId: SHOES, id: 'shoes' },
      { typeId: LEATHER_ARMOUR, id: 'armor_leather' },
    ]);
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    placeHq(sim);
    for (const x of [40, 60]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: JOINERY_TYPE,
        x,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, 2, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    const workshops = [...sim.world.query(Building)]
      .filter((e) => sim.world.get(e, Building).buildingType === JOINERY_TYPE)
      .sort((a, b) => a - b);
    const men = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
      .sort((a, b) => a - b);
    for (const [i, building] of workshops.entries()) {
      const man = men[i];
      if (man === undefined) throw new Error('setup: too few men');
      sim.enqueueSetup({ kind: 'assignWorker', entity: man, building, jobPriority: [JOINER] });
      sim.enqueueSetup({ kind: 'setProductionGoods', entity: man, goods: [] });
    }
    sim.step();

    const tailors = [...sim.world.query(Settler, JobAssignment)]
      .filter((e) => sim.world.get(e, Settler).jobType === JOINER)
      .sort((a, b) => a - b);
    expect(tailors).toHaveLength(2);
    expect(tune(sim.world, ctx)).toEqual([
      { kind: 'setProductionGoods', entity: tailors[0], goods: [LEATHER_ARMOUR] },
      { kind: 'setProductionGoods', entity: tailors[1], goods: [SHOES] },
    ]);
  });

  it('sews tunics and shoes, never leather armour, on a seat arming without iron', () => {
    const tailors = crewedWorkshops(tailorContent(), 1, 2);
    tailors.stock(LEATHER, 10);
    tailors.stock(WOOL, 10);
    tailors.hire(0, 2);
    // Plate is out of reach of this content: the iron seat's army takes leather armour and tunics.
    expect(tailors.products()).toEqual([[LEATHER_ARMOUR], [TUNIC]]);
    seatEconomy(tailors.sim, 'standard', ['naturalArms']);
    expect(tailors.products()).toEqual([[SHOES]]);
    // Past the army's tunics and the shoes both sew for stock, the army's tunics first, never leather armour.
    tailors.stock(TUNIC, ARMY_RESERVE_UNITS);
    tailors.stock(SHOES, SHOES_STOCK_UNITS);
    expect(tailors.products()).toEqual([[TUNIC], [SHOES]]);
    // Without leather or wool nothing can be sewn: both rest.
    tailors.stock(LEATHER, 0);
    tailors.stock(WOOL, 0);
    expect(tailors.products()).toEqual(['rest', 'rest']);
  });

  it('keeps one breeder on sheep for the wool on a seat arming without iron', () => {
    const breeders = crewedWorkshops(
      joineryRecastAs('work_animal_farm', [
        { typeId: SHEEP_HERD, id: 'sheep' },
        { typeId: CATTLE_HERD, id: 'cattle' },
      ]),
      1,
      2,
    );
    breeders.hire(0, 2);
    expect(breeders.products()).toEqual([[CATTLE_HERD], [CATTLE_HERD]]);
    seatEconomy(breeders.sim, 'standard', ['naturalArms']);
    expect(breeders.products()).toEqual([[SHEEP_HERD]]);
  });

  /** The fixture joinery recast as the upper tailor: shoes and leather armour from leather, tunics from
   *  wool, at the real recipes' amounts. */
  function tailorContent(): ContentSet {
    const recast = joineryRecastAs('work_sewery_01', [
      { typeId: SHOES, id: 'shoes' },
      { typeId: LEATHER_ARMOUR, id: 'armor_leather' },
      { typeId: TUNIC, id: 'armor_wool' },
    ]);
    const inputs: Readonly<Record<number, { goodType: number; amount: number }>> = {
      [SHOES]: { goodType: LEATHER, amount: 1 },
      [LEATHER_ARMOUR]: { goodType: LEATHER, amount: 2 },
      [TUNIC]: { goodType: WOOL, amount: 2 },
    };
    return parseContentSet({
      ...recast,
      goods: [
        ...recast.goods,
        { typeId: LEATHER, id: 'leather', weight: 1 },
        { typeId: WOOL, id: 'wool', weight: 1 },
      ],
      buildings: recast.buildings.map((b) =>
        b.typeId !== JOINERY_TYPE
          ? b
          : {
              ...b,
              recipes: b.recipes.map((r) => {
                const input = inputs[r.outputs[0]?.goodType ?? -1];
                return input === undefined ? r : { ...r, inputs: [input] };
              }),
            },
      ),
    });
  }

  it('sews leather armour on an iron seat only until plate is earned or for the amulets, and shoes past them', () => {
    const base = tailorContent();
    const content = parseContentSet({
      ...base,
      goods: [...base.goods, { typeId: ARMOUR_PLATE, id: 'armor_plate', weight: 1 }],
    });
    const tailors = crewedWorkshops(content, 1, 2);
    tailors.stock(LEATHER, 10);
    tailors.stock(WOOL, 10);
    tailors.hire(0, 2);
    // Plate earned: no armour for the army, the shoes alone; past them both tailors keep sewing shoes, since
    // no mint wants leather armour.
    expect(tailors.products()).toEqual([[SHOES], [SHOES]]);
    tailors.stock(SHOES, SHOES_STOCK_UNITS);
    expect(tailors.products()).toEqual([]);
  });

  it("hands a tunic seat's tunic tailor the shoes while the wool is out, holding a half-fed tunic", () => {
    const tailors = crewedWorkshops(tailorContent(), 1, 2);
    tailors.hire(0, 2);
    seatEconomy(tailors.sim, 'standard', ['naturalArms']);
    tailors.stock(LEATHER, 10);
    expect(tailors.products()).toEqual([[SHOES], [SHOES]]);
    tailors.stock(WOOL, 2);
    expect(tailors.products()).toEqual([[TUNIC]]);
    // One unit short of a cycle keeps the man on tunics; none turns him back to shoes.
    tailors.stock(WOOL, 1);
    expect(tailors.products()).toEqual([]);
    tailors.stock(WOOL, 0);
    expect(tailors.products()).toEqual([[SHOES]]);
  });

  it('keeps the upgraded joinery on iron tools while the seat has yet to earn the handcart', () => {
    const base = aiContent();
    const content = withUnearned(
      parseContentSet({
        ...base,
        goods: [...base.goods, { typeId: HANDCART, id: 'handcart', weight: 1 }],
        buildings: base.buildings.map((b) =>
          b.typeId !== JOINERY_TYPE
            ? b
            : {
                ...b,
                id: 'work_joinery_02',
                recipes: [
                  ...b.recipes,
                  { inputs: [], outputs: [{ goodType: HANDCART, amount: 1 }], ticks: 180 },
                ],
              },
        ),
      }),
      [HANDCART],
    );
    const joiners = crewedWorkshops(content, 1, 1);
    joiners.hire(0, 1);
    expect(joiners.products()).toEqual([[TOOL_IRON]]);
  });

  /** `content` with the goods `unearned` lists gated behind a trade nobody of the seat holds, and with
   *  `building`, a crewless type the seat can raise. */
  function withUnearned(
    content: ContentSet,
    unearned: readonly number[],
    building?: { readonly typeId: number; readonly id: string },
  ): ContentSet {
    const extra = building === undefined ? [] : [building];
    return parseContentSet({
      ...content,
      buildings: [
        ...content.buildings,
        ...extra.map((b) => ({
          ...b,
          kind: 'workplace' as const,
          workers: [],
          construction: [{ goodType: WOOD, amount: 1 }],
        })),
      ],
      tribes: content.tribes.map((t) =>
        t.typeId !== VIKING
          ? t
          : {
              ...t,
              jobEnables: [
                ...t.jobEnables,
                ...unearned.map((good) => ({ jobType: MILLER, kind: 'good' as const, targetId: good })),
              ],
            },
      ),
    });
  }

  /** The fixture joinery recast as the upper druid hut, its potions in `unearned` not yet earned, and a
   *  temple type the seat can raise. */
  function druidContent(unearned: readonly number[]): ContentSet {
    const recast = joineryRecastAs('work_druid_01', [
      { typeId: HOLY_OIL, id: 'holy_oil' },
      { typeId: POTION_SMALL, id: 'potion_heal_small' },
      { typeId: POTION_BIG, id: 'potion_heal_big' },
    ]);
    return withUnearned(recast, unearned, { typeId: TEMPLE_TYPE, id: 'work_temple' });
  }

  it('arms the archers and spearmen from the armoury until the long bow and iron spear are earned, and stocks past the army', () => {
    const armoury = (unearned: readonly number[], ironSpear: boolean) => {
      const recast = joineryRecastAs('work_armory_01', [
        { typeId: BOW_SHORT, id: 'bow_short' },
        { typeId: BOW_LONG, id: 'bow_long' },
        { typeId: SPEAR_WOODEN, id: 'spear_wooden' },
      ]);
      const content = ironSpear
        ? parseContentSet({
            ...recast,
            goods: [...recast.goods, { typeId: SPEAR_IRON, id: 'spear_iron', weight: 1 }],
          })
        : recast;
      const seated = withUnearned(content, unearned);
      const armourers = crewedWorkshops(seated, 1, 2);
      armourers.hire(0, 2);
      return { ...armourers, wood: woodLines(seated, armourers.sim.tick) };
    };
    // Before the long bow: short bows for the archers and wooden spears for the spearmen.
    expect(armoury([BOW_LONG], false).products()).toEqual([[BOW_SHORT], [SPEAR_WOODEN]]);
    const earned = armoury([], false);
    expect(earned.products()).toEqual([[BOW_LONG], [SPEAR_WOODEN]]);
    // Both at the army's line: the armourers rest while the sites want the wood, and with wood to spare
    // stock both lines.
    earned.stock(BOW_LONG, ARMY_RESERVE_UNITS);
    earned.stock(SPEAR_WOODEN, ARMY_RESERVE_UNITS);
    earned.stock(WOOD, earned.wood.short - 1);
    expect(earned.products()).toEqual(['rest', 'rest']);
    earned.stock(WOOD, earned.wood.comfort);
    expect(earned.products()).toEqual([[BOW_LONG], [SPEAR_WOODEN]]);
    // With the iron spear earned and no smith to feed, no wooden spear is wanted.
    expect(armoury([], true).products()).toEqual([[BOW_LONG], [BOW_LONG]]);
  });

  it('shares the smiths out over the armour and weapons the army lacks, and stocks them past it', () => {
    const recast = joineryRecastAs('work_smithy_01', [
      { typeId: ARMOUR_PLATE, id: 'armor_plate' },
      { typeId: ARMOUR_CHAIN, id: 'armor_chain' },
      { typeId: SWORD_LONG, id: 'sword_long' },
      { typeId: SPEAR_IRON, id: 'spear_iron' },
      { typeId: SWORD_SHORT, id: 'sword_shord' },
    ]);
    const smiths = crewedWorkshops(recast, 1, 2);
    smiths.hire(0, 2);
    expect(smiths.products()).toEqual([[ARMOUR_PLATE, ARMOUR_CHAIN], [SWORD_LONG]]);
    // The long swords at the army's line: the weapon smith turns to iron spears.
    smiths.stock(SWORD_LONG, ARMY_RESERVE_UNITS);
    expect(smiths.products()).toEqual([[SPEAR_IRON]]);
    // Every want met: both smiths rest while the sites want the wood, and with wood to spare forge the
    // army's arms for stock, the armour first.
    smiths.stock(SPEAR_IRON, ARMY_RESERVE_UNITS);
    smiths.stock(ARMOUR_PLATE, ARMY_RESERVE_UNITS);
    const wood = woodLines(recast, smiths.sim.tick);
    smiths.stock(WOOD, wood.short - 1);
    expect(smiths.products()).toEqual(['rest', 'rest']);
    // A surplus is taken up only at the wood's comfort line, and held down to its short line.
    smiths.stock(WOOD, wood.comfort - 1);
    expect(smiths.products()).toEqual([]);
    smiths.stock(WOOD, wood.comfort);
    expect(smiths.products()).toEqual([[ARMOUR_PLATE, ARMOUR_CHAIN], [SWORD_LONG]]);
    smiths.stock(WOOD, wood.short);
    expect(smiths.products()).toEqual([]);
    smiths.stock(WOOD, wood.short);
    expect(smiths.products()).toEqual([]);
  });

  it('keeps a lone lower smith on long swords past the army until chain mail is earned', () => {
    const recast = joineryRecastAs('work_smithy_00', [
      { typeId: SWORD_LONG, id: 'sword_long' },
      { typeId: SPEAR_IRON, id: 'spear_iron' },
      { typeId: SWORD_SHORT, id: 'sword_shord' },
    ]);
    const withChain = parseContentSet({
      ...recast,
      goods: [...recast.goods, { typeId: ARMOUR_CHAIN, id: 'armor_chain', weight: 1 }],
    });
    const smiths = crewedWorkshops(withUnearned(withChain, [ARMOUR_CHAIN]), 1, 1);
    smiths.hire(0, 1);
    smiths.stock(SWORD_LONG, ARMY_RESERVE_UNITS);
    smiths.stock(SPEAR_IRON, ARMY_RESERVE_UNITS);
    // Every want met, yet his forgings still earn the upper smithy's chain mail.
    expect(smiths.products()).toEqual([[SWORD_LONG]]);
  });

  it('forges short swords for the swordsmen only until the long sword is earned', () => {
    const recast = joineryRecastAs('work_smithy_00', [
      { typeId: SWORD_LONG, id: 'sword_long' },
      { typeId: SWORD_SHORT, id: 'sword_shord' },
    ]);
    const smiths = crewedWorkshops(withUnearned(recast, [SWORD_LONG]), 1, 1);
    smiths.hire(0, 1);
    expect(smiths.products()).toEqual([[SWORD_SHORT]]);
  });

  it('boils holy oil until the big healing potion is earned, the small one skipped, and then brews only it', () => {
    const products = (unearned: readonly number[]) => {
      const druids = crewedWorkshops(druidContent(unearned), 1, 2);
      druids.hire(0, 2);
      return druids.products();
    };
    expect(products([POTION_SMALL, POTION_BIG])).toEqual([[HOLY_OIL], [HOLY_OIL]]);
    expect(products([POTION_BIG])).toEqual([[HOLY_OIL], [HOLY_OIL]]);
    expect(products([])).toEqual([[POTION_BIG], [POTION_BIG]]);
  });

  it('keeps a unit of holy oil in store while the temple is a site, and none once it stands', () => {
    const druids = crewedWorkshops(druidContent([]), 1, 2);
    druids.hire(0, 2);
    expect(druids.products()).toEqual([[POTION_BIG], [POTION_BIG]]);
    const placeTemple = (underConstruction: boolean) => {
      druids.sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: TEMPLE_TYPE,
        x: 100,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
        underConstruction,
      });
      druids.sim.step();
    };
    placeTemple(true);
    expect(druids.products()).toEqual([[HOLY_OIL]]);
    // A unit short of the line he holds to keeps him boiling; at the line he goes back to the potion.
    druids.stock(HOLY_OIL, TEMPLE_SITE_OIL_UNITS - 1);
    expect(druids.products()).toEqual([]);
    druids.stock(HOLY_OIL, TEMPLE_SITE_OIL_UNITS);
    expect(druids.products()).toEqual([[POTION_BIG]]);
    // He takes the oil back only once the store is out.
    druids.stock(HOLY_OIL, 1);
    expect(druids.products()).toEqual([]);
    druids.stock(HOLY_OIL, 0);
    expect(druids.products()).toEqual([[HOLY_OIL]]);
    const site = entityOfBuilding(druids.sim, TEMPLE_TYPE);
    druids.sim.world.remove(site, UnderConstruction);
    expect(druids.products()).toEqual([[POTION_BIG]]);
  });

  it("staffs one druid and a porter until the big potion is earned, and the hut's second druid once it is", () => {
    const staffingAt = (unearned: readonly number[]) => {
      const content = druidContent(unearned);
      const druids = crewedWorkshops(content, 1, 0);
      const [hut] = druids.buildings;
      if (hut === undefined) throw new Error('setup: no druid hut');
      const ctx = { ...ctxOf(druids.sim), content };
      const owned = ownedBuildings(druids.sim.world, SEAT);
      const supply = SeatSupply.of(druids.sim.world, ctx, SEAT, owned, DEFAULT_BUILD_ORDER);
      const seat = { player: SEAT, owned, supply, profile: AI_PROFILES.hard };
      const type = contentIndex(content).buildings.get(JOINERY_TYPE);
      if (type === undefined) throw new Error('setup: no druid hut type');
      const plan = buildingStaffing(druids.sim.world, ctx, seat, hut, type, { operators: 1, carriers: 0 });
      return { operators: plan?.operatorTarget, porters: plan?.carrierMin };
    };
    expect(staffingAt([POTION_BIG])).toEqual({ operators: 1, porters: 1 });
    expect(staffingAt([])).toEqual({ operators: 2, porters: 0 });
  });

  it('runs a porter at the mill until the seat has earned the baker, and none once it has', () => {
    const base = aiContent();
    // The baker opens from the miller's work, a trade nobody of the seat holds yet.
    const content = parseContentSet({
      ...base,
      tribes: base.tribes.map((t) =>
        t.typeId !== VIKING
          ? t
          : {
              ...t,
              jobEnables: [...t.jobEnables, { jobType: MILLER, kind: 'job' as const, targetId: BAKER }],
              jobRequirements: [
                ...t.jobRequirements,
                {
                  requirement: 'need' as const,
                  target: 'job' as const,
                  targetId: BAKER,
                  amount: 10,
                  experienceTypes: [],
                },
              ],
            },
      ),
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const mill = entityOfBuilding(sim, MILL_TYPE);
    const type = contentIndex(content).buildings.get(MILL_TYPE);
    if (type === undefined) throw new Error('setup: no mill type');
    const porters = () => {
      const ctx = { ...ctxOf(sim), content };
      const owned = ownedBuildings(sim.world, SEAT);
      const supply = SeatSupply.of(sim.world, ctx, SEAT, owned, DEFAULT_BUILD_ORDER);
      const seat = { player: SEAT, owned, supply, profile: AI_PROFILES.hard };
      return buildingStaffing(sim.world, ctx, seat, mill, type, { operators: 1, carriers: 0 })?.carrierMin;
    };
    expect(porters()).toBe(1);
    setProfessionProgression(sim.world, false);
    expect(porters()).toBe(0);
  });
});
