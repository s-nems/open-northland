import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiPlayerEntity,
  JobAssignment,
  Marriage,
  Resource,
  Settler,
  SettlerProgress,
  StalledPlacement,
  setStockAmount,
  WorkFlag,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import { Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import {
  BUILDER_CAP,
  CIVILIANS_PER_CLEARING_COLLECTOR,
  COLLECTOR_TARGET_BY_GOOD_ID,
  DEFAULT_COLLECTOR_TARGET,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  LATE_GAME_BUILDER_CAP,
  LATE_GAME_CIVILIANS,
  workforceModule,
} from '../../../src/systems/ai-player/index.js';
import { workableResourceTest } from '../../../src/systems/ai-player/live-resources.js';
import {
  RAW_COMFORT_UNITS,
  wantedCollectorGoods,
} from '../../../src/systems/ai-player/workforce/collectors/index.js';
import { flagSpotNear } from '../../../src/systems/ai-player/workforce/flag-spots.js';
import { builderCap } from '../../../src/systems/ai-player/workforce/staffing.js';
import { resourceStanceCells } from '../../../src/systems/footprint/interaction.js';
import { canPlaceWorkFlag } from '../../../src/systems/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
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
  HQ_TYPE,
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
  VIKING,
  WELL_TYPE,
  WOOD,
  WOOD_HARVEST,
  wallOver,
} from './support.js';

/** The allocator's hiring ladder: collector posts, workshop staffing tiers, scout, builder reserve. */

