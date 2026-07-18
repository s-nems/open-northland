import { describe, expect, it } from 'vitest';
import {
  Building,
  JobAssignment,
  Marriage,
  Owner,
  Position,
  Resource,
  Settler,
  SIGNPOST_NAV_RADIUS_NODES,
  SIGNPOST_SPACING_RADIUS_NODES,
  Signpost,
  UnderConstruction,
  WorkFlag,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { TerrainMap } from '../../src/index.js';
import { EventBuffer, positionOfNode, Rng, replay, Simulation } from '../../src/index.js';
import { withinNodeRadius } from '../../src/nav/node-metric.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  populationModule,
  SIGNPOST_TARGET_TOLERANCE_NODES,
  signpostCoverageModule,
  signpostLatticeOffset,
  workforceModule,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI modules (user plan, 2026-07-17): the workforce allocator (builder reset +
 * resource-side flag collectors + scout lifecycle), the opening build order, the HQ signpost ring,
 * and population planning. Module runs are pure — each test inspects the returned command list
 * against a hand-built world, then the integration suite proves the full registry stays
 * deterministic and replayable.
 */

const VIKING = 1;
const SEAT = 2;
const CIVILIST = 6;
const BUILDER = 7;
const COLLECTOR = 8;
const FARMER = 18;
const BAKER = 20;
const CARRIER = 24;
const SCOUT = 27;
const WOMAN = 5;
const HQ_TYPE = 1;
const HOME_TYPE = 2;
const HOME_TOP_TYPE = 4;
const FARM_TYPE = 5;
const WELL_TYPE = 6;
const MILL_TYPE = 7;
const BAKERY_TYPE = 8;
const WOOD = 1;
const MUD = 2;
const STONE = 4;
const IRON = 5;
const WOOD_HARVEST = 24;
const STONE_HARVEST = 25;
const IRON_HARVEST = 26;
const MUD_HARVEST = 32;
/** The fixture's barren-but-buildable landscape id (grass is 0). */
const SAND = 2;

const HQ_X = 30;
const HQ_Y = 16;

/** The default workforce allocator — collector gating follows the default opening list. */
const collectModule = workforceModule(DEFAULT_BUILD_ORDER);

/** Fixture resource spots, apart from each other and the HQ so flags and placements never collide.
 *  Iron stands on every map too: the workforce must NOT hire for it until the list reaches the
 *  gated `collector` entry. */
const RESOURCE_SPOTS = {
  mud: { x: 8, y: 8, good: MUD, harvest: MUD_HARVEST },
  stone: { x: 48, y: 8, good: STONE, harvest: STONE_HARVEST },
  wood: { x: 48, y: 24, good: WOOD, harvest: WOOD_HARVEST },
  iron: { x: 10, y: 26, good: IRON, harvest: IRON_HARVEST },
} as const;

function aiSim(seed = 1): Simulation {
  return new Simulation({ seed, content: aiContent(), map: grassNodeMap(64, 32) });
}

function ctxOf(sim: Simulation, tick = 0): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(1),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function placeHq(sim: Simulation, x = HQ_X, y = HQ_Y): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: HQ_TYPE, x, y, tribe: VIKING, owner: SEAT });
}

function spawnMen(sim: Simulation, count: number, jobType = CIVILIST): void {
  for (let i = 0; i < count; i++) {
    sim.enqueue({ kind: 'spawnSettler', jobType, x: 4 + 2 * i, y: 4, tribe: VIKING, owner: SEAT });
  }
}

function placeResources(
  sim: Simulation,
  spots: readonly { x: number; y: number; good: number; harvest: number }[] = Object.values(RESOURCE_SPOTS),
): void {
  for (const spot of spots) {
    sim.enqueue({
      kind: 'placeResource',
      good: spot.good,
      x: spot.x,
      y: spot.y,
      remaining: 5,
      harvestAtomic: spot.harvest,
    });
  }
}

function entityOfBuilding(sim: Simulation, buildingType: number): Entity {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === buildingType) return e;
  }
  throw new Error(`setup: building ${buildingType} missing`);
}

function plantPost(sim: Simulation, position: { x: number; y: number }): void {
  const post = sim.world.create();
  sim.world.add(post, Position, position);
  sim.world.add(post, Owner, { player: SEAT });
  sim.world.add(post, Signpost, {
    navRadius: SIGNPOST_NAV_RADIUS_NODES,
    spacingRadius: SIGNPOST_SPACING_RADIUS_NODES,
  });
}

