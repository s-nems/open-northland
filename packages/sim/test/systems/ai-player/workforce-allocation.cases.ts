import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiPlayerEntity,
  Marriage,
  Position,
  Resource,
  Settler,
  SettlerProgress,
  StalledPlacements,
  Stockpile,
  setStockAmount,
  WALK_RANGE_NODES,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, nodeOfPosition, Simulation } from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import type { EntryStatus } from '../../../src/systems/ai-player/build-order/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import {
  BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS,
  BUILDING_GOODS_GROW_FROM_TICKS,
  gamePhase,
  LATE_GAME_FROM_TICKS,
  MID_GAME_FROM_TICKS,
  STORE_CARRIERS_FROM_TICKS,
} from '../../../src/systems/ai-player/game-phase.js';
import {
  BUILDER_CAP,
  type BuildOrderEntry,
  CIVILIANS_PER_CLEARING_COLLECTOR,
  COLLECTOR_TARGET_BY_GOOD_ID,
  DEFAULT_BUILD_ORDER,
  DEFAULT_COLLECTOR_TARGET,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  GROWN_SEAT_BUILDER_CAP,
  LATE_GAME_BUILDER_CAP,
  LATE_GAME_CIVILIANS,
  SeatSupply,
  STALLED_BUILDER_CAP,
  type SupplyLines,
  sitePace,
  supplyLines,
  workforceModule,
} from '../../../src/systems/ai-player/index.js';
import { gathererReach, workableResourceTest } from '../../../src/systems/ai-player/live-resources.js';
import { anchorNodeOf } from '../../../src/systems/ai-player/node-geometry.js';
import { ownedBuildings } from '../../../src/systems/ai-player/seat-roster.js';
import {
  CLEAR_GROUND_FROM_NODES,
  CLEARING_SPREAD_NODES,
  extraGatherers,
  FLAG_RELOCATE_EVERY_DECISIONS,
  farGroundExtras,
  GENERIC_COLLECTOR_TARGET,
  MAX_CLEARING_COLLECTORS,
  NODES_PER_CLEARING_GATHERER,
  OPENING_SITE_SHORTAGE_POSTS,
  SHORTAGE_BUILDER_FLOOR,
  siteShortagePosts,
  type WantedGood,
  WOOD_OVER_STONE_NODES,
  wantedCollectorGoods,
} from '../../../src/systems/ai-player/workforce/collectors/index.js';
import {
  flagGround,
  flagSpotNear,
  replantSpot,
} from '../../../src/systems/ai-player/workforce/flag-spots.js';
import { builderCap } from '../../../src/systems/ai-player/workforce/staffing.js';
import { resourceStanceCells, resourceWorkCell } from '../../../src/systems/footprint/interaction.js';
import { canPlaceWorkFlag, type SystemContext } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKER,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BUILDER,
  CARRIER,
  CIVILIST,
  COLLECTOR,
  collectModule,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  IRON_GATE_XP,
  JOINER,
  JOINERY_TYPE,
  MUD,
  makeAiSeat,
  placeHq,
  placeResources,
  plantPostAtHq,
  RESOURCE_SPOTS,
  SCOUT,
  SEAT,
  STOCK_TYPE,
  STONE,
  STONE_XP_TRACK,
  spawnMen,
  TOOL_IRON,
  VIKING,
  WELL_TYPE,
  WOOD,
  WOOD_HARVEST,
  wallOver,
} from './support.js';

/** The fixture's wood lines: the unit is the home chain's merged bill (three tiers of two), comfort adds
 *  one unit over the joinery's five-wood shelf. */
const FIXTURE_WOOD_LINES = { unit: 6, short: 12, comfort: 18 };

const FIRST_WORKSHOP_SPOT = { x: 40, y: 16 };
/** Nodes across the map of the seat-reach case: its far end lies past `WALK_RANGE_NODES` from the HQ. */
const FAR_MAP_WIDTH = 160;
const SECOND_WORKSHOP_SPOT = { x: 40, y: 26 };
const THIRD_WORKSHOP_SPOT = { x: 40, y: 36 };

/** Free fixture ids for {@link workshopContent}'s trades and workshops. */
const POTTER = 29;
const SMITH = 30;
const POTTERY_00_TYPE = 30;
const POTTERY_01_TYPE = 31;
const SMITHY_TYPE = 32;

/** The AI fixture plus the two pottery tiers (one potter slot, then two) eating clay, and a two-smith
 *  smithy eating iron, all with a five-unit input shelf; the HQ stores iron too. */
function workshopContent(): ContentSet {
  const base = aiContent();
  const workshop = (typeId: number, id: string, job: number, slots: number, input: number) => ({
    typeId,
    id,
    kind: 'workplace' as const,
    workers: [{ jobType: job, count: slots }],
    recipes: [
      { inputs: [{ goodType: input, amount: 1 }], outputs: [{ goodType: TOOL_IRON, amount: 1 }], ticks: 180 },
    ],
    construction: [{ goodType: WOOD, amount: 2 }],
    stock: [{ goodType: input, capacity: 5, initial: 0 }],
  });
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: POTTER, id: 'potter' }, { typeId: SMITH, id: 'smith' }],
    buildings: [
      ...base.buildings.map((b) =>
        b.id === 'headquarters'
          ? { ...b, stock: [...b.stock, { goodType: IRON, capacity: 150, initial: 0 }] }
          : b,
      ),
      workshop(POTTERY_00_TYPE, 'work_pottery_00', POTTER, 1, MUD),
      workshop(POTTERY_01_TYPE, 'work_pottery_01', POTTER, 2, MUD),
      workshop(SMITHY_TYPE, 'work_smithy_01', SMITH, 2, IRON),
    ],
  });
}

/** A free fixture id for {@link shedContent}'s one-node building. */
const SHED_TYPE = 33;

/** The AI fixture plus a shed whose body blocks the one node it stands on. */
function shedContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: SHED_TYPE,
        id: 'test_shed',
        kind: 'home',
        homeSize: 1,
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
    ],
  });
}

/** The cell column of {@link waterSim}'s strip: its node columns lie between the HQ (hx 30) and
 *  {@link FAR_BANK}. */
const WATER_CELL_COLUMN = 22;

/** Three deposit spots on the far bank of {@link waterSim}'s strip. */
const FAR_BANK = [
  { x: 54, y: 16 },
  { x: 56, y: 8 },
  { x: 56, y: 24 },
] as const;

/** {@link aiSim}'s map split by a full-height water strip no walk crosses. */
function waterSim(): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: waterColumnMap(32, 16, WATER_CELL_COLUMN),
  });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  return sim;
}

function placeWorkshop(sim: Simulation, buildingType: number, spot = FIRST_WORKSHOP_SPOT): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, ...spot, tribe: VIKING, owner: SEAT });
}

/** The good's gatherer target this decision, with every `entries` collector entry reached, over the
 *  supply lines of the default build order. */
function wantedTarget(
  sim: Simulation,
  ctx: SystemContext,
  good: number,
  entries: readonly BuildOrderEntry[] = [],
): number | undefined {
  return wantedRow(sim, ctx, good, entries)?.target;
}

function wantedRow(
  sim: Simulation,
  ctx: SystemContext,
  good: number,
  entries: readonly BuildOrderEntry[] = [],
): WantedGood | undefined {
  const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
  const reached = entries.map((): EntryStatus => 'satisfied');
  return wantedCollectorGoods(sim.world, ctx, SEAT, entries, reached, supply).find(
    (w) => w.good.typeId === good,
  );
}

/** Stock the HQ at the good's comfort line, so no shortage post rides on the target. */
function stockAtComfort(sim: Simulation, ctx: SystemContext, good: number): void {
  const comfort = supplyLines(ctx.content, DEFAULT_BUILD_ORDER).get(good)?.comfort ?? 0;
  setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, comfort);
}

const posted = (commands: readonly Command[]) =>
  commands.flatMap((c) => (c.kind === 'setGatherGood' ? [c.goodType] : []));

const holdersOf = (sim: Simulation, good: number) =>
  [...sim.world.query(Settler, WorkFlag)].filter((e) => sim.world.get(e, WorkFlag).goodType === good);

/** The allocator's hiring ladder: collector posts, workshop staffing tiers, scout, builder reserve. */