describe('workforce module (collectResources)', () => {
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

  it('tops wood/stone up to two collectors and adds generic gatherers once the reserve stands', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, BUILDER_CAP + 10);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    // First posts in plan order, then the stone/wood top-ups (mud stays at one), then one
    // collect-anything flag (3 first posts, the scout and the builder reserve claimed, the HQ's three
    // target-tier carriers three more, the top-ups take two, and the last man goes generic).
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD, STONE, WOOD, null]);
    // Each post gets a node of its own. A good's top-up re-derives the same nearest resource as its
    // first post, so without the decision's claimed-node set the two flags land on one tile - one
    // delivery yard, one pile cap, two gatherers.
    const spots = commands.filter((c) => c.kind === 'setWorkFlag').map((c) => `${c.x},${c.y}`);
    expect(new Set(spots).size).toBe(spots.length);

    // Every post is recognized on the next decision - no churn, nothing left to do.
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('holds the top-ups behind the target staffing tier (extra collectors come much later)', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, BUILDER_CAP + 7);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    // 3 first posts, the scout and the builder reserve claimed, and the HQ's three target-tier
    // carriers drain the rest - the stone/wood top-ups wait until the settlement is staffed.
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const carriers = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === hq);
    expect(carriers.map((c) => c.jobPriority)).toEqual([[CARRIER], [CARRIER], [CARRIER]]);
  });

  it("posts more wood gatherers ahead of the builder reserve while the joinery eats the sites' wood", () => {
    // The joinery's recipes consume wood, the crew is the previous case's: nothing past the reserve, so
    // only a first-tier post can still claim a man.
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: JOINERY_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, BUILDER_CAP + 7);
    sim.step();
    const decide = () => {
      const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands;
    };
    const posted = (commands: readonly Command[]) =>
      commands.flatMap((c) => (c.kind === 'setGatherGood' ? [c.goodType] : []));
    const woodHolders = () =>
      [...sim.world.query(Settler, WorkFlag)].filter((e) => sim.world.get(e, WorkFlag).goodType === WOOD);

    expect(posted(decide())).toEqual([MUD, STONE, WOOD]);
    // No wood beyond what the sites need and a built consumer: the target's every post is a first post,
    // one per decision, up to one beyond the plan's two.
    expect(posted(decide())).toEqual([WOOD]);
    expect(posted(decide())).toEqual([WOOD]);
    expect(posted(decide())).toEqual([]);
    expect(woodHolders()).toHaveLength((COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0) + 1);

    // The extra man stays through the band and rejoins the builders once the wood is plentiful.
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const retired = (commands: readonly Command[]) =>
      commands.filter((c) => c.kind === 'setJob' && c.jobType === BUILDER);
    setStockAmount(sim.world, hq, WOOD, RAW_COMFORT_UNITS - 1);
    expect(retired(decide())).toEqual([]);
    setStockAmount(sim.world, hq, WOOD, RAW_COMFORT_UNITS);
    expect(retired(decide())).toHaveLength(1);
    expect(woodHolders()).toHaveLength(COLLECTOR_TARGET_BY_GOOD_ID.wood ?? 0);
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
    sim.world.add(carrier, StalledPlacement, { entry: 0, retryTick: Number.MAX_SAFE_INTEGER });

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    // The same men as the unstalled ladder above call for three clearing posts: after 3 first posts, the
    // scout and the builder reserve, the three left clear ground instead of carrying.
    const clearing = Math.floor((BUILDER_CAP + 7) / CIVILIANS_PER_CLEARING_COLLECTOR);
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD, ...Array(clearing).fill(null)]);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    expect(commands.filter((c) => c.kind === 'assignWorker' && c.building === hq)).toEqual([]);

    // Every clearing post is recognized while the stall lasts - nothing is re-hired.
    for (const c of commands) sim.enqueueSetup(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setGatherGood'),
    ).toEqual([]);
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
    sim.world.add(carrier, StalledPlacement, { entry: 0, retryTick: Number.MAX_SAFE_INTEGER });

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

  it('adds a clay gatherer for the second potter', () => {
    const base = aiContent();
    const POTTER = 30;
    const POTTERY = 30;
    const content = parseContentSet({
      ...base,
      jobs: [...base.jobs, { typeId: POTTER, id: 'potter' }],
      buildings: [
        ...base.buildings,
        {
          typeId: POTTERY,
          id: 'work_pottery_01',
          kind: 'workplace',
          workers: [{ jobType: POTTER, count: 2 }],
          construction: [{ goodType: 1, amount: 1 }],
        },
      ],
    });
    const sim = aiSim(1, content);
    const ctx = { ...ctxOf(sim), content };
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: POTTERY,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 2, POTTER);
    sim.step();
    const pottery = entityOfBuilding(sim, POTTERY);
    const potters = [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === POTTER);
    const mudTarget = (): number | undefined =>
      wantedCollectorGoods(sim.world, ctx, SEAT, [], []).find((w) => w.good.typeId === MUD)?.target;

    const [first, second] = potters;
    if (first === undefined || second === undefined) throw new Error('setup: two potters');
    sim.world.add(first, JobAssignment, { workplace: pottery });
    expect(mudTarget()).toBe(DEFAULT_COLLECTOR_TARGET);
    sim.world.add(second, JobAssignment, { workplace: pottery });
    expect(mudTarget()).toBe(DEFAULT_COLLECTOR_TARGET + 1);
  });

  it("raises a good's gatherer target to the count its reached collector entry asks for", () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const ctx = ctxOf(sim);
    const ironTarget = (count: number, status: 'unmet' | 'skip'): number | undefined =>
      wantedCollectorGoods(sim.world, ctx, SEAT, [{ kind: 'collector', good: 'iron', count }], [status]).find(
        (w) => w.good.typeId === IRON,
      )?.target;
    const IRON_BASE_TARGET = COLLECTOR_TARGET_BY_GOOD_ID.iron ?? DEFAULT_COLLECTOR_TARGET;
    expect(ironTarget(IRON_BASE_TARGET + 2, 'unmet')).toBe(IRON_BASE_TARGET + 2);
    expect(ironTarget(1, 'unmet')).toBe(IRON_BASE_TARGET); // a smaller count never lowers the plan
    expect(ironTarget(IRON_BASE_TARGET + 2, 'skip')).toBeUndefined(); // a skipped entry wants nobody
  });

  it('keeps the late-game builder reserve for a grown settlement only', () => {
    expect(builderCap(LATE_GAME_CIVILIANS - 1)).toBe(BUILDER_CAP);
    expect(builderCap(LATE_GAME_CIVILIANS)).toBe(LATE_GAME_BUILDER_CAP);
  });

  it('claims at most the builder reserve; leftover men keep their trade', () => {
    const sim = aiSim();
    placeHq(sim);
    // No resources: no collectors wanted - the ladder is scout + HQ carriers + the reserve.
    spawnMen(sim, BUILDER_CAP + 6);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const builders = commands.filter((c) => c.kind === 'setJob').filter((c) => c.jobType === BUILDER);
    expect(builders).toHaveLength(BUILDER_CAP);
    // The scout, the reserve and the HQ's three target-tier carriers are claimed; the two leftovers get
    // NO order - the cap never over-converts.
    const ordered = new Set(
      commands.flatMap((c) => (c.kind === 'setJob' || c.kind === 'assignWorker' ? [c.entity] : [])),
    );
    expect(ordered.size).toBe(BUILDER_CAP + 4);
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
    // Scout + farm minimum + the builder reserve + the target-tier second farmer + the HQ's three
    // carriers claim everyone - the third farmer ranks BEHIND the storage targets now.
    expect(staffFarm(BUILDER_CAP + 6)).toBe(2);
    // One more man clears every target post, and the surplus tier seats the third farmer.
    expect(staffFarm(BUILDER_CAP + 7)).toBe(3);
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

  it('staffs the HQ and a warehouse with three carriers each once men are spare', () => {
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
    spawnMen(sim, 20, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const stock = entityOfBuilding(sim, STOCK_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker');
    // Every storage post is a target-tier extra, so all six carriers come out of the surplus beyond
    // the builder reserve. The collector slots both storages declare are harvest trades and stay open.
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

  it.each([
    ['leaves a carrier-only workplace (the well) unstaffed', LATE_GAME_CIVILIANS - 1, []],
    ['gives the well a carrier of its own once the seat has grown', LATE_GAME_CIVILIANS, [[CARRIER]]],
  ])('%s', (_title, men, posts) => {
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
    spawnMen(sim, men, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const well = entityOfBuilding(sim, WELL_TYPE);
    const hires = commands.filter((c) => c.kind === 'assignWorker' && c.building === well);
    expect(hires.map((c) => (c.kind === 'assignWorker' ? c.jobPriority : []))).toEqual(posts);
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
      if (sim.terrain === undefined) throw new Error('mapped sim');
      return flagSpotNear(sim.world, ctxOf(sim), sim.terrain, resource, new Set());
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
