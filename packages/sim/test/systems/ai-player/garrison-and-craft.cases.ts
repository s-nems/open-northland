import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiPeace,
  ASSISTANT_RECRUIT_INTENTS,
  type AssistantCounterKind,
  AssistantRecruit,
  type AssistantRecruitIntent,
  aiPlayerEntity,
  Building,
  CompletedCycles,
  CraftSelection,
  JobAssignment,
  Settler,
  setStockAmount,
  TrainingOrder,
} from '../../../src/components/index.js';
import type { PlayerCommand } from '../../../src/core/commands/index.js';
import type { Entity, World } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { AI_PUBLISHED_COUNTERS } from '../../../src/systems/ai-player/assistant-counters.js';
import {
  DEFAULT_BUILD_ORDER,
  LATE_GAME_CIVILIANS,
  SeatSupply,
  supplyLines,
} from '../../../src/systems/ai-player/index.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-player/seat-roster.js';
import {
  CRAFT_GLUT_BAND_UNITS,
  CRAFT_OPENING_RUN_BY_BUILDING_ID,
  CRAFT_PLANS_BY_BUILDING_ID,
  SHORT_PRODUCT_SEATS,
  tuneCraftSelections,
} from '../../../src/systems/ai-player/workforce/craft.js';
import { ARMY_FLOOR_LEAD_TICKS, ARMY_FLOOR_MIN } from '../../../src/systems/ai-player/workforce/garrison.js';
import { mayMarry } from '../../../src/systems/family/eligibility.js';
import { isFighterJob, type SystemContext } from '../../../src/systems/index.js';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { stampPost } from '../../signposts/support.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  armedContent,
  BARRACKS_TYPE,
  BOW,
  BOWMAN,
  BREEDER,
  BUILDER,
  CATTLE,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  husbandryContent,
  JOINER,
  JOINERY_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  SEAT,
  SPEAR,
  SPEARMAN,
  SWORD,
  spawnMen,
  TOOL_IRON,
  TOWER_TYPE,
  VIKING,
  WOMAN,
  WOOD,
} from './support.js';

// The garrison sizing out of the true bachelor surplus, the weapon mix it publishes, and the
// per-seat craft restrictions.

/** Spare civilians an armed-seat case spawns by default - well past every post, reserve and
 *  collector tier. The army floor (no peace and no enemy: {@link ARMY_FLOOR_MIN}) claims men these
 *  cases count as spare anyway and publishes them in the same counters, so their totals hold. */
const SPARE_MEN = 40;

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
  makeAiSeat(sim, SEAT);
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

/** The rival seat whose fighters the army floor matches. */
const RIVAL = 3;
/** Where the rival's fighters stand: the far end of the armed-seat map, away from the seat's settlement. */
const RIVAL_CAMP = { x: 100, y: 20 };
/** A rival stronger than the floor's minimum, so the match, not the minimum, sets the floor. */
const RIVAL_FIGHTERS = ARMY_FLOOR_MIN + 2;
/** A crew whose collector top-ups, with no floor, leave fewer spare men than {@link RIVAL_FIGHTERS}. */
const FLOOR_CREW = 28;