function plantPostAtHq(sim: Simulation): void {
  plantPost(sim, sim.world.get(entityOfBuilding(sim, HQ_TYPE), Position));
}

describe('workforce module (collectResources)', () => {
  it('hires flag collectors beside their resources, one scout, and resets the rest to builders', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim);
    spawnMen(sim, 6);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const jobs = commands.filter((c) => c.kind === 'setJob');
    const flags = commands.filter((c) => c.kind === 'setWorkFlag');
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    // Three collectors in the plan's clay → stone → wood order, then the scout, then the two
    // leftover civilians become builders (the total reset).
    expect(jobs.map((j) => j.jobType)).toEqual([COLLECTOR, COLLECTOR, COLLECTOR, SCOUT, BUILDER, BUILDER]);
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    // Each flag stands 2–3 tiles (4–6 nodes) from its good's resource — never on top of it.
    const spots = [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood];
    expect(flags).toHaveLength(3);
    for (const [i, f] of flags.entries()) {
      const spot = spots[i];
      if (spot === undefined) throw new Error('unreachable: three spots for three flags');
      const dist = Math.abs(f.x - spot.x) + Math.abs(f.y - spot.y);
      expect(dist).toBeGreaterThanOrEqual(FLAG_MIN_DISTANCE_NODES);
      expect(dist).toBeLessThanOrEqual(FLAG_MAX_DISTANCE_NODES);
    }
    // Distinct settlers throughout — the allocator never claims one person twice.
    const claimed = jobs.map((c) => c.entity);
    expect(new Set(claimed).size).toBe(claimed.length);

    // Applying the decision settles the seat: the next decision has nothing left to do.
    for (const c of commands) sim.enqueue(c);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    const bound = [...sim.world.query(Settler, WorkFlag)];
    expect(bound).toHaveLength(3);
    expect(bound.map((e) => sim.world.get(e, WorkFlag).goodType).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      [WOOD, MUD, STONE].sort((a, b) => a - b),
    );
  });

  it('moves a collector flag when its patch runs dry, and retires the collector when the map is', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.wood]);
    spawnMen(sim, 1);
    sim.step();
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueue(c);
    sim.step();

    // Drain the standing node and offer a fresh one across the map — outside the flag's circle.
    const FAR = { x: 8, y: 24 };
    for (const e of sim.world.query(Resource)) sim.world.get(e, Resource).remaining = 0;
    sim.enqueue({
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

  it('staffs a built workplace with one worker per operator trade, thinning the builder pool', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    // No resources on this map: no collectors are wanted, staffing draws straight from the builders.
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === farm);
    // One farmer despite 4 farmer slots (WORKERS_PER_TRADE), and never the farm's carrier slot.
    expect(staffing.map((c) => c.jobPriority)).toEqual([[FARMER]]);
  });

  it("staffs the bakery with its carrier on top of the baker (the plan's one carrier post)", () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
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

  it('hires the iron collector only once the build order reaches its gated entry', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    spawnMen(sim, 4);
    sim.step();

    // The gate: iron is listed after the farm entry, so an unmet farm keeps it unwanted.
    const gated = workforceModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'collector', good: 'iron' },
    ]);
    const before = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(before.filter((c) => c.kind === 'setGatherGood')).toEqual([]);

    // A standing farm (any construction state counts) satisfies the entry — iron is now wanted.
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 36, y: 16, tribe: VIKING, owner: SEAT });
    sim.step();
    const after = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(after.filter((c) => c.kind === 'setGatherGood').map((c) => c.goodType)).toEqual([IRON]);
  });

  it('turns an idle scout back into a builder once the wanted lattice is done', () => {
    // A map too small for any first-ring lattice target (±22 columns / ±34 rows off the HQ).
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(20, 12) });
    placeHq(sim, 10, 6);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 4, y: 4, tribe: VIKING, owner: SEAT });
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
    sim.enqueue(command);
    sim.step();
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueue({ kind: 'debugCompleteConstruction', target: e });
    }
    sim.step();
  }

  it('executes the opening list in order near the HQ, one open site at a time', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]); // a live iron node keeps the collector entry waiting
    sim.step();

    // Farm first — on a free node close to the HQ, as a construction site owned by the seat.
    const first = nextPlacement(sim);
    expect(first?.kind).toBe('placeBuilding');
    if (first?.kind !== 'placeBuilding') return;
    expect(first.buildingType).toBe(FARM_TYPE);
    expect(first.underConstruction).toBe(true);
    expect(first.owner).toBe(SEAT);
    const dist = Math.abs(first.x - HQ_X) + Math.abs(first.y - HQ_Y);
    expect(dist).toBeGreaterThan(0); // never on the HQ's own node
    expect(dist).toBeLessThanOrEqual(4); // the closest free ring, not a far scatter
    sim.enqueue(first);
    sim.step();

    // One open site — the executor stalls until it finishes.
    expect(nextPlacement(sim)).toBeUndefined();
    for (const e of [...sim.world.query(UnderConstruction)]) {
      sim.enqueue({ kind: 'debugCompleteConstruction', target: e });
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

    // The gated iron-collector entry: the executor waits (the workforce module does the hiring);
    // the later smithy entries are absent from this content, so a standing collector ends the list.
    expect(nextPlacement(sim)).toBeUndefined();
    sim.enqueue({ kind: 'spawnSettler', jobType: COLLECTOR, x: 12, y: 24, tribe: VIKING, owner: SEAT });
    sim.step();
    const settler = [...sim.world.query(Settler)].at(-1);
    if (settler === undefined) throw new Error('setup: collector missing');
    sim.enqueue({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
    sim.enqueue({ kind: 'setGatherGood', entity: settler, goodType: IRON });
    sim.step();
    expect(nextPlacement(sim)).toBeUndefined();
  });

  it('re-places a destroyed building (the count repairs itself)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    sim.enqueue(first);
    sim.step();
    const farm = entityOfBuilding(sim, FARM_TYPE);
    sim.enqueue({ kind: 'debugCompleteConstruction', target: farm });
    sim.step();
    sim.enqueue({ kind: 'demolish', building: farm });
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
});

