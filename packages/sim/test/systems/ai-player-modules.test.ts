import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Marriage,
  Resource,
  Settler,
  UnderConstruction,
  WorkFlag,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { TerrainMap } from '../../src/index.js';
import { replay, Simulation } from '../../src/index.js';
import { withinNodeRadius } from '../../src/nav/node-circle.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  BUILDER_CAP,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  populationModule,
  TOWER_DEFENCE_RADIUS_NODES,
  workforceModule,
} from '../../src/systems/ai-player/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  aiSim,
  BAKER,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BARRACKS_TYPE,
  BREWERY_TYPE,
  BUILDER,
  CARRIER,
  CIVILIST,
  COLLECTOR,
  collectModule,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  IRON_GATE_XP,
  JOINER,
  JOINERY_TYPE,
  MILL_TYPE,
  MUD,
  placeHq,
  placeResources,
  plantPostAtHq,
  RESOURCE_SPOTS,
  SAND,
  SCOUT,
  SEAT,
  STOCK_TOP_TYPE,
  STOCK_TYPE,
  STONE,
  STONE_HARVEST,
  STONE_XP_TRACK,
  spawnMen,
  TOOL_IRON,
  TOWER_TYPE,
  VIKING,
  WALL_TYPE,
  WELL_TYPE,
  WOMAN,
  WOOD,
  WOOD_HARVEST,
} from './ai-player/support.js';
import './ai-player/garrison-and-craft.cases.js';
import './ai-player/livestock-round-up.cases.js';
import './ai-player/loss-recovery.cases.js';
import './ai-player/opening-hunter.cases.js';
import './ai-player/signpost-coverage.cases.js';