/** An armed seat with ground to gather on, `rivals` enemy spearmen, and its peace ending at `peaceUntil`. */
function rivalSeat(rivals: number, peaceUntil: number, options: SeatOptions = {}): ArmedSeat {
  const seat = armedSeat([{ good: SWORD, amount: 1 }], { men: FLOOR_CREW, ...options });
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
  seat.sim.step();
  const carrier = aiPlayerEntity(seat.sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no AI seat');
  seat.sim.world.add(carrier, AiPeace, { untilTick: peaceUntil });
  return seat;
}

/** A peace so far off that no case's decision reaches the floor's lead. */
const DISTANT_PEACE = 1_000_000_000;

/** The men the standing order drafts, over every counter. */
function drafted(seat: ArmedSeat): number {
  return Object.values(counterWants(seat.sim, seat.ctx)).reduce((sum, value) => sum + value, 0);
}

const FURNITURE = 13;

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
const BOW_LONG = 17;
const SPEAR_WOODEN = 18;
const SHOES = 19;
const LEATHER_ARMOUR = 20;

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

function mintContent(): ContentSet {
  return joineryRecastAs('work_coin_mint', [
    { typeId: COIN, id: 'coin' },
    { typeId: DEFENCE_AMULET, id: 'amulet_defense' },
    { typeId: STRENGTH_AMULET, id: 'amulet_strength' },
  ]);
}

/** The glut a plan's seat `index` drops `goodId` at, or a failure when the plan does not cap it. */
function glutOf(buildingId: string, index: number, goodId: string): number {
  const seat = CRAFT_PLANS_BY_BUILDING_ID[buildingId]?.seats[index];
  const glut = seat === undefined || !('goods' in seat) ? undefined : seat.glut[goodId];
  if (glut === undefined) throw new Error(`setup: ${buildingId} seat ${index} does not cap ${goodId}`);
  return glut;
}

/** One decision's craft selections, over the seat's supply at the time. */
function tune(world: World, ctx: SystemContext): PlayerCommand[] {
  const supply = SeatSupply.of(world, ctx, SEAT, ownedBuildings(world, SEAT), DEFAULT_BUILD_ORDER);
  return tuneCraftSelections(world, ctx, SEAT, supply);
}

/** A recast joinery at (40, 16) with `crew` builders hired as its joiners, lowest id first; the
 *  products each decision hands them, via {@link tune}, in that order. */
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
    if (sim.world.get(man, Settler).jobType === BUILDER)
      sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: workshop, jobPriority: [JOINER] });
  }
  sim.step();
  const ctx = { ...ctxOf(sim), content };
  return {
    sim,
    /** Put `units` of the good into the headquarters, the seat's fetchable stock. */
    stock: (good: number, units: number) =>
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, units),
    /** The decision's product changes, applied. */
    products(): (readonly number[])[] {
      const commands = tune(sim.world, ctx);
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands.flatMap((c) => (c.kind === 'setCraftGoods' ? [c.goods] : []));
    },
  };
}