describe('build-order placement — affinity and ground rules', () => {
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

  it('places the farm only on plantable ground — a barren pocket is skipped, a barren map stalls', () => {
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

    // An all-sand map stalls the farm (hard rule) even though the ground is buildable — proven by
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
    sim.enqueue({
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

describe('signpost-coverage module (guideBuild)', () => {
  it('starts the lattice beside the HQ, then walks the six-post ring outward', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    const commands = [...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands).toHaveLength(1);
    const order = commands[0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    // The first post lands beside the HQ (the lattice's centre target).
    expect(withinNodeRadius(order.x, order.y, HQ_X, HQ_Y, SIGNPOST_TARGET_TOLERANCE_NODES)).toBe(true);

    // With the centre post standing, the next order walks the first ring (its east corner fits
    // this map; the ±34-row targets fall off it and are skipped).
    plantPostAtHq(sim);
    const next = [...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (next?.kind !== 'placeSignpost') throw new Error('expected a first-ring placement');
    const east = signpostLatticeOffset(1, 0);
    expect(
      withinNodeRadius(next.x, next.y, HQ_X + east.dx, HQ_Y + east.dy, SIGNPOST_TARGET_TOLERANCE_NODES),
    ).toBe(true);
  });

  it('extends the lattice only where the settlement builds (the field grows with the buildings)', () => {
    const CENTER = { x: 128, y: 128 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, CENTER.x, CENTER.y);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 100, y: 100, tribe: VIKING, owner: SEAT });
    sim.step();
    // The centre and all six first-ring targets stand satisfied — the always-wanted lattice is done.
    plantPost(sim, positionOfNode(CENTER.x, CENTER.y));
    for (const [q, r] of [
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
    ] as const) {
      const o = signpostLatticeOffset(q, r);
      plantPost(sim, positionOfNode(CENTER.x + o.dx, CENTER.y + o.dy));
    }
    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A new building near the second ring's east corner makes exactly that outer target wanted.
    const reach = signpostLatticeOffset(2, 0);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: CENTER.x + reach.dx - 2,
      y: CENTER.y + reach.dy,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = [...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected an expansion placement');
    expect(
      withinNodeRadius(
        order.x,
        order.y,
        CENTER.x + reach.dx,
        CENTER.y + reach.dy,
        SIGNPOST_TARGET_TOLERANCE_NODES,
      ),
    ).toBe(true);
  });

  it('does nothing without a scout', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

describe('population module (homeExpansion)', () => {
  function populationSim(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (let i = 0; i < 2; i++) {
      sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 6 + 2 * i, y: 8, tribe: VIKING, owner: SEAT });
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

  it('houses married women and orders daughters up to the family slots, then sons', () => {
    const sim = populationSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 36, y: 16, tribe: VIKING, owner: SEAT });
    for (const woman of womenOf(sim)) sim.enqueue({ kind: 'marry', entity: woman });
    // Let the couples walk together and kiss — both marriages must stand before the module houses them.
    for (let i = 0; i < 3000 && womenOf(sim).some((w) => !sim.world.has(w, Marriage)); i++) sim.step();
    expect(womenOf(sim).every((w) => sim.world.has(w, Marriage))).toBe(true);

    const houseCommands = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    const home = entityOfBuilding(sim, HOME_TYPE);
    expect(houseCommands.filter((c) => c.kind === 'assignHouse').map((c) => c.house)).toEqual([home, home]);
    for (const c of houseCommands) sim.enqueue(c);
    sim.step();

    // 2 women against 2 family slots: the count is met, so both standing orders are sons. A second
    // home (2 more slots) flips the next orders to daughters.
    const orders = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(orders.filter((c) => c.kind === 'makeChild').map((c) => c.child)).toEqual(['male', 'male']);
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 24, y: 16, tribe: VIKING, owner: SEAT });
    sim.step();
    const withRoom = [...populationModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(withRoom.filter((c) => c.kind === 'makeChild').map((c) => c.child)).toEqual(['female', 'female']);
  });
});

describe('the full strategic registry — determinism and replay', () => {
  const TICKS = 120;

  function liveRun(): Simulation {
    const sim = aiSim(11);
    placeHq(sim);
    placeResources(sim);
    spawnMen(sim, 5);
    sim.enqueue({ kind: 'spawnSettler', jobType: WOMAN, x: 20, y: 8, tribe: VIKING, owner: SEAT });
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true });
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

  it('carries the opening list to completion unattended (stocked HQ + fourteen men is enough)', () => {
    const sim = aiSim(21);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      fillStock: true,
    });
    placeResources(sim);
    // Fourteen men: four collectors (iron once reached), the scout, and five staffing posts
    // (farmer, miller, baker, the bakery carrier, the well's transport slot) still leave builders
    // free to raise the list — the allocation priority is the user's plan.
    spawnMen(sim, 14);
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(12000);
    const built = [...sim.world.query(Building)].filter(
      (e) => !sim.world.has(e, UnderConstruction) && sim.world.get(e, Building).buildingType !== HQ_TYPE,
    );
    // The farm, the mill/bakery/well chain, and all three homes at the TOP tier stand finished
    // (the fixture's whole placeable list, homes upgraded twice each).
    expect(built.map((e) => sim.world.get(e, Building).buildingType).sort((a, b) => a - b)).toEqual(
      [HOME_TOP_TYPE, HOME_TOP_TYPE, HOME_TOP_TYPE, FARM_TYPE, WELL_TYPE, MILL_TYPE, BAKERY_TYPE].sort(
        (a, b) => a - b,
      ),
    );
    // The farm got its farmer and the bakery its baker AND carrier, all from the builder pool.
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    const posts = [...sim.world.query(Settler, JobAssignment)].map((e) => ({
      workplace: sim.world.get(e, JobAssignment).workplace,
      jobType: sim.world.get(e, Settler).jobType,
    }));
    expect(posts.some((p) => p.workplace === farm && p.jobType === FARMER)).toBe(true);
    expect(posts.some((p) => p.workplace === bakery && p.jobType === BAKER)).toBe(true);
    expect(posts.some((p) => p.workplace === bakery && p.jobType === CARRIER)).toBe(true);
    // The gated iron collector was hired once the list reached its entry (the tiny fixture patch
    // is long harvested dry by now, so the proof is the logged hire, not a standing flag).
    const ironHired = sim.commands.log.some(
      (c) => c.command.kind === 'setGatherGood' && c.command.goodType === IRON,
    );
    expect(ironHired).toBe(true);
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
  });
});