/**
 * The strategic AI modules (user plan, 2026-07-17): the workforce allocator (builder reset +
 * resource-side flag collectors + scout lifecycle), the opening build order, the HQ signpost ring,
 * and population planning. Module runs are pure - each test inspects the returned command list
 * against a hand-built world, then the integration suite proves the full registry stays
 * deterministic and replayable.
 */
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
    spawnMen(sim, 18);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    // First posts in plan order, then the stone/wood top-ups (mud stays at one), then one
    // collect-anything flag (18 men: 3 + scout + 8 reserve = 12 claimed, the HQ's three target-tier
    // carriers three more, the top-ups take two, and the last man goes generic).
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
    spawnMen(sim, 15);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    // 15 men: 3 first posts + scout + 8 reserve = 12 claimed, and the HQ's three target-tier
    // carriers drain the rest - the stone/wood top-ups wait until the settlement is staffed.
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const carriers = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === hq);
    expect(carriers.map((c) => c.jobPriority)).toEqual([[CARRIER], [CARRIER], [CARRIER]]);
  });

  it('retires a generic collector whose circle holds nothing its trade can harvest', () => {
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

    // No resource stands anywhere: the generic flag feeds nothing - back to the builder pool.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => c.kind === 'setJob' && c.entity === gatherer)).toEqual([
      { kind: 'setJob', entity: gatherer, jobType: BUILDER },
    ]);
  });

  it('claims at most eight builders; leftover men keep their trade', () => {
    const sim = aiSim();
    placeHq(sim);
    // No resources: no collectors wanted - the ladder is scout + HQ carriers + the reserve.
    spawnMen(sim, 14);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const builders = commands.filter((c) => c.kind === 'setJob').filter((c) => c.jobType === BUILDER);
    expect(builders).toHaveLength(BUILDER_CAP);
    // 14 men: the scout, 8 builders, and the HQ's three target-tier carriers = 12 claimed; the two
    // leftovers get NO order - the cap never over-converts.
    const ordered = new Set(
      commands.flatMap((c) => (c.kind === 'setJob' || c.kind === 'assignWorker' ? [c.entity] : [])),
    );
    expect(ordered.size).toBe(12);
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
    for (const e of sim.world.query(Resource)) sim.world.get(e, Resource).remaining = 0;
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
    for (const e of sim.world.query(Resource)) sim.world.get(e, Resource).remaining = 0;
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
    // 14 men: scout + farm minimum + 8 builders + the target-tier second farmer + the HQ's three
    // carriers claim everyone - the third farmer ranks BEHIND the storage targets now.
    expect(staffFarm(14)).toBe(2);
    // One more man clears every target post, and the surplus tier seats the third farmer.
    expect(staffFarm(15)).toBe(3);
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
    expect(staffJoinery(14)).toBe(2);
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

  it('leaves a carrier-only workplace (the well) unstaffed', () => {
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
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const well = entityOfBuilding(sim, WELL_TYPE);
    expect(commands.filter((c) => c.kind === 'assignWorker' && c.building === well)).toEqual([]);
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
    sim.world.get(veteran, Settler).experience.set(STONE_XP_TRACK, IRON_GATE_XP);

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

  it('never trades one ungated good\u2019s collector for another\u2019s', () => {
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
    sim.world.get(collector, Settler).experience.set(STONE_XP_TRACK, IRON_GATE_XP);
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
    for (const e of sim.world.query(Resource)) sim.world.get(e, Resource).remaining = 0;
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
    spawnMen(sim, 14, BUILDER);
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

  it('idles a seat without a built headquarters (user rule: no HQ → no AI)', () => {
    const sim = aiSim();
    spawnMen(sim, 3);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('build-order module (houseBuild)', () => {
  const module = buildOrderModule(DEFAULT_BUILD_ORDER);

  function nextPlacement(sim: Simulation): Command | undefined {
    return [...module.run(sim.world, ctxOf(sim), SEAT)][0];
  }

  /** Apply one module command, then force-finish every open site (upgrades adopt their tier). */
  function applyAndFinish(sim: Simulation, command: Command): void {
    sim.enqueueSetup(command);
    sim.step();
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: e });
    }
    sim.step();
  }

  it('executes the opening list in order near the HQ, one open site at a time', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]); // a live iron node keeps the collector entry waiting
    sim.step();

    // Farm first - on a free node close to the HQ, as a construction site owned by the seat.
    const first = nextPlacement(sim);
    expect(first?.kind).toBe('placeBuilding');
    if (first?.kind !== 'placeBuilding') return;
    expect(first.buildingType).toBe(FARM_TYPE);
    expect(first.underConstruction).toBe(true);
    expect(first.owner).toBe(SEAT);
    const dist = Math.abs(first.x - HQ_X) + Math.abs(first.y - HQ_Y);
    expect(dist).toBeGreaterThan(0); // never on the HQ's own node
    expect(dist).toBeLessThanOrEqual(4); // the closest free ring, not a far scatter
    sim.enqueueSetup(first);
    sim.step();

    // One open site - the executor stalls until it finishes.
    expect(nextPlacement(sim)).toBeUndefined();
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: e });
    }
    sim.step();

    // Homes fill to their count of three; the entries absent from this content (pottery, mason)
    // are skipped, and the farm→mill→bakery/well chain follows.
    for (const expected of [HOME_TYPE, HOME_TYPE, HOME_TYPE, MILL_TYPE, BAKERY_TYPE, WELL_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }

    // The home-upgrade entry walks each home to the top tier, one upgrade site at a time.
    for (let i = 0; i < 6; i++) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'upgradeBuilding') throw new Error(`expected upgrade ${i}, got ${next?.kind}`);
      applyAndFinish(sim, next);
    }
    const homes = [...sim.world.query(Building)]
      .map((e) => sim.world.get(e, Building).buildingType)
      .filter((t) => t === HOME_TYPE || t === HOME_TOP_TYPE);
    expect(homes).toEqual([HOME_TOP_TYPE, HOME_TOP_TYPE, HOME_TOP_TYPE]);

    // The hive/animal-farm/sewery entries are absent from this content; the brewery and the
    // level-2 joinery follow before the gated iron-collector entry.
    for (const expected of [BREWERY_TYPE, JOINERY_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }

    // The gated iron-collector entry: the executor waits (the workforce module does the hiring); a
    // standing collector unblocks the tail.
    expect(nextPlacement(sim)).toBeUndefined();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, x: 12, y: 24, tribe: VIKING, owner: SEAT });
    sim.step();
    const settler = [...sim.world.query(Settler)].at(-1);
    if (settler === undefined) throw new Error('setup: collector missing');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: settler, goodType: IRON });
    sim.step();

    // Past the gate: the barracks, the bakery upgrade, then the late tail - the tower coverage entry
    // rests (everything sits inside the HQ circle on this map), the second bakery arrives directly at
    // its level-2 tier, the second brewery, the two outskirts warehouses, and the closing pair of
    // level-2 bakeries end the list. The five-home entry names `home_level_04`, a tier this content
    // set stops short of, so it skips here - the direct top-tier placement has its own test below.
    // The smithy and armory entries are absent from this fixture, so both skip.
    const barracks = nextPlacement(sim);
    if (barracks?.kind !== 'placeBuilding') throw new Error('expected the barracks placement');
    expect(barracks.buildingType).toBe(BARRACKS_TYPE);
    applyAndFinish(sim, barracks);
    const upgrade = nextPlacement(sim);
    if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected the bakery upgrade');
    expect(sim.world.get(upgrade.building, Building).buildingType).toBe(BAKERY_TYPE);
    applyAndFinish(sim, upgrade);
    for (const expected of [
      BAKERY_TOP_TYPE,
      BREWERY_TYPE,
      STOCK_TOP_TYPE,
      STOCK_TOP_TYPE,
      BAKERY_TOP_TYPE,
      BAKERY_TOP_TYPE,
    ]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }
    expect(nextPlacement(sim)).toBeUndefined();
  });

  it('re-places a destroyed building (the count repairs itself)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    sim.enqueueSetup(first);
    sim.step();
    const farm = entityOfBuilding(sim, FARM_TYPE);
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: farm });
    sim.step();
    sim.enqueueSetup({ kind: 'demolish', building: farm });
    sim.step();
    const again = nextPlacement(sim);
    if (again?.kind !== 'placeBuilding') throw new Error('expected a repair placement');
    expect(again.buildingType).toBe(FARM_TYPE);
  });

  it('stalls when nothing can upgrade toward the entry tier yet', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const upgradeOnly = buildOrderModule([{ kind: 'upgrade', building: 'home_level_02', count: 1 }]);
    expect([...upgradeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('places a further home straight at the top tier instead of growing it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    // The tail's housing rule (user decision 2026-07-26): the opening homes walk the upgrade chain,
    // but every home after them is placed at the top tier outright - its own construction bill.
    const topHomes = buildOrderModule([{ kind: 'place', building: 'home_level_02', count: 1 }]);
    const first = [...topHomes.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the top-tier home placement');
    expect(first.buildingType).toBe(HOME_TOP_TYPE);
  });

  it('counts an upgraded building for its place entry instead of building a duplicate', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const placeOnly = buildOrderModule([{ kind: 'place', building: 'work_bakery_00', count: 1 }]);
    const first = [...placeOnly.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the bakery placement');
    applyAndFinish(sim, first);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    applyAndFinish(sim, { kind: 'upgradeBuilding', building: bakery });
    // The building now stands at the upper tier - the level-0 place entry stays satisfied.
    expect(sim.world.get(bakery, Building).buildingType).toBe(BAKERY_TOP_TYPE);
    expect([...placeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('build-order placement - affinity and ground rules', () => {
  /** A half-cell node map that is grass except where `sandy(x, y)` says otherwise. */
  function mapWithSand(width: number, height: number, sandy: (x: number, y: number) => boolean): TerrainMap {
    const typeIds = new Array<number>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) typeIds[y * width + x] = sandy(x, y) ? SAND : 0;
    }
    return { resolution: 'half-cell', width, height, typeIds };
  }

  function firstCommandOf(sim: Simulation, order: readonly BuildOrderEntry[]): Command | undefined {
    return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('places the farm only on plantable ground - a barren pocket is skipped, a barren map stalls', () => {
    // Sand within 6 nodes of the HQ: the farm must land beyond it, on the first grass ring.
    const SAND_RADIUS = 6;
    const pocket = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= SAND_RADIUS),
    });
    placeHq(pocket);
    pocket.step();
    const farm = firstCommandOf(pocket, DEFAULT_BUILD_ORDER);
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(Math.abs(farm.x - HQ_X) + Math.abs(farm.y - HQ_Y)).toBeGreaterThan(SAND_RADIUS);

    // An all-sand map stalls the farm (hard rule) even though the ground is buildable - proven by
    // a home entry placing fine on the same ground.
    const barren = new Simulation({ seed: 1, content: aiContent(), map: mapWithSand(64, 32, () => true) });
    placeHq(barren);
    barren.step();
    expect(firstCommandOf(barren, DEFAULT_BUILD_ORDER)).toBeUndefined();
    const home = firstCommandOf(barren, [{ kind: 'place', building: 'home_level_00', count: 1 }]);
    expect(home?.kind).toBe('placeBuilding');
  });

  it('pulls a resource-affinity placement toward the deposit while staying in the near-HQ band', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.stone]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    const toStone = Math.abs(spot.x - RESOURCE_SPOTS.stone.x) + Math.abs(spot.y - RESOURCE_SPOTS.stone.y);
    expect(toStone).toBeLessThanOrEqual(2); // beside the deposit, not beside the HQ
    expect(Math.abs(spot.x - HQ_X) + Math.abs(spot.y - HQ_Y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );
  });

  it('pulls a building-affinity placement beside the named building', () => {
    const WELL_AT = { x: 44, y: 20 };
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: WELL_AT.x,
      y: WELL_AT.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const spot = firstCommandOf(sim, [
      {
        kind: 'place',
        building: 'work_bakery_00',
        count: 1,
        near: [{ kind: 'building', id: 'work_well_00' }],
      },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(Math.abs(spot.x - WELL_AT.x) + Math.abs(spot.y - WELL_AT.y)).toBeLessThanOrEqual(2);
  });

  it('pulls a mapCentre-affinity placement toward the middle of the map', () => {
    const HQ_FAR = { x: 20, y: 20 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'mapCentre' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a centre-pulled placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // pulled hard toward the middle
    // The pull points at the map centre (128,128), east and south of this HQ.
    expect(spot.x).toBeGreaterThan(HQ_FAR.x);
    expect(spot.y).toBeGreaterThan(HQ_FAR.y);
  });

  it('clamps a far-off affinity centre back into the near-HQ band', () => {
    const HQ_FAR = { x: 20, y: 20 };
    const STONE_FAR = { x: 200, y: 200 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    placeResources(sim, [{ good: STONE, harvest: STONE_HARVEST, x: STONE_FAR.x, y: STONE_FAR.y }]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a clamped placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // yet pulled hard toward the deposit
  });
});

describe('build-order tower coverage and outskirts', () => {
  const coverage = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01' }]);

  function completeSites(sim: Simulation): void {
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: e });
    }
    sim.step();
  }

  it('rests while every building sits in the HQ circle, then covers an outlying one', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A home 31 columns east leaves the 29-node circle: the next decision places a covering tower.
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement');
    expect(order.buildingType).toBe(TOWER_TYPE);
    expect(order.underConstruction).toBe(true);
    // The spot actually covers the target (world-metric circle) and stays inside the HQ disc.
    expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, TOWER_DEFENCE_RADIUS_NODES)).toBe(true);
    expect(Math.abs(order.x - HQ_X) + Math.abs(order.y - HQ_Y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );

    // The tower SITE already counts as coverage; a finished tower keeps the entry satisfied - and
    // the entry is perpetual: another far building re-arms it.
    sim.enqueueSetup(order);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    completeSites(sim);
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X - 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);
  });

  it('never counts the defence wall (shared kind, different id) as a covering tower', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WALL_TYPE,
      x: FAR.x - 2,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    // The wall shares kind 'tower' but is not in the tower id allowlist - the home stays uncovered.
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement despite the wall');
    expect(order.buildingType).toBe(TOWER_TYPE);
  });

  it('pushes an outskirts placement past the frontier building and spreads successive warehouses', () => {
    const sim = aiSim();
    placeHq(sim);
    const FRONTIER = { x: HQ_X + 14, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FRONTIER.x,
      y: FRONTIER.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const stocks = buildOrderModule([
      { kind: 'place', building: 'stock_02', count: 2, near: [{ kind: 'outskirts' }] },
    ]);
    const first = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the first warehouse placement');
    expect(first.buildingType).toBe(STOCK_TOP_TYPE);
    // The spot lands on the far side of the frontier building - farther from the settlement
    // centroid than the frontier itself.
    const centroid = { x: Math.floor((HQ_X + FRONTIER.x) / 2), y: HQ_Y };
    const frontierDist = Math.abs(FRONTIER.x - centroid.x) + Math.abs(FRONTIER.y - centroid.y);
    const spotDist = Math.abs(first.x - centroid.x) + Math.abs(first.y - centroid.y);
    expect(spotDist).toBeGreaterThan(frontierDist);
    sim.enqueueSetup(first);
    sim.step();
    completeSites(sim);

    // The second warehouse never anchors on the first (its own kind is excluded from the frontier
    // pick) - the pair spreads instead of stacking.
    const second = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (second?.kind !== 'placeBuilding') throw new Error('expected the second warehouse placement');
    expect(second.x === first.x && second.y === first.y).toBe(false);
  });

  it('sends apart warehouses to opposite wings of the settlement', () => {
    const sim = aiSim();
    placeHq(sim);
    // A settlement with an east and a west wing: each warehouse should claim one.
    for (const dx of [14, -14]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HQ_X + dx,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    const stocks = buildOrderModule([
      { kind: 'place', building: 'stock_02', count: 2, near: [{ kind: 'outskirts' }], apart: true },
    ]);
    const first = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the first warehouse placement');
    sim.enqueueSetup(first);
    sim.step();
    completeSites(sim);

    // The second warehouse anchors past the frontier of the wing the first one did NOT take, rather
    // than on a spacing ring around it: the two straddle the HQ.
    const second = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (second?.kind !== 'placeBuilding') throw new Error('expected the second warehouse placement');
    expect(Math.sign(first.x - HQ_X)).toBe(-Math.sign(second.x - HQ_X));
  });
});

describe('population module (homeExpansion)', () => {
  function populationSim(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (let i = 0; i < 2; i++) {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: WOMAN,
        x: 6 + 2 * i,
        y: 8,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    spawnMen(sim, 2);
    sim.step();
    return sim;
  }

  function womenOf(sim: Simulation): Entity[] {
    return [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === WOMAN)
      .sort((a, b) => a - b);
  }

  it('marries every single woman while single men exist', () => {
    const sim = populationSim();
    const commands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const weddings = commands.filter((c) => c.kind === 'marry');
    expect(weddings.map((c) => c.entity)).toEqual(womenOf(sim));
  });

  it('houses married women and drives the birth counters: daughters to the slots, sons infinite', () => {
    const sim = populationSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    for (const woman of womenOf(sim)) sim.enqueueSetup({ kind: 'marry', entity: woman });
    // Let the couples walk together and kiss - both marriages must stand before the module houses them.
    for (let i = 0; i < 3000 && womenOf(sim).some((w) => !sim.world.has(w, Marriage)); i++) sim.step();
    expect(womenOf(sim).every((w) => sim.world.has(w, Marriage))).toBe(true);

    // 2 women against 2 family slots: no daughter deficit, so the module raises only the standing
    // infinite son counter - the assistant keeps every family expecting a boy from here on.
    const houseCommands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const home = entityOfBuilding(sim, HOME_TYPE);
    expect(houseCommands.filter((c) => c.kind === 'assignHouse').map((c) => c.house)).toEqual([home, home]);
    expect(houseCommands.filter((c) => c.kind === 'makeChild')).toEqual([]);
    expect(houseCommands.filter((c) => c.kind === 'setAssistantCounter')).toEqual([
      { kind: 'setAssistantCounter', player: SEAT, counter: 'extraMen', value: 0, infinite: true },
    ]);
    for (const c of houseCommands) sim.enqueueSetup(c);
    sim.step();

    // Both counters at their wanted state, everyone married and housed: the decision is a no-op.
    expect([...populationModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A second home (2 more slots) opens a two-daughter deficit; the son counter stands untouched.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: 24,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...populationModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([
      { kind: 'setAssistantCounter', player: SEAT, counter: 'extraWomen', value: 2, infinite: false },
    ]);
  });
});

describe('the full strategic registry - determinism and replay', () => {
  const TICKS = 120;

  function liveRun(): Simulation {
    const sim = aiSim(11);
    placeHq(sim);
    placeResources(sim);
    spawnMen(sim, 5);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOMAN, x: 20, y: 8, tribe: VIKING, owner: SEAT });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(TICKS);
    return sim;
  }

  it('acts through the command seam: the log carries the AI-issued orders', () => {
    const live = liveRun();
    const kinds = new Set(live.commands.log.map((c) => c.command.kind));
    expect(kinds.has('placeBuilding')).toBe(true); // the opening farm went through the queue
    expect(kinds.has('setJob')).toBe(true); // and so did the workforce decisions
    expect(kinds.has('setWorkFlag')).toBe(true); // the collectors flag their resources
  });

  // A long unattended run shares CPU with the whole suite - the explicit timeout keeps a loaded
  // machine from flaking it.
  it('carries the opening list to completion unattended (stocked HQ + a large crew)', {
    timeout: 60_000,
  }, () => {
    const sim = aiSim(21);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      fillStock: true,
    });
    // Deep deposits: a whole ladder of gatherers works these spots for the length of the run, and a
    // 5-unit deposit would run dry long before the list closes.
    placeResources(sim, Object.values(RESOURCE_SPOTS), 40);
    // The crew covers the ladder's essentials - the collectors (with top-ups), the scout, the
    // minimum staffing of every workshop the list raises, and the eight-builder reserve that
    // actually raises it - with enough left over to reach the first target-tier posts. The rest
    // waits for grown sons, which this run doesn't simulate. The list closes by ~5000 ticks; 6000
    // keeps slack without dragging the suite (per-tick cost here is dominated by the settler
    // micro-planner, not the strategic AI).
    spawnMen(sim, 26);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(6000);
    const built = [...sim.world.query(Building)].filter(
      (e) => !sim.world.has(e, UnderConstruction) && sim.world.get(e, Building).buildingType !== HQ_TYPE,
    );
    // The whole fixture-expressible list stands finished: the farm/mill/bakery/well chain, three
    // TOP-tier homes (the tail's further homes name a tier above this content set's chain, so they
    // skip here), the upgraded bakery plus the three direct-placed level-2 bakeries, two breweries,
    // the joinery, the barracks, and both outskirts warehouses (every building sits inside the HQ's
    // coverage circle, so no tower is needed).
    expect(built.map((e) => sim.world.get(e, Building).buildingType).sort((a, b) => a - b)).toEqual(
      [
        HOME_TOP_TYPE,
        HOME_TOP_TYPE,
        HOME_TOP_TYPE,
        FARM_TYPE,
        WELL_TYPE,
        MILL_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BAKERY_TOP_TYPE,
        BREWERY_TYPE,
        BREWERY_TYPE,
        JOINERY_TYPE,
        BARRACKS_TYPE,
        STOCK_TOP_TYPE,
        STOCK_TOP_TYPE,
      ].sort((a, b) => a - b),
    );
    // The crew clears the reserve, so the farm reaches its target-tier hands and the bakery keeps
    // its carrier; the joinery's joiner was locked onto iron tools; the gated iron collector was
    // hired once the list reached its entry (the tiny fixture patch is long harvested dry by now,
    // so the proof is the logged command); and the builder crew never exceeds its cap of eight.
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const posts = [...sim.world.query(Settler, JobAssignment)].map((e) => ({
      workplace: sim.world.get(e, JobAssignment).workplace,
      jobType: sim.world.get(e, Settler).jobType,
    }));
    expect(posts.filter((p) => p.workplace === farm && p.jobType === FARMER).length).toBeGreaterThanOrEqual(
      2,
    );
    const bakeries = [...sim.world.query(Building)].filter(
      (e) => sim.world.get(e, Building).buildingType === BAKERY_TOP_TYPE,
    );
    expect(bakeries.some((b) => posts.some((p) => p.workplace === b && p.jobType === CARRIER))).toBe(true);
    const log = sim.commands.log.map((c) => c.command);
    expect(log.some((c) => c.kind === 'setGatherGood' && c.goodType === IRON)).toBe(true);
    expect(
      log.some((c) => c.kind === 'setCraftGoods' && c.goods.length === 1 && c.goods[0] === TOOL_IRON),
    ).toBe(true);
    const builders = [...sim.world.query(Settler)].filter(
      (e) => sim.world.get(e, Settler).jobType === BUILDER && !sim.world.has(e, JobAssignment),
    );
    expect(builders.length).toBeLessThanOrEqual(BUILDER_CAP);
  });

  it('same seed twice → byte-identical state; replaying the log reproduces it', () => {
    const a = liveRun();
    const b = liveRun();
    expect(a.hashState()).toBe(b.hashState());
    const replayed = replay({
      content: aiContent(),
      seed: 11,
      map: grassNodeMap(64, 32),
      log: a.commands.log,
      untilTick: TICKS,
    });
    expect(replayed.hashState()).toBe(a.hashState());
    // The seat's live re-emissions are discarded during reconstruction and so take no sequence: the
    // replayed log is numbered exactly like the run it rebuilds, and a bug report's entry index means
    // the same thing in both.
    const order = (sim: Simulation): Array<readonly [number, number, string]> =>
      sim.commands.log.map((e) => [e.applyTick, e.sequence, e.origin] as const);
    expect(order(replayed)).toEqual(order(a));
    expect(order(a).some(([, , origin]) => origin === 'ai')).toBe(true);
  });
});