describe('workforce module - the barracks and craft selections', () => {
  it('never staffs the barracks: it is a military building, not a workplace the plan crews', () => {
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
    // A grown seat, so the HQ staffs its carriers at all.
    spawnMen(sim, LATE_GAME_CIVILIANS, BUILDER);
    sim.step();

    // The barracks declares carrier slots like any store, but the seat posts nobody to them (user
    // rule) and stamps no fighter trade by command: a soldier is made by the drill, never
    // by `setJob` - and a seat that is not AI-flagged runs no garrison hire at all.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const barracks = entityOfBuilding(sim, BARRACKS_TYPE);
    const posted = commands.filter((c) => c.kind === 'assignWorker');
    // The staffing pass ran - the HQ took its carriers - and skipped the barracks beside it.
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((c) => c.building === entityOfBuilding(sim, HQ_TYPE))).toBe(true);
    expect(posted.filter((c) => c.building === barracks)).toEqual([]);
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
    // One unit of each is enough: the counter is a standing want, and the smithy keeps making more.
    const both = [
      { good: SWORD, amount: 1 },
      { good: BOW, amount: 1 },
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
      { good: SWORD, amount: 1 },
      { good: BOW, amount: 1 },
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
      { good: SWORD, amount: 1 },
      { good: SPEAR, amount: 1 },
      { good: BOW, amount: 1 },
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
      { good: SWORD, amount: 1 },
      { good: SPEAR, amount: 1 },
    ]);
    const total = sparePool(seat);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({
      trainSword: Math.ceil(total / 2),
      trainSpear: Math.floor(total / 2),
    });
  });

  it('vetoes a weaker weapon once, and never drafts a class only that weapon could arm', () => {
    const seat = armedSeat([{ good: SWORD, amount: 1 }], { content: longSwordContent() });
    const first = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    const vetoes = first.filter((c) => c.kind === 'setAssistantWeaponVeto');
    expect(vetoes).toEqual([{ kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD, vetoed: true }]);
    // The same decision already drafts as if the veto stood: only the short swords are in store, so
    // nobody can be armed and the men drill bare.
    expect(first.some((c) => c.kind === 'setAssistantCounter' && c.counter === 'trainSword')).toBe(false);
    for (const veto of vetoes) seat.sim.enqueueSetup(veto);
    seat.sim.step();

    const again = collectModule.run(seat.sim.world, seat.ctx, SEAT);
    expect(again.some((c) => c.kind === 'setAssistantWeaponVeto')).toBe(false);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: sparePool(seat) });
  });

  it('lifts its weapon vetoes when the AI lets go of the seat or its military module', () => {
    const vetoedSeat = (): ArmedSeat => {
      const seat = armedSeat([], { content: longSwordContent() });
      for (const c of collectModule.run(seat.sim.world, seat.ctx, SEAT)) {
        if (c.kind === 'setAssistantWeaponVeto') seat.sim.enqueueSetup(c);
      }
      seat.sim.step();
      expect(seat.sim.assistantWeaponVetoes(SEAT)).toEqual([SWORD]);
      return seat;
    };
    const detached = vetoedSeat();
    detached.sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: false });
    detached.sim.step();
    expect(detached.sim.assistantWeaponVetoes(SEAT)).toEqual([]);

    const disarmed = vetoedSeat();
    disarmed.sim.enqueueSetup({
      kind: 'setPlayerAi',
      player: SEAT,
      enabled: true,
      modules: { military: false, houseBuild: true },
    });
    disarmed.sim.step();
    expect(disarmed.sim.assistantWeaponVetoes(SEAT)).toEqual([]);
  });

  it('drafts spearmen alone while only spears are in store', () => {
    const seat = armedSeat([{ good: SPEAR, amount: 1 }]);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSpear: sparePool(seat) });
  });

  it('puts the whole order on the one class it can arm, never on fists', () => {
    const seat = armedSeat([{ good: BOW, amount: 1 }]);
    // Swords unmade: a swordsman would stand around weaponless, so every recruit becomes an archer
    // (user rule - the fist is the last resort, not half the plan).
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainBow: sparePool(seat) });
  });

  it('falls back to fist-fighters only while the seat holds no arms at all', () => {
    const seat = armedSeat([]);
    const total = sparePool(seat);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: total });

    // The fallback follows the STORE, not the content: one delivered sword flips the whole order.
    setStockAmount(seat.sim.world, entityOfBuilding(seat.sim, HQ_TYPE), SWORD, 1);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: total });
  });

  it('will not order a class whose weapons its recruits could never walk to', () => {
    // The store a long march from the drill floor, with no signpost network bridging the two: the
    // arming pass would never fetch these swords, and a `trainSword` order would fill the barracks
    // with men who stand around bare-handed forever - and, being booked, never march either.
    const seat = armedSeat([{ good: SWORD, amount: 1 }], { confined: true, barracks: FAR_BARRACKS });
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSoldiers: sparePool(seat) });

    // One post between the two puts the store back inside the drill floor's own network.
    stampPost(seat.sim, BRIDGE_POST.x, BRIDGE_POST.y, SEAT);
    expect(counterWants(seat.sim, seat.ctx)).toEqual({ trainSword: sparePool(seat) });
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
    // Drift guard: `setPlayerAi(false)` resets exactly the AI_PUBLISHED_COUNTERS kinds, so a counter
    // this rung reaches for outside that list would keep drafting after the seat's AI is detached.
    const withdrawable = new Set<string>(
      AI_PUBLISHED_COUNTERS.filter((entry) => entry.modules.includes('military')).flatMap(
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
    // With no floor the collector top-ups take most of the crew and leave fewer men than the rival fields.
    const peaceful = rivalSeat(RIVAL_FIGHTERS, DISTANT_PEACE);
    const spare = sparePool(peaceful);
    expect(drafted(peaceful)).toBe(spare);
    expect(spare).toBeLessThan(RIVAL_FIGHTERS);

    // The lead reached, the floor claims its men ahead of those top-ups: one recruit per enemy fighter.
    const armed = rivalSeat(RIVAL_FIGHTERS, ARMY_FLOOR_LEAD_TICKS);
    expect(drafted(armed)).toBe(RIVAL_FIGHTERS);
    expect(sparePool(armed)).toBe(RIVAL_FIGHTERS);
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
    expect(first.filter((c) => c.kind === 'setCraftGoods')).toEqual([]);
    for (const c of first) sim.enqueueSetup(c);
    sim.step();

    const second = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const tuned = second.filter((c) => c.kind === 'setCraftGoods');
    const joiner = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, JOINERY_TYPE),
    );
    expect(tuned).toEqual([{ kind: 'setCraftGoods', entity: joiner, goods: [TOOL_IRON] }]);

    // Applied once, the selection matches - the next decision issues nothing.
    for (const c of second) sim.enqueueSetup(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setCraftGoods'),
    ).toEqual([]);
  });

  it('keeps both joiners on iron tools, and turns both to furniture while the tools pile up', () => {
    const seat = crewedWorkshop(furnitureContent(), 2);
    const glut = glutOf('work_joinery_01', 0, 'tool_iron');
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
    seat.stock(TOOL_IRON, glut - 1);
    expect(seat.products()).toEqual([]);
    seat.stock(TOOL_IRON, glut);
    expect(seat.products()).toEqual([[FURNITURE], [FURNITURE]]);
    // The tools come back only under the band, so the stock hovering at the glut flips nothing.
    seat.stock(TOOL_IRON, glut - CRAFT_GLUT_BAND_UNITS);
    expect(seat.products()).toEqual([]);
    seat.stock(TOOL_IRON, glut - CRAFT_GLUT_BAND_UNITS - 1);
    expect(seat.products()).toEqual([[TOOL_IRON], [TOOL_IRON]]);
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
    expect(sim.world.get(mason, CraftSelection).goods).toEqual([PILLAR]);

    // The upgraded hut opens on a marble run, counted on the hut itself.
    const run = { kind: 'setCraftGoods', entity: mason, goods: [ORNAMENT] } as const;
    expect(tune(sim.world, ctx)).toEqual([run]);
    sim.enqueueSetup(run);
    sim.step();
    const cycles = CRAFT_OPENING_RUN_BY_BUILDING_ID.work_mason_hut_01?.cycles ?? 0;
    sim.world.mut(hut, CompletedCycles).byGood.set(ORNAMENT, cycles - 1);
    expect(tune(sim.world, ctx)).toEqual([]);

    // With the run done, the mason alternates stone blocks and marble.
    sim.world.mut(hut, CompletedCycles).byGood.set(ORNAMENT, cycles);
    const choice = { kind: 'setCraftGoods', entity: mason, goods: [PILLAR, ORNAMENT] } as const;
    expect(tune(sim.world, ctx)).toEqual([choice]);
    sim.enqueueSetup(choice);
    sim.step();
    expect(sim.world.get(mason, CraftSelection).goods).toEqual([PILLAR, ORNAMENT]);
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
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setCraftGoods')).toEqual([
      { kind: 'setCraftGoods', entity: breeders[0], goods: [CATTLE] },
      { kind: 'setCraftGoods', entity: breeders[1], goods: [CATTLE] },
    ]);
  });

  /** Three mints of four coiners' seats with `crew` builders hired two a mint, lowest id first; the
   *  products each decision hands them, and the coins' lines. */
  function crewedMints(crew: number) {
    const content = mintContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 32) });
    placeHq(sim);
    for (const x of [40, 60, 80]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: JOINERY_TYPE,
        x,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, crew, BUILDER);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    const mints = [...sim.world.query(Building)]
      .filter((e) => sim.world.get(e, Building).buildingType === JOINERY_TYPE)
      .sort((a, b) => a - b);
    const men = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === BUILDER)
      .sort((a, b) => a - b);
    const coins = supplyLines(content, DEFAULT_BUILD_ORDER).get(COIN);
    if (coins === undefined) throw new Error('setup: coins take supply lines');
    return {
      coins,
      stockCoins: (units: number) => setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), COIN, units),
      hire(from: number, to: number): void {
        for (let i = from; i < to; i++) {
          const man = men[i];
          const mint = mints[Math.floor(i / 2)];
          if (man === undefined || mint === undefined) throw new Error('setup: too few men or mints');
          sim.enqueueSetup({ kind: 'assignWorker', entity: man, building: mint, jobPriority: [JOINER] });
        }
        sim.step();
      },
      /** The decision's product changes, applied. */
      products(): (readonly number[])[] {
        const commands = tune(sim.world, ctx);
        for (const c of commands) sim.enqueueSetup(c);
        sim.step();
        return commands.flatMap((c) => (c.kind === 'setCraftGoods' ? [c.goods] : []));
      },
    };
  }

  it('turns a defence coiner to coins once the third mint brings the strength-amulet pair', () => {
    const mints = crewedMints(6);
    // Coins at their comfort line, so the plan's lists stand.
    mints.stockCoins(mints.coins.comfort);
    mints.hire(0, 4);
    expect(mints.products()).toEqual([[COIN], [DEFENCE_AMULET], [DEFENCE_AMULET], [DEFENCE_AMULET]]);
    // The crowded seats: the third coiner turns to coins and the new pair takes the strength amulets.
    mints.hire(4, 6);
    expect(mints.products()).toEqual([[COIN], [STRENGTH_AMULET], [STRENGTH_AMULET]]);
  });

  it('turns up to two amulet makers to coins while the coins run short, one per unit they lack', () => {
    const mints = crewedMints(4);
    const { unit, short, comfort } = mints.coins;
    mints.stockCoins(comfort);
    mints.hire(0, 4);
    expect(mints.products()).toEqual([[COIN], [DEFENCE_AMULET], [DEFENCE_AMULET], [DEFENCE_AMULET]]);
    // At the short line nothing moves. Under it the last amulet seats turn to coins, one per unit lacking
    // to comfort and never more than the cap, whatever the lack.
    mints.stockCoins(short);
    expect(mints.products()).toEqual([]);
    expect(Math.ceil(comfort / unit)).toBeGreaterThan(SHORT_PRODUCT_SEATS);
    mints.stockCoins(0);
    expect(mints.products()).toEqual([[COIN], [COIN]]);
    // The turned seats hold to the comfort line, the first of them the last to go.
    mints.stockCoins(comfort - unit);
    expect(mints.products()).toEqual([[DEFENCE_AMULET]]);
    mints.stockCoins(comfort - 1);
    expect(mints.products()).toEqual([]);
    mints.stockCoins(comfort);
    expect(mints.products()).toEqual([[DEFENCE_AMULET]]);
  });

  it('turns the first armourer to wooden spears alone while the long bows pile up, and back once they are drawn down', () => {
    const seat = crewedWorkshop(
      joineryRecastAs('work_armory_01', [
        { typeId: BOW_LONG, id: 'bow_long' },
        { typeId: SPEAR_WOODEN, id: 'spear_wooden' },
      ]),
      1,
    );
    const glut = glutOf('work_armory_01', 0, 'bow_long');
    expect(seat.products()).toEqual([[BOW_LONG, SPEAR_WOODEN]]);
    seat.stock(BOW_LONG, glut - 1);
    expect(seat.products()).toEqual([]);
    seat.stock(BOW_LONG, glut);
    expect(seat.products()).toEqual([[SPEAR_WOODEN]]);
    // The bow comes back only under the band, so the stock hovering at the glut flips nothing.
    seat.stock(BOW_LONG, glut - CRAFT_GLUT_BAND_UNITS);
    expect(seat.products()).toEqual([]);
    seat.stock(BOW_LONG, glut - CRAFT_GLUT_BAND_UNITS - 1);
    expect(seat.products()).toEqual([[BOW_LONG, SPEAR_WOODEN]]);
  });

  it('turns the first tailor to leather armour while the shoes pile up, and back once they are worn down', () => {
    for (const [id, crew] of [
      ['work_sewery_01', 2],
      ['work_sewery_00', 1],
    ] as const) {
      const seat = crewedWorkshop(
        joineryRecastAs(id, [
          { typeId: SHOES, id: 'shoes' },
          { typeId: LEATHER_ARMOUR, id: 'armor_leather' },
        ]),
        crew,
      );
      const glut = glutOf(id, 0, 'shoes');
      expect(seat.products()[0]).toEqual([SHOES]);
      seat.stock(SHOES, glut - 1);
      expect(seat.products()).toEqual([]);
      seat.stock(SHOES, glut);
      expect(seat.products()).toEqual([[LEATHER_ARMOUR]]);
      seat.stock(SHOES, glut - CRAFT_GLUT_BAND_UNITS - 1);
      expect(seat.products()).toEqual([[SHOES]]);
    }
  });

  it('turns the second tailor to shoes while the leather armour lies unworn, and back once the amulets take it', () => {
    const seat = crewedWorkshop(
      joineryRecastAs('work_sewery_01', [
        { typeId: SHOES, id: 'shoes' },
        { typeId: LEATHER_ARMOUR, id: 'armor_leather' },
      ]),
      2,
    );
    const glut = glutOf('work_sewery_01', 1, 'armor_leather');
    expect(seat.products()).toEqual([[SHOES], [LEATHER_ARMOUR]]);
    seat.stock(LEATHER_ARMOUR, glut);
    expect(seat.products()).toEqual([[SHOES]]); // the second seat's change; the first already sews shoes
    seat.stock(LEATHER_ARMOUR, glut - CRAFT_GLUT_BAND_UNITS - 1);
    expect(seat.products()).toEqual([[LEATHER_ARMOUR]]);
  });

  it('hands the seats out across every building of the type, not per building', () => {
    // One tailor in each of two sewing huts: counted per building each would be a lone man on the first
    // seat's shoes, counted across the type they are the pair the table splits.
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
    }
    sim.step();

    const tailors = [...sim.world.query(Settler, JobAssignment)]
      .filter((e) => sim.world.get(e, Settler).jobType === JOINER)
      .sort((a, b) => a - b);
    expect(tailors).toHaveLength(2);
    expect(tune(sim.world, ctx)).toEqual([
      { kind: 'setCraftGoods', entity: tailors[0], goods: [SHOES] },
      { kind: 'setCraftGoods', entity: tailors[1], goods: [LEATHER_ARMOUR] },
    ]);
  });
});