describe('workforce module (collectResources)', () => {
  it("counts the heaps in reach of the seat's buildings as its supply, like the summary bar", () => {
    // A map wide enough that its far end lies beyond the walk range of every building of the seat.
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(FAR_MAP_WIDTH, 64) });
    placeHq(sim);
    sim.step();
    const hq = entityOfBuilding(sim, HQ_TYPE);
    setStockAmount(sim.world, hq, WOOD, 0);
    const base = anchorNodeOf(sim.world, hq);
    if (base === null) throw new Error('setup: the HQ has no anchor node');
    // An unowned heap at the map's far end, beyond the base's walk range, and one a few tiles from it.
    const heap = (x: number, y: number, units: number): number => {
      const e = sim.world.create();
      sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
      sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, units]]) });
      const n = nodeOfPosition(fx.fromInt(x), fx.fromInt(y));
      return hexDistanceBetween(base.hx, base.hy, n.hx, n.hy);
    };
    const FAR_UNITS = 40;
    const NEAR_UNITS = 3;
    expect(heap(FAR_MAP_WIDTH / 2 - 4, 20, FAR_UNITS)).toBeGreaterThanOrEqual(WALK_RANGE_NODES);
    expect(heap(15, 10, NEAR_UNITS)).toBeLessThan(WALK_RANGE_NODES);
    sim.step();

    const ctx = ctxOf(sim);
    const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
    expect(supply.units(WOOD)).toBe(NEAR_UNITS);
    expect(supply.exceeds(WOOD, NEAR_UNITS - 1)).toBe(true);
    expect(supply.exceeds(WOOD, NEAR_UNITS)).toBe(false);
  });

  it('hires flag collectors beside their resources, one scout, and the builder reserve', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim);
    spawnMen(sim, 6);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const jobs = commands.filter((c) => c.kind === 'setJob');
    const flags = commands.filter((c) => c.kind === 'setWorkFlag');
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    const staffing = commands.filter((c) => c.kind === 'assignWorker');
    // Three collectors in the plan's clay → stone → wood order, then the scout; the two men left over
    // join the builder reserve. The HQ gets no carrier: a storage post is a target-tier extra, and a
    // six-man crew never fills the reserve, let alone clears it.
    expect(jobs.map((j) => j.jobType)).toEqual([COLLECTOR, COLLECTOR, COLLECTOR, SCOUT, BUILDER, BUILDER]);
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    expect(staffing).toEqual([]);
    // Each flag stands 2–3 tiles (4–6 nodes) from its good's resource - never on top of it.
    const spots = [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood];
    expect(flags).toHaveLength(3);
    for (const [i, f] of flags.entries()) {
      const spot = spots[i];
      if (spot === undefined) throw new Error('unreachable: three spots for three flags');
      const dist = Math.abs(f.x - spot.x) + Math.abs(f.y - spot.y);
      expect(dist).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
      expect(dist).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
    }
    // Distinct settlers throughout - the allocator never claims one person twice.
    const claimed = jobs.map((c) => c.entity);
    expect(new Set(claimed).size).toBe(claimed.length);

    // Applying the decision settles the seat: the next decision has nothing left to do.
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    const bound = [...sim.world.query(Settler, WorkFlag)];
    expect(bound).toHaveLength(3);
    expect(bound.map((e) => sim.world.get(e, WorkFlag).goodType).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      [WOOD, MUD, STONE].sort((a, b) => a - b),
    );
  });

  it('tops wood/stone up to their late-game targets once the reserve and the store carriers stand', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, LATE_GAME_BUILDER_CAP + 10);
    sim.step();
    // Late in the game: five wood posts and four stone ones, with both goods stocked past the glut so no
    // shortage post rides on the schedule.
    expect((COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0) + extraGatherers('wood', LATE_GAME_FROM_TICKS)).toBe(5);
    expect((COLLECTOR_TARGET_BY_GOOD_ID.stone ?? 0) + extraGatherers('stone', LATE_GAME_FROM_TICKS)).toBe(4);
    const late = () => ctxOf(sim, LATE_GAME_FROM_TICKS);
    const lateLines = supplyLines(ctxOf(sim).content, DEFAULT_BUILD_ORDER, 'late');
    for (const good of [WOOD, STONE]) {
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, lateLines.get(good)?.glut ?? 0);
    }

    const commands = [...collectModule.run(sim.world, late(), SEAT)];
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    // First posts in plan order, then the stone/wood top-ups (mud stays at one): 3 first posts, the
    // scout, the HQ's two late-game carriers and the late-game builder reserve claimed, the top-ups take
    // the four men left, stone's three before wood's, and nobody is left to go generic.
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD, STONE, STONE, STONE, WOOD]);
    // Each post gets a node of its own. A good's top-up re-derives the same nearest resource as its
    // first post, so without the decision's claimed-node set the two flags land on one tile - one
    // delivery yard, one pile cap, two gatherers.
    const spots = commands.filter((c) => c.kind === 'setWorkFlag').map((c) => `${c.x},${c.y}`);
    expect(new Set(spots).size).toBe(spots.length);

    // Every post is recognized on the next decision - no churn, nothing left to do.
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    expect([...collectModule.run(sim.world, late(), SEAT)]).toEqual([]);
  });

  it("keeps the opening to one post per building good, then posts the sites' shortage gatherers out of the reserve", () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, BUILDER_CAP + 4);
    sim.step();
    const decideAt = (tick: number) => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const builders = () =>
      [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === BUILDER);
    // 3 first posts, the scout and the builder reserve claim every man. The store is empty, so both goods
    // run short, but the opening keeps its men building: nothing else is posted.
    expect(posted(decideAt(0))).toEqual([MUD, STONE, WOOD]);
    expect(posted(decideAt(0))).toEqual([]);
    expect(builders()).toHaveLength(BUILDER_CAP);
    // From the growth clock the sites justify their shortage posts, one per good per decision, out of the
    // reserve.
    const sites = siteShortagePosts(BUILDING_GOODS_GROW_FROM_TICKS);
    for (let post = 0; post < sites; post++) {
      expect(posted(decideAt(BUILDING_GOODS_GROW_FROM_TICKS))).toEqual([STONE, WOOD]);
    }
    expect(posted(decideAt(BUILDING_GOODS_GROW_FROM_TICKS))).toEqual([]);
    expect(builders()).toHaveLength(BUILDER_CAP - 2 * sites);
  });

  /** The wood and stone rows of an HQ-only seat of `men` at `tick`, the store holding `stock` of each. */
  const buildingPosts = (
    men: number,
    tick: number,
    stock: (lines: SupplyLines) => number,
  ): (Pick<WantedGood, 'target' | 'min'> | undefined)[] => {
    const sim = aiSim();
    const ctx = ctxOf(sim, tick);
    placeHq(sim);
    spawnMen(sim, men);
    sim.step();
    const lines = supplyLines(ctx.content, DEFAULT_BUILD_ORDER, gamePhase(tick));
    for (const good of [WOOD, STONE]) {
      const line = lines.get(good);
      if (line !== undefined) setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, stock(line));
    }
    return [WOOD, STONE].map((good) => {
      const row = wantedRow(sim, ctx, good);
      return row === undefined ? undefined : { target: row.target, min: row.min };
    });
  };
  const woodBase = COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0;
  const stoneBase = COLLECTOR_TARGET_BY_GOOD_ID.stone ?? 0;
  const LARGE_SEAT = 60;

  it('grows both targets from the mid game on, at the top-up tier, whatever the stock', () => {
    // Both goods stocked past the glut: only the schedule rides on the target and only the base row
    // jumps the builder reserve, whatever the crew. Until the mid game the schedule adds nothing; from
    // then the posts clear ground for the late-game buildings, so they come whatever the stock.
    const glut = (lines: SupplyLines) => lines.glut;
    for (const tick of [
      BUILDING_GOODS_GROW_FROM_TICKS - 1,
      BUILDING_GOODS_GROW_FROM_TICKS,
      MID_GAME_FROM_TICKS - 1,
    ]) {
      expect(buildingPosts(LARGE_SEAT, tick, glut)).toEqual([
        { target: woodBase, min: woodBase },
        { target: stoneBase, min: stoneBase },
      ]);
    }
    expect(buildingPosts(1, MID_GAME_FROM_TICKS, glut)).toEqual([
      { target: woodBase + 3, min: woodBase },
      { target: stoneBase + 2, min: stoneBase },
    ]);
    expect(buildingPosts(1, LATE_GAME_FROM_TICKS, glut)).toEqual([
      { target: woodBase + 4, min: woodBase },
      { target: stoneBase + 3, min: stoneBase },
    ]);
  });

  it("posts the sites' own shortage gatherers from the growth clock, with no workshop consuming the good", () => {
    // An empty store lies every unit under the line: the first minutes still hold to their one post each,
    // from the growth clock the sites justify their shortage posts, all ahead of the reserve.
    const empty = () => 0;
    expect(buildingPosts(LARGE_SEAT, BUILDING_GOODS_GROW_FROM_TICKS - 1, empty)).toEqual([
      { target: woodBase, min: woodBase },
      { target: stoneBase, min: stoneBase },
    ]);
    const wood = woodBase + siteShortagePosts(BUILDING_GOODS_GROW_FROM_TICKS);
    const stone = stoneBase + siteShortagePosts(BUILDING_GOODS_GROW_FROM_TICKS);
    expect(buildingPosts(LARGE_SEAT, BUILDING_GOODS_GROW_FROM_TICKS, empty)).toEqual([
      { target: wood, min: wood },
      { target: stone, min: stone },
    ]);
    // The opening hires them only under the short line.
    expect(buildingPosts(LARGE_SEAT, BUILDING_GOODS_GROW_FROM_TICKS, (l) => l.short)).toEqual([
      { target: woodBase, min: woodBase },
      { target: stoneBase, min: stoneBase },
    ]);
  });

  it("posts one more wood gatherer behind the builder reserve while the joinery eats the sites' wood", () => {
    // The joinery's recipes consume wood, the crew is the previous case's: nothing past the reserve. In
    // the opening the extra post is a top-up (authored: a small seat keeps its men building), so it
    // waits for a man past the reserve.
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    placeWorkshop(sim, JOINERY_TYPE);
    spawnMen(sim, BUILDER_CAP + 4);
    sim.step();
    const decide = () => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const woodTarget = COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0;
    // With no wood the gap spans three units, so the joinery's two planned joiners cap the extra posts at
    // one.
    const lines = supplyLines(ctxOf(sim).content, DEFAULT_BUILD_ORDER).get(WOOD);
    expect(lines).toMatchObject(FIXTURE_WOOD_LINES);
    const woodComfort = lines?.comfort ?? 0;

    expect(posted(decide())).toEqual([MUD, STONE, WOOD]);
    expect(posted(decide())).toEqual([]); // the shortage post waits: the reserve took everyone
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget);
    // Three men past the reserve: the builder the joiner's post took is replaced first, then the joinery's
    // second joiner, then the shortage post.
    spawnMen(sim, 3);
    sim.step();
    expect(posted(decide())).toEqual([WOOD]);
    expect(posted(decide())).toEqual([]);
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget + 1);

    // The engaged post reads the comfort line: one unit short keeps the extra man, the comfort line not
    // (his flag goes to the generic rung, since the reserve stands).
    const hq = entityOfBuilding(sim, HQ_TYPE);
    setStockAmount(sim.world, hq, WOOD, woodComfort - 1);
    decide();
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget + 1);
    setStockAmount(sim.world, hq, WOOD, woodComfort);
    decide();
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget);
  });

  it('scales the shortage posts with the gap in units, at most one per two planned consumers', () => {
    const sim = aiSim();
    const ctx = ctxOf(sim);
    placeHq(sim);
    placeWorkshop(sim, JOINERY_TYPE);
    sim.step();
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const woodTarget = COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0;
    const extraWood = (stock: number): number => {
      setStockAmount(sim.world, hq, WOOD, stock);
      return (wantedTarget(sim, ctx, WOOD) ?? 0) - woodTarget;
    };
    expect(supplyLines(ctx.content, DEFAULT_BUILD_ORDER).get(WOOD)).toMatchObject(FIXTURE_WOOD_LINES);

    // One joinery plans two joiners: a gap of three units still gets one extra gatherer.
    expect(extraWood(0)).toBe(1);
    placeWorkshop(sim, JOINERY_TYPE, SECOND_WORKSHOP_SPOT);
    placeWorkshop(sim, JOINERY_TYPE, THIRD_WORKSHOP_SPOT);
    sim.step();
    const { short } = FIXTURE_WOOD_LINES;
    expect(extraWood(0)).toBe(3); // 18 under comfort: three units, six joiners allow three
    expect(extraWood(short - 1)).toBe(2); // 7 under comfort: two units
    expect(extraWood(short)).toBe(0); // at the short line, with no post engaged
  });

  it('from the mid game hires wood gatherers under the comfort line and holds them to the glut', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    placeWorkshop(sim, JOINERY_TYPE);
    spawnMen(sim, BUILDER_CAP + 4);
    sim.step();
    const hq = entityOfBuilding(sim, HQ_TYPE);
    // The mid game's wood target, its base row plus the clock's extra post.
    const woodTarget = (COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0) + extraGatherers('wood', MID_GAME_FROM_TICKS);
    const decideAt = (tick: number) => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const mid = () => decideAt(MID_GAME_FROM_TICKS);
    const supply = SeatSupply.of(
      sim.world,
      ctxOf(sim, MID_GAME_FROM_TICKS),
      SEAT,
      ownedBuildings(sim.world, SEAT),
      DEFAULT_BUILD_ORDER,
    );
    const lines = supply.lines(WOOD);
    const stone = supply.lines(STONE);
    if (lines === undefined || stone === undefined) throw new Error('expected managed wood and stone');
    expect(lines.glut).toBeGreaterThan(lines.comfort);
    // Stone stocked past its glut, so only wood posts ride on the sites.
    setStockAmount(sim.world, hq, STONE, stone.glut);

    // At the comfort line nothing is short: only the first posts; the schedule's posts wait behind the
    // reserve, which takes every other man.
    setStockAmount(sim.world, hq, WOOD, lines.comfort);
    expect(posted(mid())).toEqual([MUD, STONE, WOOD]);
    expect(posted(mid())).toEqual([]);
    // One unit under comfort: the opening still waits for the short line, the mid game raises the target
    // and fills every post of it ahead of the reserve, one per decision.
    setStockAmount(sim.world, hq, WOOD, lines.comfort - 1);
    expect(posted(decideAt(0))).toEqual([]);
    // Every post past the row's one, up to the target plus the shortage posts: the gap to the glut spans
    // more units than the sites' cap, which the joinery's one post lies inside.
    const extra = siteShortagePosts(MID_GAME_FROM_TICKS);
    for (let post = woodBase; post < woodTarget + extra; post++) expect(posted(mid())).toEqual([WOOD]);
    expect(posted(mid())).toEqual([]);
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget + extra);

    // The engaged posts hold past comfort toward the glut line: one unit under it one post's lack remains
    // and the posts keep one man over that, so the rest retire; at the glut every one goes.
    const retired = (commands: readonly Command[]) =>
      commands.filter((c) => c.kind === 'setJob' && c.jobType === BUILDER);
    const lackingNearGlut = 1;
    const kept = Math.min(extra, lackingNearGlut + 1);
    setStockAmount(sim.world, hq, WOOD, lines.glut - 1);
    expect(retired(mid())).toHaveLength(extra - kept);
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget + kept);
    setStockAmount(sim.world, hq, WOOD, lines.glut);
    expect(retired(mid())).toHaveLength(kept);
    expect(holdersOf(sim, WOOD)).toHaveLength(woodTarget);
  });

  it("adds collect-anything gatherers as the seat's farthest home moves away from the base", () => {
    const HQ_AT = { x: 8, y: 16 };
    const homeAt = (distance: number) => {
      const sim = aiSim();
      placeHq(sim, HQ_AT.x, HQ_AT.y);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HQ_AT.x + distance,
        y: HQ_AT.y,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      return farGroundExtras(sim.world, ctxOf(sim), ownedBuildings(sim.world, SEAT), {
        hx: HQ_AT.x,
        hy: HQ_AT.y,
      });
    };
    expect(homeAt(CLEAR_GROUND_FROM_NODES + NODES_PER_CLEARING_GATHERER - 1)).toBe(0);
    expect(homeAt(CLEAR_GROUND_FROM_NODES + NODES_PER_CLEARING_GATHERER)).toBe(1);
    expect(homeAt(CLEAR_GROUND_FROM_NODES + 2 * NODES_PER_CLEARING_GATHERER)).toBe(2);
    expect(2).toBeLessThan(MAX_CLEARING_COLLECTORS);

    // The ladder posts them at its generic rung: two more collect-anything flags than a compact seat's.
    const genericPosts = (distance: number | null): number => {
      const sim = aiSim();
      placeHq(sim, HQ_AT.x, HQ_AT.y);
      placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
      if (distance !== null) {
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: HOME_TYPE,
          x: HQ_AT.x + distance,
          y: HQ_AT.y,
          tribe: VIKING,
          owner: SEAT,
        });
      }
      spawnMen(sim, BUILDER_CAP + 20);
      sim.step();
      return [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'setGatherGood' && c.goodType === null,
      ).length;
    };
    expect(genericPosts(null)).toBe(GENERIC_COLLECTOR_TARGET);
    expect(genericPosts(CLEAR_GROUND_FROM_NODES + 2 * NODES_PER_CLEARING_GATHERER)).toBe(
      GENERIC_COLLECTOR_TARGET + 2,
    );
  });

  it('keeps four builders when a shortage post beyond the first would take one', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    placeWorkshop(sim, JOINERY_TYPE);
    // Four men for the first posts and the scout, then builders: one for the joiner, two past the floor.
    // From the follow-sites clock, when every open site's shortage posts jump the reserve; the store is
    // empty, so wood and stone both want two.
    spawnMen(sim, 4);
    spawnMen(sim, SHORTAGE_BUILDER_FLOOR + 3, BUILDER);
    sim.step();
    const tick = BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS;
    expect(siteShortagePosts(tick)).toBe(2);
    const decide = () => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const builders = () =>
      [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === BUILDER);

    const first = decide();
    expect(posted(first)).toEqual([MUD, STONE, WOOD]);
    expect(first.filter((c) => c.kind === 'setJob' && c.jobType === SCOUT)).toHaveLength(1);
    expect(builders()).toHaveLength(SHORTAGE_BUILDER_FLOOR + 2); // the joiner came out of the builders
    expect(posted(decide())).toEqual([STONE, WOOD]); // the sites' first shortage posts: two builders go
    expect(builders()).toHaveLength(SHORTAGE_BUILDER_FLOOR);
    expect(posted(decide())).toEqual([]); // both still want one more, but not from the last four
    expect(builders()).toHaveLength(SHORTAGE_BUILDER_FLOOR);

    // A man of another trade still takes the post, stone's first in plan order.
    spawnMen(sim, 1);
    sim.step();
    expect(posted(decide())).toEqual([STONE]);
    expect(builders()).toHaveLength(SHORTAGE_BUILDER_FLOOR);
    expect(holdersOf(sim, STONE)).toHaveLength((COLLECTOR_TARGET_BY_GOOD_ID.stone ?? 0) + 2);
  });

  it("hands a collect-anything gatherer to a short good's post before it takes a builder", () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    // Two men past the first posts, the scout and the full reserve: the generic posts take them.
    spawnMen(sim, BUILDER_CAP + 4 + GENERIC_COLLECTOR_TARGET);
    sim.step();
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const comfort = supplyLines(ctxOf(sim).content, DEFAULT_BUILD_ORDER).get(WOOD)?.comfort ?? 0;
    for (const good of [WOOD, STONE]) setStockAmount(sim.world, hq, good, comfort);
    const decideAt = (tick: number) => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const generic = () =>
      [...sim.world.query(Settler, WorkFlag)].filter(
        (e) => sim.world.get(e, WorkFlag).goodType === undefined,
      );
    const builders = () =>
      [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === BUILDER);
    expect(posted(decideAt(0))).toEqual([MUD, STONE, WOOD, null, null]);
    expect(posted(decideAt(0))).toEqual([]);
    expect(generic()).toHaveLength(GENERIC_COLLECTOR_TARGET);
    expect(builders()).toHaveLength(BUILDER_CAP);

    // Wood runs out from the growth clock: its shortage post takes one of the two collect-anything men,
    // and the reserve stands whole.
    setStockAmount(sim.world, hq, WOOD, 0);
    const beforeShortage = generic();
    const shortage = decideAt(BUILDING_GOODS_GROW_FROM_TICKS);
    expect(posted(shortage)).toEqual([WOOD]);
    const post = shortage.find((c) => c.kind === 'setGatherGood');
    expect(post !== undefined && beforeShortage.includes(post.entity)).toBe(true);
    expect(builders()).toHaveLength(BUILDER_CAP);
    expect(generic()).toHaveLength(GENERIC_COLLECTOR_TARGET - 1);
    expect(posted(decideAt(BUILDING_GOODS_GROW_FROM_TICKS))).toEqual([]);
  });

  it('sends extra generic gatherers to clear ground while a placement is stalled, ahead of the carriers', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, BUILDER_CAP + 7);
    makeAiSeat(sim, SEAT);
    sim.step();
    const carrier = aiPlayerEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([[0, Number.MAX_SAFE_INTEGER]]),
      holding: 0,
    });

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    // The same men as the unstalled ladder above call for three clearing posts, and the reserve shrinks to
    // its stalled floor: after 3 first posts, the scout and that floor, the generic and clearing posts
    // come ahead of the carriers.
    const clearing = Math.floor((BUILDER_CAP + 7) / CIVILIANS_PER_CLEARING_COLLECTOR);
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    expect(selections.map((s) => s.goodType)).toEqual([
      MUD,
      STONE,
      WOOD,
      ...Array(GENERIC_COLLECTOR_TARGET + clearing).fill(null),
    ]);
    expect(commands.filter((c) => c.kind === 'setJob' && c.jobType === BUILDER)).toHaveLength(
      STALLED_BUILDER_CAP,
    );
    const hq = entityOfBuilding(sim, HQ_TYPE);
    expect(commands.filter((c) => c.kind === 'assignWorker' && c.building === hq)).toEqual([]);

    // Every clearing post is recognized while the stall lasts - nothing is re-hired.
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setGatherGood'),
    ).toEqual([]);
  });

  it('fans the clearing posts out over the wood first, then the stone, never the clay', () => {
    // The clay lies nearest the base, the wood and the stone stand on two sides of it, farther apart than
    // the spread. The first two generic posts go beside the wood and the stone; the rest, with no clearing
    // good clear of both, double up on the wood.
    const sim = aiSim();
    placeHq(sim);
    const NEAR_MUD = { ...RESOURCE_SPOTS.mud, x: HQ_X - 6, y: HQ_Y };
    const WEST_STONE = { ...RESOURCE_SPOTS.stone, x: HQ_X - 20, y: HQ_Y };
    const EAST_WOOD = { ...RESOURCE_SPOTS.wood, x: HQ_X + 20, y: HQ_Y };
    placeResources(sim, [NEAR_MUD, WEST_STONE, EAST_WOOD]);
    expect(WEST_STONE.x + CLEARING_SPREAD_NODES).toBeLessThan(EAST_WOOD.x);
    expect(EAST_WOOD.x - HQ_X).toBeLessThan(HQ_X - WEST_STONE.x + WOOD_OVER_STONE_NODES);
    spawnMen(sim, BUILDER_CAP + 7);
    makeAiSeat(sim, SEAT);
    sim.step();
    const carrier = aiPlayerEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([[0, Number.MAX_SAFE_INTEGER]]),
      holding: 0,
    });

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const generic = new Set(
      commands.flatMap((c) => (c.kind === 'setGatherGood' && c.goodType === null ? [c.entity] : [])),
    );
    const flags = commands.flatMap((c) =>
      c.kind === 'setWorkFlag' && generic.has(c.entity) ? [Math.sign(c.x - HQ_X)] : [],
    );
    expect(flags.length).toBeGreaterThan(2);
    expect(flags).toEqual([1, -1, ...Array(flags.length - 2).fill(1)]);
  });

  it('ignores a stall record the switched-off build order can no longer clear', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, 15);
    makeAiSeat(sim, SEAT, { houseBuild: false });
    sim.step();
    const carrier = aiPlayerEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([[0, Number.MAX_SAFE_INTEGER]]),
      holding: 0,
    });

    const selections = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
      (c) => c.kind === 'setGatherGood',
    );
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
  });

  it('moves a generic collector whose circle holds nothing its trade can harvest, or retires it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: gatherer missing');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: 12, y: 12 });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: gatherer, goodType: null });
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => c.kind === 'setJob' && c.entity === gatherer)).toEqual([
      { kind: 'setJob', entity: gatherer, jobType: BUILDER },
    ]);

    // With a collected good standing past the circle, the flag moves there instead.
    const FAR = { x: 56, y: 28 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.wood, ...FAR }]);
    sim.step();
    const moved = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
      (c) => (c.kind === 'setJob' || c.kind === 'setWorkFlag') && c.entity === gatherer,
    );
    expect(moved).toHaveLength(1);
    const [flag] = moved;
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the generic flag to move');
    expect(Math.abs(flag.x - FAR.x) + Math.abs(flag.y - FAR.y)).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
  });

  it('moves a generic flag whose circle holds only a good the holder lacks the experience for', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR = { x: 56, y: 28 };
    placeResources(sim, [RESOURCE_SPOTS.iron, { ...RESOURCE_SPOTS.wood, ...FAR }]);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, x: 14, y: 24, tribe: VIKING, owner: SEAT });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: gatherer missing');
    const IRON_FLAG = { x: RESOURCE_SPOTS.iron.x + FLAG_MIN_DISTANCE_NODES, y: RESOURCE_SPOTS.iron.y };
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, ...IRON_FLAG });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: gatherer, goodType: null });
    sim.step();

    // His trade digs iron, but a fresh hire has no XP for it: the circle is dead to him.
    const moved = [...collectModule.run(sim.world, ctxOf(sim, AI_DECISION_INTERVAL_TICKS), SEAT)].filter(
      (c) => (c.kind === 'setJob' || c.kind === 'setWorkFlag') && c.entity === gatherer,
    );
    expect(moved).toHaveLength(1);
    const [flag] = moved;
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the generic flag to move');
    expect(Math.abs(flag.x - FAR.x) + Math.abs(flag.y - FAR.y)).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
  });

  it('moves a working generic flag beside a collected good standing well nearer the base, on the upkeep', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR = { x: 56, y: 28 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.wood, ...FAR }]);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, x: 52, y: 26, tribe: VIKING, owner: SEAT });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: gatherer missing');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: FAR.x - FLAG_MIN_DISTANCE_NODES, y: FAR.y });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: gatherer, goodType: null });
    const NEAR = { x: 38, y: 24 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.wood, ...NEAR }]);
    sim.step();

    const flagMoves = (tick: number) =>
      [...collectModule.run(sim.world, ctxOf(sim, tick), SEAT)].filter(
        (c) => c.kind === 'setWorkFlag' && c.entity === gatherer,
      );
    // A live patch is left alone on an ordinary decision…
    expect(flagMoves(AI_DECISION_INTERVAL_TICKS)).toEqual([]);
    // …and follows the nearer resource on the periodic upkeep.
    const [moved] = flagMoves(AI_DECISION_INTERVAL_TICKS * FLAG_RELOCATE_EVERY_DECISIONS);
    if (moved?.kind !== 'setWorkFlag') throw new Error('expected the generic flag to move');
    expect(Math.abs(moved.x - NEAR.x) + Math.abs(moved.y - NEAR.y)).toBeLessThanOrEqual(
      FLAG_MAX_DISTANCE_NODES,
    );
  });

  it('adds a clay gatherer for the pottery tier that plans a second potter', () => {
    const content = workshopContent();
    const mudTargetWith = (pottery: number): number | undefined => {
      const sim = aiSim(1, content);
      const ctx = { ...ctxOf(sim), content };
      placeHq(sim);
      placeWorkshop(sim, pottery);
      sim.step();
      stockAtComfort(sim, ctx, MUD);
      return wantedTarget(sim, ctx, MUD);
    };
    // Two planned operators per extra gatherer: the first tier plans one potter, the upgraded one two.
    expect(mudTargetWith(POTTERY_00_TYPE)).toBe(DEFAULT_COLLECTOR_TARGET);
    expect(mudTargetWith(POTTERY_01_TYPE)).toBe(DEFAULT_COLLECTOR_TARGET + 1);
  });

  it('holds iron at its entry count until built smithies plan more smiths', () => {
    const content = workshopContent();
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    placeHq(sim);
    sim.step();
    stockAtComfort(sim, ctx, IRON);
    const ironTarget = (count: number): number | undefined =>
      wantedTarget(sim, ctx, IRON, [{ kind: 'collector', good: 'iron', count }]);

    expect(ironTarget(1)).toBe(1); // the joinery-time entry: one gatherer, not a smithy crew's
    placeWorkshop(sim, SMITHY_TYPE);
    sim.step();
    expect(ironTarget(1)).toBe(2); // two planned smiths
    placeWorkshop(sim, SMITHY_TYPE, SECOND_WORKSHOP_SPOT);
    sim.step();
    expect(ironTarget(1)).toBe(3);
    expect(ironTarget(2)).toBe(4); // the growth stacks on a larger entry count
  });

  it('keeps a short iron post behind the builder reserve: only the building goods jump it', () => {
    const content = workshopContent();
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    placeHq(sim);
    placeWorkshop(sim, SMITHY_TYPE);
    sim.step();
    const entry: BuildOrderEntry[] = [{ kind: 'collector', good: 'iron', count: 1 }];
    const iron = wantedRow(sim, ctx, IRON, entry);
    expect(iron?.target).toBe(3); // the entry's one, one grown, one for the shortage
    expect(iron?.min).toBe(1);
  });

  it("never governs a reached entry's gatherers below its count", () => {
    const content = workshopContent();
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    placeHq(sim);
    sim.step();
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const IRON_ENTRY = 3;
    const WOOD_ENTRY = (COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0) + 2;
    const order: BuildOrderEntry[] = [
      { kind: 'collector', good: 'iron', count: IRON_ENTRY },
      { kind: 'collector', good: 'wood', count: WOOD_ENTRY },
    ];
    const targets = (): [number | undefined, number | undefined] => [
      wantedTarget(sim, ctx, IRON, order),
      wantedTarget(sim, ctx, WOOD, order),
    ];
    const stockAt = (line: 'glut' | 'none'): void => {
      for (const good of [IRON, WOOD]) {
        const glut = supplyLines(content, DEFAULT_BUILD_ORDER).get(good)?.glut ?? 0;
        setStockAmount(sim.world, hq, good, line === 'glut' ? glut : 0);
      }
    };

    // No consumer, then consumers with glutted stock, then consumers with nothing in stock.
    for (const stage of ['no consumer', 'glut', 'short'] as const) {
      if (stage === 'glut') {
        placeWorkshop(sim, SMITHY_TYPE);
        placeWorkshop(sim, JOINERY_TYPE, SECOND_WORKSHOP_SPOT);
        sim.step();
      }
      stockAt(stage === 'short' ? 'none' : 'glut');
      const [iron, wood] = targets();
      expect(iron, stage).toBeGreaterThanOrEqual(IRON_ENTRY);
      expect(wood, stage).toBeGreaterThanOrEqual(WOOD_ENTRY);
    }
  });

  it("raises a good's gatherer target to the count its reached collector entry asks for", () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const ctx = ctxOf(sim);
    const ironTarget = (count: number, status: 'unmet' | 'skip'): number | undefined => {
      const order: BuildOrderEntry[] = [{ kind: 'collector', good: 'iron', count }];
      const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), order);
      return wantedCollectorGoods(sim.world, ctx, SEAT, order, [status], supply).find(
        (w) => w.good.typeId === IRON,
      )?.target;
    };
    const IRON_BASE_TARGET = COLLECTOR_TARGET_BY_GOOD_ID.iron ?? DEFAULT_COLLECTOR_TARGET;
    expect(ironTarget(IRON_BASE_TARGET + 2, 'unmet')).toBe(IRON_BASE_TARGET + 2);
    expect(ironTarget(1, 'unmet')).toBe(IRON_BASE_TARGET); // a smaller count never lowers the plan
    expect(ironTarget(IRON_BASE_TARGET + 2, 'skip')).toBeUndefined(); // a skipped entry wants nobody
  });

  it('grows the builder reserve with the settlement, and again from the late game whatever its size', () => {
    expect(builderCap(LATE_GAME_CIVILIANS - 1, 0)).toBe(BUILDER_CAP);
    expect(builderCap(LATE_GAME_CIVILIANS, 0)).toBe(GROWN_SEAT_BUILDER_CAP);
    expect(builderCap(LATE_GAME_CIVILIANS, LATE_GAME_FROM_TICKS - 1)).toBe(GROWN_SEAT_BUILDER_CAP);
    expect(builderCap(0, LATE_GAME_FROM_TICKS)).toBe(LATE_GAME_BUILDER_CAP);
    expect(LATE_GAME_BUILDER_CAP).toBeGreaterThan(GROWN_SEAT_BUILDER_CAP);
  });

  it("follows one site's drain from the growth clock and every open site's from the follow-sites clock", () => {
    expect(siteShortagePosts(BUILDING_GOODS_GROW_FROM_TICKS - 1)).toBe(0);
    expect(siteShortagePosts(BUILDING_GOODS_GROW_FROM_TICKS)).toBe(OPENING_SITE_SHORTAGE_POSTS);
    expect(siteShortagePosts(BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS - 1)).toBe(OPENING_SITE_SHORTAGE_POSTS);
    expect(siteShortagePosts(BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS)).toBe(
      sitePace(BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS).sites,
    );
    expect(sitePace(BUILDING_GOODS_FOLLOW_SITES_FROM_TICKS).sites).toBeGreaterThan(
      OPENING_SITE_SHORTAGE_POSTS,
    );
    expect(siteShortagePosts(LATE_GAME_FROM_TICKS)).toBe(sitePace(LATE_GAME_FROM_TICKS).sites);
  });

  it('claims at most the builder reserve; leftover men keep their trade', () => {
    const sim = aiSim();
    placeHq(sim);
    // No resources: no collectors wanted, and a small seat's HQ takes no carrier - the ladder is scout +
    // the reserve.
    spawnMen(sim, BUILDER_CAP + 6);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const builders = commands.filter((c) => c.kind === 'setJob').filter((c) => c.jobType === BUILDER);
    expect(builders).toHaveLength(BUILDER_CAP);
    // The scout and the reserve are claimed; the five leftovers get NO order - the cap never
    // over-converts.
    const ordered = new Set(
      commands.flatMap((c) => (c.kind === 'setJob' || c.kind === 'assignWorker' ? [c.entity] : [])),
    );
    expect(ordered.size).toBe(BUILDER_CAP + 1);
  });

  it('moves a collector flag when its patch runs dry, and retires the collector when the map is', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.wood]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();

    // Drain the standing node and offer a fresh one across the map - outside the flag's circle.
    const FAR = { x: 8, y: 24 };
    for (const e of sim.world.query(Resource)) sim.world.mut(e, Resource).remaining = 0;
    sim.enqueueSetup({
      kind: 'placeResource',
      good: WOOD,
      x: FAR.x,
      y: FAR.y,
      remaining: 5,
      harvestAtomic: WOOD_HARVEST,
    });
    sim.step();
    const move = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const flag = move.find((c) => c.kind === 'setWorkFlag');
    if (flag === undefined) throw new Error('expected the flag to move to the fresh resource');
    const dist = Math.abs(flag.x - FAR.x) + Math.abs(flag.y - FAR.y);
    expect(dist).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
    expect(dist).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);

    // With every wood node gone the collector rejoins the builder pool.
    for (const e of sim.world.query(Resource)) sim.world.mut(e, Resource).remaining = 0;
    const retire = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const collector = [...sim.world.query(Settler, WorkFlag)][0];
    expect(retire).toEqual([{ kind: 'setJob', entity: collector, jobType: BUILDER }]);
  });

  it('staffs the farm with one farmer at the minimum, never the carrier slot', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: FARM_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    // No resources on this map: no collectors are wanted, staffing draws straight from the builders.
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === farm);
    // One farmer despite 4 farmer slots; the second and third wait for the target tier behind the
    // builder reserve, and the farm's carrier slot is never filled.
    expect(staffing.map((c) => c.jobPriority)).toEqual([[FARMER]]);
  });

  it('adds the second farmer at the target tier; the third waits for the last surplus tier', () => {
    const staffFarm = (men: number): number => {
      const sim = aiSim();
      placeHq(sim);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: FARM_TYPE,
        x: 40,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      spawnMen(sim, men, BUILDER);
      sim.step();
      const farm = entityOfBuilding(sim, FARM_TYPE);
      return [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'assignWorker' && c.building === farm,
      ).length;
    };
    // Scout + farm minimum + the builder reserve + the target-tier second farmer claim everyone; a small
    // seat's HQ takes no carrier.
    expect(staffFarm(BUILDER_CAP + 3)).toBe(2);
    // One more man clears every target post, and the surplus tier seats the third farmer.
    expect(staffFarm(BUILDER_CAP + 4)).toBe(3);
  });

  it('gives the iron-tool joinery a second joiner only out of the surplus', () => {
    const staffJoinery = (men: number): number => {
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
      spawnMen(sim, men, BUILDER);
      sim.step();
      const joinery = entityOfBuilding(sim, JOINERY_TYPE);
      return [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'assignWorker' && c.building === joinery && c.jobPriority[0] === JOINER,
      ).length;
    };
    // A thin crew crews the shop once; the second seat waits behind the builder reserve.
    expect(staffJoinery(6)).toBe(1);
    expect(staffJoinery(BUILDER_CAP + 6)).toBe(2);
  });

  it('staffs the HQ and a warehouse with three carriers each in the deep late game', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, LATE_GAME_CIVILIANS, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim, STORE_CARRIERS_FROM_TICKS), SEAT)];
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const stock = entityOfBuilding(sim, STOCK_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker');
    // The storage posts are surplus-tier extras, so all six carriers come out of the men left
    // past the builder reserve and every target post. The collector slots both storages declare are
    // harvest trades and stay open.
    expect(staffing.filter((c) => c.building === hq).map((c) => c.jobPriority)).toEqual([
      [CARRIER],
      [CARRIER],
      [CARRIER],
    ]);
    expect(staffing.filter((c) => c.building === stock).map((c) => c.jobPriority)).toEqual([
      [CARRIER],
      [CARRIER],
      [CARRIER],
    ]);
  });

  it("staffs the bakery with its carrier on top of the baker (the plan's one carrier post)", () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === bakery);
    expect(staffing.map((c) => c.jobPriority)).toEqual([[BAKER], [CARRIER]]);
  });

  it('leaves a carrier-only workplace (the well) unstaffed, however grown the seat', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, LATE_GAME_CIVILIANS, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const well = entityOfBuilding(sim, WELL_TYPE);
    expect(commands.some((c) => c.kind === 'assignWorker' && c.building === well)).toBe(false);
  });

  it('hires the iron collector only once the build order reaches its gated entry', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    spawnMen(sim, 4);
    sim.step();
    // One man has dug stone before - iron's `needforgood` XP gate demands an experienced digger.
    const veteran = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
    if (veteran === undefined) throw new Error('setup: no spawned man');
    sim.world.mut(veteran, SettlerProgress).experience.set(STONE_XP_TRACK, IRON_GATE_XP);

    // The gate: iron is listed after the farm entry, so an unmet farm keeps it unwanted.
    const gated = workforceModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'collector', good: 'iron' },
    ]);
    const before = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(before.filter((c) => c.kind === 'setGatherGood')).toEqual([]);

    // A standing farm (any construction state counts) satisfies the entry - iron is now wanted,
    // and the hire lands on the one man whose XP clears the threshold.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: FARM_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const after = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(after.filter((c) => c.kind === 'setGatherGood')).toEqual([
      { kind: 'setGatherGood', entity: veteran, goodType: IRON },
    ]);
  });

  it('never trades one ungated good’s collector for another’s', () => {
    const sim = aiSim();
    placeHq(sim);
    // Stone and wood both stand, both ungated - and exactly one man, who takes the first post.
    placeResources(sim, [RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, 1);
    sim.step();
    const both = workforceModule([]);
    for (const c of both.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();

    // Wood has no collector and no spare man. Stealing stone's would only move the shortage, and
    // with a dry pool the two goods would swap the same man every decision, each swap dropping his
    // load. He stays on stone; wood waits for a fresh hire.
    const posted = [...sim.world.query(Settler, WorkFlag)];
    expect(posted.map((e) => sim.world.get(e, WorkFlag).goodType)).toEqual([STONE]);
    expect([...both.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('gates the iron post on accrued XP: fresh spares wait, a veteran digger is re-posted', () => {
    const sim = aiSim();
    placeHq(sim);
    // Three men: the stone hire, the scout the allocator also calls up, and the spare who later
    // backfills the vacated stone post.
    placeResources(sim, [RESOURCE_SPOTS.stone, RESOURCE_SPOTS.iron]);
    spawnMen(sim, 3);
    sim.step();
    const gated = workforceModule([{ kind: 'collector', good: 'iron' }]);

    // Fresh men: stone hires (ungated); iron finds no qualified spare and no veteran - it waits.
    const fresh = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(fresh.filter((c) => c.kind === 'setGatherGood').map((c) => c.goodType)).toEqual([STONE]);
    for (const c of fresh) sim.enqueueSetup(c);
    sim.step();

    // The stone collector has dug (its stone-track XP stands): the next decision re-posts IT onto
    // iron - the fresh spare still may not mine iron.
    const collector = [...sim.world.query(Settler, WorkFlag)][0];
    if (collector === undefined) throw new Error('setup: stone collector missing');
    sim.world.mut(collector, SettlerProgress).experience.set(STONE_XP_TRACK, IRON_GATE_XP);
    const swap = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(swap.filter((c) => c.kind === 'setGatherGood')).toEqual([
      { kind: 'setGatherGood', entity: collector, goodType: IRON },
    ]);
    const flag = swap.find((c) => c.kind === 'setWorkFlag');
    if (flag === undefined) throw new Error('expected the veteran flag beside the iron deposit');
    const toIron = Math.abs(flag.x - RESOURCE_SPOTS.iron.x) + Math.abs(flag.y - RESOURCE_SPOTS.iron.y);
    expect(toIron).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
    expect(toIron).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
    for (const c of swap) sim.enqueueSetup(c);
    sim.step();

    // The vacated stone post is rehired once a spare man exists again - self-healing. (The first
    // decision's ladder claimed every original man: collector, scout, HQ carrier.)
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, x: 6, y: 6, tribe: VIKING, owner: SEAT });
    sim.step();
    const rehire = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(rehire.filter((c) => c.kind === 'setGatherGood').map((c) => c.goodType)).toEqual([STONE]);
  });

  it('moves a flag off a deposit a building has buried, though the deposit is not dug out', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();

    // Walls over every cell a digger could stand on leave the deposit standing but out of reach; a fresh
    // one waits across the map.
    const terrain = sim.terrain;
    const buried = [...sim.world.query(Resource)].find((e) => sim.world.get(e, Resource).goodType === MUD);
    if (buried === undefined || terrain === undefined) throw new Error('setup: the deposit');
    const { x, y } = RESOURCE_SPOTS.mud;
    const anchor = terrain.nodeAt(x, y);
    const stance = [
      anchor,
      ...terrain.walkableNeighbours(anchor),
      ...resourceStanceCells(sim.world, terrain, buried),
    ];
    wallOver(
      sim,
      stance.map((cell) => ({ x: terrain.xOf(cell), y: terrain.yOf(cell) })),
    );
    const FRESH = { x: 50, y: 8 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...FRESH }]);
    sim.step();
    expect(workableResourceTest(sim.world, ctxOf(sim), terrain)(buried)).toBe(false);

    // An ordinary decision, not the periodic upkeep: a patch with nothing workable left is a dry one.
    const move = [...collectModule.run(sim.world, ctxOf(sim, AI_DECISION_INTERVAL_TICKS), SEAT)];
    const flag = move.find((c) => c.kind === 'setWorkFlag');
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the flag to move to the fresh deposit');
    expect(Math.abs(flag.x - FRESH.x) + Math.abs(flag.y - FRESH.y)).toBeLessThanOrEqual(
      FLAG_MAX_DISTANCE_NODES,
    );
  });

  it('moves a flag whose deposit the holder cannot reach from it, though another side is clear', () => {
    const content = shedContent();
    const sim = aiSim(1, content);
    const ctxAt = (tick = 0): SystemContext => ({ ...ctxOf(sim, tick), content });
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxAt(), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const terrain = sim.terrain;
    const deposit = [...sim.world.query(Resource)].find((e) => sim.world.get(e, Resource).goodType === MUD);
    const [holder] = holdersOf(sim, MUD);
    if (terrain === undefined || deposit === undefined || holder === undefined) throw new Error('setup');
    const flagAt = sim.world.get(sim.world.get(holder, WorkFlag).flag, Position);
    const flagNode = nodeOfPosition(flagAt.x, flagAt.y);

    // A shed on the one stance cell the gatherer walks to from his flag: the deposit keeps clear sides, but
    // he would never dig it from here. A fresh deposit waits across the map.
    const stance = resourceWorkCell(sim.world, terrain, deposit, terrain.nodeAt(flagNode.hx, flagNode.hy));
    const x = terrain.xOf(stance);
    const y = terrain.yOf(stance);
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: SHED_TYPE, x, y, tribe: VIKING, owner: SEAT });
    const FRESH = { x: 50, y: 8 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...FRESH }]);
    sim.step();
    expect(workableResourceTest(sim.world, ctxAt(), terrain)(deposit)).toBe(true);
    const radius = sim.world.get(holder, WorkFlag).radius;
    const reach = gathererReach(sim.world, ctxAt(), terrain);
    expect(reach.patchHarvestable(holder, flagNode, radius, (g) => g === MUD)).toBe(false);

    const move = [...collectModule.run(sim.world, ctxAt(AI_DECISION_INTERVAL_TICKS), SEAT)];
    const flag = move.find((c) => c.kind === 'setWorkFlag' && c.entity === holder);
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the flag to move');
    expect(flag.x !== flagNode.hx || flag.y !== flagNode.hy).toBe(true);
    expect(reach.patchHarvestable(holder, { hx: flag.x, hy: flag.y }, radius, (g) => g === MUD)).toBe(true);
  });

  it('moves a flag whose deposit a blocker ring seals off, though the ring leaves the stance cells clear', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const terrain = sim.terrain;
    const deposit = [...sim.world.query(Resource)].find((e) => sim.world.get(e, Resource).goodType === MUD);
    const [holder] = holdersOf(sim, MUD);
    if (terrain === undefined || deposit === undefined || holder === undefined) throw new Error('setup');
    const at = sim.world.get(deposit, Position);
    const depositNode = nodeOfPosition(at.x, at.y);
    // The flag steps out to where the ring below leaves it on open ground, still within its circle.
    const FLAG_AWAY = { hx: depositNode.hx + 6, hy: depositNode.hy + 6 };
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: holder, x: FLAG_AWAY.hx, y: FLAG_AWAY.hy });
    sim.step();
    const flagAt = sim.world.get(sim.world.get(holder, WorkFlag).flag, Position);
    const flagNode = nodeOfPosition(flagAt.x, flagAt.y);
    expect(flagNode).toEqual(FLAG_AWAY);

    // A ring of blockers three pathfinder steps out seals the deposit and its stance cells into a pocket
    // the flag stands outside of: the cells stay clear ground, but no walk from the flag reaches them.
    const SEAL_DEPTH = 3;
    const depth = new Map<NodeId, number>([[terrain.nodeAt(depositNode.hx, depositNode.hy), 0]]);
    const queue: NodeId[] = [...depth.keys()];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (node === undefined) continue;
      const d = depth.get(node);
      if (d === undefined || d >= SEAL_DEPTH) continue;
      for (const { node: next } of terrain.steps(node)) {
        if (depth.has(next)) continue;
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
    const ring = [...depth]
      .filter(([, d]) => d === SEAL_DEPTH)
      .map(([node]) => ({ x: terrain.xOf(node), y: terrain.yOf(node) }));
    expect(depth.has(terrain.nodeAt(flagNode.hx, flagNode.hy))).toBe(false);
    wallOver(sim, ring);
    const FRESH = { x: 50, y: 8 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...FRESH }]);
    sim.step();
    const radius = sim.world.get(holder, WorkFlag).radius;
    const reach = gathererReach(sim.world, ctxOf(sim), terrain);
    expect(reach.patchHarvestable(holder, flagNode, radius, (g) => g === MUD)).toBe(false);

    const move = [...collectModule.run(sim.world, ctxOf(sim, AI_DECISION_INTERVAL_TICKS), SEAT)];
    const flag = move.find((c) => c.kind === 'setWorkFlag' && c.entity === holder);
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the flag to leave the sealed deposit');
    expect(reach.patchHarvestable(holder, { hx: flag.x, hy: flag.y }, radius, (g) => g === MUD)).toBe(true);
  });

  it('moves a clay holder off a spent deposit beside the next live one', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const [holder] = holdersOf(sim, MUD);
    if (holder === undefined) throw new Error('setup: the clay holder');

    // The deposit is dug out; the next one stands across the map, far outside the flag's circle.
    for (const e of sim.world.query(Resource)) sim.world.mut(e, Resource).remaining = 0;
    const NEXT = { x: 56, y: 28 };
    placeResources(sim, [{ ...RESOURCE_SPOTS.mud, ...NEXT }]);
    sim.step();

    const move = [...collectModule.run(sim.world, ctxOf(sim, AI_DECISION_INTERVAL_TICKS), SEAT)];
    const flag = move.find((c) => c.kind === 'setWorkFlag' && c.entity === holder);
    if (flag?.kind !== 'setWorkFlag') throw new Error('expected the flag to follow the next deposit');
    expect(Math.abs(flag.x - NEXT.x) + Math.abs(flag.y - NEXT.y)).toBeLessThanOrEqual(
      FLAG_MAX_DISTANCE_NODES,
    );
    expect(move.filter((c) => c.kind === 'setJob' && c.entity === holder)).toEqual([]);
  });

  it('never aims a clay flag at a deposit across water: the good is dry for the seat and the holder retires', () => {
    const sim = waterSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const [holder] = holdersOf(sim, MUD);
    const terrain = sim.terrain;
    if (holder === undefined || terrain === undefined) throw new Error('setup: the clay holder');

    // The home deposit is dug out; the only live ones stand on the far bank, where his own harvest search
    // from any flag would find nothing either.
    for (const e of sim.world.query(Resource)) sim.world.mut(e, Resource).remaining = 0;
    placeResources(
      sim,
      FAR_BANK.map((spot) => ({ ...RESOURCE_SPOTS.mud, ...spot })),
    );
    sim.step();
    const flag = sim.world.get(holder, WorkFlag);
    const flagAt = sim.world.get(flag.flag, Position);
    const reach = gathererReach(sim.world, ctxOf(sim), terrain);
    expect(
      reach.patchHarvestable(holder, nodeOfPosition(flagAt.x, flagAt.y), flag.radius, (g) => g === MUD),
    ).toBe(false);

    const decision = [...collectModule.run(sim.world, ctxOf(sim, AI_DECISION_INTERVAL_TICKS), SEAT)];
    expect(decision.filter((c) => 'entity' in c && c.entity === holder)).toEqual([
      { kind: 'setJob', entity: holder, jobType: BUILDER },
    ]);
    // Nobody is re-hired onto the far bank either.
    expect(decision.filter((c) => c.kind === 'setGatherGood' && c.goodType === MUD)).toEqual([]);
  });

  it('keeps a dry-patch holder at his post when none of the three nearest deposits is workable', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();
    const [holder] = holdersOf(sim, MUD);
    const terrain = sim.terrain;
    if (holder === undefined || terrain === undefined) throw new Error('setup: the clay holder');
    const ctx = ctxOf(sim);
    const deposits = [...sim.world.query(Resource)];
    expect(deposits.length).toBeGreaterThan(0);
    const nearest = (open: (e: Entity) => boolean): Entity | null => deposits.find((e) => open(e)) ?? null;
    // A reach that refuses every deposit stands in for three unworkable ones: null, not dry, and the
    // callers issue nothing on null. With no candidate at all the answer is dry.
    const refusing = { canWork: () => false, patchHarvestable: () => false };
    const { radius } = sim.world.get(holder, WorkFlag);
    const origin = { hx: HQ_X, hy: HQ_Y };
    const ground = flagGround(sim.world, ctx, terrain, SEAT, origin);
    expect(replantSpot(sim.world, ground, holder, radius, nearest, origin, refusing, new Set())).toBeNull();
    expect(replantSpot(sim.world, ground, holder, radius, () => null, origin, refusing, new Set())).toBe(
      'dry',
    );
  });

  it('re-aims a live flag at its drifted patch on the periodic upkeep decision', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.wood]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueueSetup(c);
    sim.step();

    // Drain the original node; a survivor stands INSIDE the work circle but beyond the 2–3-tile
    // band (wherever in that band the flag stood), so the patch never runs dry and only the
    // periodic upkeep can move the flag.
    const DRIFTED = { x: RESOURCE_SPOTS.wood.x + 14, y: RESOURCE_SPOTS.wood.y };
    for (const e of sim.world.query(Resource)) sim.world.mut(e, Resource).remaining = 0;
    sim.enqueueSetup({
      kind: 'placeResource',
      good: WOOD,
      x: DRIFTED.x,
      y: DRIFTED.y,
      remaining: 5,
      harvestAtomic: WOOD_HARVEST,
    });
    sim.step();

    // An ordinary decision (the second of the run) leaves the live flag alone…
    expect([...collectModule.run(sim.world, ctxOf(sim, 24), SEAT)]).toEqual([]);
    // …the upkeep decision (every 30th - tick 720) re-plants it into the survivor's band.
    const upkeep = [...collectModule.run(sim.world, ctxOf(sim, 720), SEAT)];
    const moved = upkeep.find((c) => c.kind === 'setWorkFlag');
    if (moved === undefined) throw new Error('expected the periodic flag re-aim');
    const dist = Math.abs(moved.x - DRIFTED.x) + Math.abs(moved.y - DRIFTED.y);
    expect(dist).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
    expect(dist).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
  });

  it('staffs the upgraded bakery with two bakers plus the carrier (the per-building targets)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TOP_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    // Enough men that the target tier still has surplus behind the scout + reserve + HQ carriers.
    spawnMen(sim, BUILDER_CAP + 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const bakery = entityOfBuilding(sim, BAKERY_TOP_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === bakery);
    // Min tier: the first baker and the bakery's carrier; target tier: the second baker.
    expect(staffing.map((c) => c.jobPriority)).toEqual([[BAKER], [CARRIER], [BAKER]]);
  });

  it('hires only an unmarried man as the scout', () => {
    const sim = aiSim();
    placeHq(sim);
    spawnMen(sim, 2);
    sim.step();
    const men = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === CIVILIST)
      .sort((a, b) => a - b);
    const [first, second] = men;
    if (first === undefined || second === undefined) throw new Error('setup: two men expected');
    // The lower-id man is married (spouse alive): the scout hire must skip him.
    sim.world.add(first, Marriage, { spouse: second, child: null });

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const scoutHires = commands.filter((c) => c.kind === 'setJob').filter((c) => c.jobType === SCOUT);
    expect(scoutHires.map((c) => c.entity)).toEqual([second]);
  });

  it('turns an idle scout back into a builder once the wanted lattice is done', () => {
    // A map too small for any first-ring lattice target (±22 columns / ±34 rows off the HQ).
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(20, 12) });
    placeHq(sim, 10, 6);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 4, y: 4, tribe: VIKING, owner: SEAT });
    sim.step();
    plantPostAtHq(sim); // the centre target is satisfied; every ring target falls off this small map
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    expect(commands).toEqual([{ kind: 'setJob', entity: scout, jobType: BUILDER }]);
  });

  it('idles a seat without a built headquarters - no HQ, no AI', () => {
    const sim = aiSim();
    spawnMen(sim, 3);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('flagSpotNear', () => {
  /** The one deposit standing on `sim`. */
  const depositOf = (sim: Simulation): Entity => {
    const [deposit] = sim.world.query(Resource);
    if (deposit === undefined) throw new Error('setup: a deposit');
    return deposit;
  };
  const groundOf = (sim: Simulation, origin: { hx: number; hy: number }) => {
    if (sim.terrain === undefined) throw new Error('mapped sim');
    return flagGround(sim.world, ctxOf(sim), sim.terrain, SEAT, origin);
  };

  it('plants the flag in the band on the origin side of the resource, the shortest walk from both', () => {
    const sim = aiSim();
    const resource = { hx: 20, hy: 16 };
    sim.enqueueSetup({
      kind: 'placeResource',
      good: MUD,
      x: resource.hx,
      y: resource.hy,
      remaining: 5,
      harvestAtomic: RESOURCE_SPOTS.mud.harvest,
    });
    sim.step();
    const deposit = depositOf(sim);
    const eastOrigin = { hx: 60, hy: 16 };
    const northOrigin = { hx: 20, hy: 0 };
    const east = flagSpotNear(sim.world, groundOf(sim, eastOrigin), deposit, eastOrigin, new Set());
    const north = flagSpotNear(sim.world, groundOf(sim, northOrigin), deposit, northOrigin, new Set());
    if (east === null || north === null) throw new Error('a spot on open ground');
    for (const spot of [east, north]) {
      const distance = Math.abs(spot.hx - resource.hx) + Math.abs(spot.hy - resource.hy);
      expect(distance).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
      expect(distance).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
    }
    expect(east.hx).toBeGreaterThan(resource.hx);
    expect(north.hy).toBeLessThan(resource.hy);
  });

  it('walks round a wall: the flag goes where the gatherer reaches his deposit, not on its straight-line side', () => {
    // A wall of landscape blockers east of the deposit, gapped only far to the north, so the band nodes
    // toward the eastern origin lie a long walk from the work cells while the western ones lie a few
    // steps away.
    const MAP_NODES = 48;
    const resource = { hx: 20, hy: 24 };
    const wallColumn = resource.hx + 2;
    const wall: { hx: number; hy: number }[] = [];
    for (let hy = 6; hy < MAP_NODES; hy++) wall.push({ hx: wallColumn, hy });
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: {
        ...grassNodeMap(MAP_NODES, MAP_NODES),
        landscapes: {
          types: [{ typeId: 1, walk: [{ dx: 0, dy: 0 }], build: [], groups: ['blocker'] }],
          placements: wall.map((at, id) => ({ id, typeId: 1, ...at, level: 0 })),
        },
      },
    });
    sim.enqueueSetup({
      kind: 'placeResource',
      good: MUD,
      x: resource.hx,
      y: resource.hy,
      remaining: 5,
      harvestAtomic: RESOURCE_SPOTS.mud.harvest,
    });
    sim.step();
    const origin = { hx: 40, hy: 24 };
    const spot = flagSpotNear(sim.world, groundOf(sim, origin), depositOf(sim), origin, new Set());
    if (spot === null) throw new Error('a spot beside the deposit');
    expect(spot.hx).toBeLessThan(wallColumn);
    expect(Math.abs(spot.hx - resource.hx) + Math.abs(spot.hy - resource.hy)).toBeLessThanOrEqual(
      FLAG_MAX_DISTANCE_NODES,
    );
  });

  it('never picks a node a landscape object blocks', () => {
    const MAP_NODES = 24;
    const resource = { hx: 12, hy: 12 };
    const withStoneAt = (stone?: { hx: number; hy: number }): Simulation =>
      new Simulation({
        seed: 1,
        content: aiContent(),
        map: {
          ...grassNodeMap(MAP_NODES, MAP_NODES),
          ...(stone === undefined
            ? {}
            : {
                landscapes: {
                  types: [{ typeId: 1, walk: [{ dx: 0, dy: 0 }], build: [], groups: ['blocker'] }],
                  placements: [{ id: 0, typeId: 1, ...stone, level: 0 }],
                },
              }),
        },
      });
    const spotIn = (sim: Simulation) => {
      sim.enqueueSetup({
        kind: 'placeResource',
        good: MUD,
        x: resource.hx,
        y: resource.hy,
        remaining: 5,
        harvestAtomic: RESOURCE_SPOTS.mud.harvest,
      });
      sim.step();
      return flagSpotNear(sim.world, groundOf(sim, resource), depositOf(sim), resource, new Set());
    };
    const open = spotIn(withStoneAt());
    if (open === null) throw new Error('open ground has a spot');

    const stoned = withStoneAt(open);
    const spot = spotIn(stoned);
    if (spot === null || stoned.terrain === undefined) throw new Error('a spot beside the stone');
    expect(spot).not.toEqual(open);
    expect(
      canPlaceWorkFlag(stoned.world, ctxOf(stoned), stoned.terrain, stoned.terrain.nodeAt(spot.hx, spot.hy)),
    ).toBe(true);
  });
});
