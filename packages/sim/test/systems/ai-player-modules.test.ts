import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
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
import { EventBuffer, fx, positionOfNode, Rng, replay, Simulation } from '../../src/index.js';
import { withinNodeRadius } from '../../src/nav/node-metric.js';
import { EAT_ATOMIC_ID } from '../../src/systems/agents/actions.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  BUILDER_CAP,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  populationModule,
  SIGNPOST_TARGET_TOLERANCE_NODES,
  signpostCoverageModule,
  signpostLatticeOffset,
  TOWER_DEFENCE_RADIUS_NODES,
  workforceModule,
} from '../../src/systems/ai-player/index.js';
import { interactionNode } from '../../src/systems/footprint/interaction.js';
import type { SystemContext } from '../../src/systems/index.js';
import { isFighterJob, stampResourceFootprintData } from '../../src/systems/index.js';
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
const BAKERY_TOP_TYPE = 9;
const BREWERY_TYPE = 10;
const JOINERY_TYPE = 11;
const BARRACKS_TYPE = 12;
const STOCK_TYPE = 13;
const STOCK_TOP_TYPE = 14;
const TOWER_TYPE = 15;
const WALL_TYPE = 16;
/** The joinery's iron-tool product (fixture) — the craft restriction's one selected good. */
const TOOL_IRON = 7;
/** The stone-collector XP track (fixture = real track id 5) iron's `needforgood` measures. */
const STONE_XP_TRACK = 5;
/** Raw XP clearing iron's `needforgood` gate: 10 repeats × the stone track's factor 100. */
const IRON_GATE_XP = 1000;
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
  // Rows of 28 keep every spawn inside the 64-wide fixture map, whatever the count.
  for (let i = 0; i < count; i++) {
    const x = 4 + 2 * (i % 28);
    const y = 4 + 2 * Math.floor(i / 28);
    sim.enqueue({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: SEAT });
  }
}

function placeResources(
  sim: Simulation,
  spots: readonly { x: number; y: number; good: number; harvest: number }[] = Object.values(RESOURCE_SPOTS),
  remaining = 5,
): void {
  for (const spot of spots) {
    sim.enqueue({
      kind: 'placeResource',
      good: spot.good,
      x: spot.x,
      y: spot.y,
      remaining,
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

/** The fixture HQ is footprint-less; the door tests need one shaped like the extracted `[GfxHouse]`
 *  records — a walled body with the door outside it, on the west side. */
const HQ_DOOR = { dx: -1, dy: 0 };
const HQ_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: HQ_DOOR,
};

function doorHqContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) => (b.typeId === HQ_TYPE ? { ...b, footprint: HQ_FOOTPRINT } : b)),
  });
}

function plantPostAtHq(sim: Simulation): void {
  plantPost(sim, sim.world.get(entityOfBuilding(sim, HQ_TYPE), Position));
}

/** A standing wall Resource whose footprint walk-blocks exactly `cells` — anchored on remote open
 *  ground so the anchor's own node (which a Resource blocks for placement) seals nothing nearby. */
function wallOver(sim: Simulation, cells: readonly { x: number; y: number }[]): void {
  const anchor = { x: 2, y: 2 };
  const wall = sim.world.create();
  sim.world.add(wall, Position, positionOfNode(anchor.x, anchor.y));
  sim.world.add(wall, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: WOOD_HARVEST });
  stampResourceFootprintData(sim.world, wall, {
    walk: cells.map((c) => ({ dx: c.x - anchor.x, dy: c.y - anchor.y })),
    build: [],
    work: [],
  });
}

describe('workforce module (collectResources)', () => {
  it('hires flag collectors beside their resources, one scout, an HQ carrier, and the builder reserve', () => {
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
    // Three collectors in the plan's clay → stone → wood order, then the scout; the HQ's minimum
    // carrier claims the fifth man, and the last one joins the builder reserve.
    expect(jobs.map((j) => j.jobType)).toEqual([COLLECTOR, COLLECTOR, COLLECTOR, SCOUT, BUILDER]);
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD]);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    expect(staffing.map((c) => [c.building, ...c.jobPriority])).toEqual([[hq, CARRIER]]);
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

  it('tops wood/stone up to two collectors and adds generic gatherers once the reserve stands', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.mud, RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, 18);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const selections = commands.filter((c) => c.kind === 'setGatherGood');
    // First posts in plan order, then the stone/wood top-ups (mud stays at one), then one
    // collect-anything flag (18 men: 3 + scout + HQ min carrier + 8 reserve = 13 claimed, the
    // top-ups take two, the HQ's two target carriers two more, and the last man goes generic).
    expect(selections.map((s) => s.goodType)).toEqual([MUD, STONE, WOOD, STONE, WOOD, null]);
    // Each post gets a node of its own. A good's top-up re-derives the same nearest resource as its
    // first post, so without the decision's claimed-node set the two flags land on one tile — one
    // delivery yard, one pile cap, two gatherers.
    const spots = commands.filter((c) => c.kind === 'setWorkFlag').map((c) => `${c.x},${c.y}`);
    expect(new Set(spots).size).toBe(spots.length);

    // Every post is recognized on the next decision — no churn, nothing left to do.
    for (const c of commands) sim.enqueue(c);
    sim.step();
    expect([...collectModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('retires a generic collector whose circle holds nothing its trade can harvest', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: COLLECTOR, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: gatherer missing');
    sim.enqueue({ kind: 'setWorkFlag', entity: gatherer, x: 12, y: 12 });
    sim.enqueue({ kind: 'setGatherGood', entity: gatherer, goodType: null });
    sim.step();

    // No resource stands anywhere: the generic flag feeds nothing — back to the builder pool.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => c.kind === 'setJob' && c.entity === gatherer)).toEqual([
      { kind: 'setJob', entity: gatherer, jobType: BUILDER },
    ]);
  });

  it('claims at most eight builders; leftover men keep their trade', () => {
    const sim = aiSim();
    placeHq(sim);
    // No resources: no collectors wanted — the ladder is scout + HQ carriers + the reserve.
    spawnMen(sim, 14);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const builders = commands.filter((c) => c.kind === 'setJob').filter((c) => c.jobType === BUILDER);
    expect(builders).toHaveLength(BUILDER_CAP);
    // 14 men: the scout, the HQ's three carriers (min + target), and 8 builders = 12 claimed; the
    // two leftovers get NO order — the cap never over-converts.
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

  it('staffs the farm with its two-farmer minimum, never the carrier slot', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    // No resources on this map: no collectors are wanted, staffing draws straight from the builders.
    spawnMen(sim, 6, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === farm);
    // Two farmers (the farm's raised minimum) despite 4 farmer slots; the third waits for the
    // target tier behind the builder reserve, and the farm's carrier slot is never filled.
    expect(staffing.map((c) => c.jobPriority)).toEqual([[FARMER], [FARMER]]);
  });

  it('tops the farm up to three farmers once the surplus clears the reserve', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 40, y: 16, tribe: VIKING, owner: SEAT });
    spawnMen(sim, 14, BUILDER);
    sim.step();

    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const farm = entityOfBuilding(sim, FARM_TYPE);
    const staffing = commands.filter((c) => c.kind === 'assignWorker').filter((c) => c.building === farm);
    expect(staffing.map((c) => c.jobPriority)).toEqual([[FARMER], [FARMER], [FARMER]]);
  });

  it('staffs the HQ and a warehouse with one to three carriers, leaving harvest slots open', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
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
    // Min tier gives each storage its first carrier; the target tier tops both up to three. The
    // collector slots both storages declare are harvest trades and stay open throughout.
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

  it('leaves a carrier-only workplace (the well) unstaffed', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'placeBuilding', buildingType: WELL_TYPE, x: 40, y: 16, tribe: VIKING, owner: SEAT });
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
    // One man has dug stone before — iron's `needforgood` XP gate demands an experienced digger.
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

    // A standing farm (any construction state counts) satisfies the entry — iron is now wanted,
    // and the hire lands on the one man whose XP clears the threshold.
    sim.enqueue({ kind: 'placeBuilding', buildingType: FARM_TYPE, x: 36, y: 16, tribe: VIKING, owner: SEAT });
    sim.step();
    const after = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(after.filter((c) => c.kind === 'setGatherGood')).toEqual([
      { kind: 'setGatherGood', entity: veteran, goodType: IRON },
    ]);
  });

  it('never trades one ungated good\u2019s collector for another\u2019s', () => {
    const sim = aiSim();
    placeHq(sim);
    // Stone and wood both stand, both ungated — and exactly one man, who takes the first post.
    placeResources(sim, [RESOURCE_SPOTS.stone, RESOURCE_SPOTS.wood]);
    spawnMen(sim, 1);
    sim.step();
    const both = workforceModule([]);
    for (const c of both.run(sim.world, ctxOf(sim), SEAT)) sim.enqueue(c);
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

    // Fresh men: stone hires (ungated); iron finds no qualified spare and no veteran — it waits.
    const fresh = [...gated.run(sim.world, ctxOf(sim), SEAT)];
    expect(fresh.filter((c) => c.kind === 'setGatherGood').map((c) => c.goodType)).toEqual([STONE]);
    for (const c of fresh) sim.enqueue(c);
    sim.step();

    // The stone collector has dug (its stone-track XP stands): the next decision re-posts IT onto
    // iron — the fresh spare still may not mine iron.
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
    for (const c of swap) sim.enqueue(c);
    sim.step();

    // The vacated stone post is rehired once a spare man exists again — self-healing. (The first
    // decision's ladder claimed every original man: collector, scout, HQ carrier.)
    sim.enqueue({ kind: 'spawnSettler', jobType: CIVILIST, x: 6, y: 6, tribe: VIKING, owner: SEAT });
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
    for (const c of collectModule.run(sim.world, ctxOf(sim), SEAT)) sim.enqueue(c);
    sim.step();

    // Drain the original node; a survivor stands INSIDE the work circle but beyond the 2–3-tile
    // band (wherever in that band the flag stood), so the patch never runs dry and only the
    // periodic upkeep can move the flag.
    const DRIFTED = { x: RESOURCE_SPOTS.wood.x + 14, y: RESOURCE_SPOTS.wood.y };
    for (const e of sim.world.query(Resource)) sim.world.get(e, Resource).remaining = 0;
    sim.enqueue({
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
    // …the upkeep decision (every 30th — tick 720) re-plants it into the survivor's band.
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
    sim.enqueue({
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

describe('workforce module — the barracks and craft selections', () => {
  it('never staffs the barracks: it is a military building, not a workplace the plan crews', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: 40,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    spawnMen(sim, 18, BUILDER);
    sim.step();

    // The barracks declares carrier slots like any store, but the seat posts nobody to them (user
    // rule 2026-07-26) and mints no soldier: the fighter band is earned at the barracks, and until
    // training lands (docs/tickets/features/barracks-training.md) the surplus stays civilian.
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const barracks = entityOfBuilding(sim, BARRACKS_TYPE);
    const posted = commands.filter((c) => c.kind === 'assignWorker');
    // The staffing pass ran — the HQ took its carriers — and skipped the barracks beside it.
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((c) => c.building === entityOfBuilding(sim, HQ_TYPE))).toBe(true);
    expect(posted.filter((c) => c.building === barracks)).toEqual([]);
    expect(commands.filter((c) => c.kind === 'setJob' && isFighterJob(sim.content, c.jobType))).toEqual([]);
  });

  it('keeps a joinery operator on iron tools only, idempotently', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({
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
    for (const c of first) sim.enqueue(c);
    sim.step();

    const second = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    const tuned = second.filter((c) => c.kind === 'setCraftGoods');
    const joiner = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, JobAssignment).workplace === entityOfBuilding(sim, JOINERY_TYPE),
    );
    expect(tuned).toEqual([{ kind: 'setCraftGoods', entity: joiner, goods: [TOOL_IRON] }]);

    // Applied once, the selection matches — the next decision issues nothing.
    for (const c of second) sim.enqueue(c);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'setCraftGoods'),
    ).toEqual([]);
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
    sim.enqueue({ kind: 'spawnSettler', jobType: COLLECTOR, x: 12, y: 24, tribe: VIKING, owner: SEAT });
    sim.step();
    const settler = [...sim.world.query(Settler)].at(-1);
    if (settler === undefined) throw new Error('setup: collector missing');
    sim.enqueue({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
    sim.enqueue({ kind: 'setGatherGood', entity: settler, goodType: IRON });
    sim.step();

    // Past the gate: the barracks, the bakery upgrade, then the 2026-07-25 tail — the tower
    // coverage entry rests (everything sits inside the HQ circle on this map), the second bakery
    // arrives directly at its level-2 tier, the second brewery, and the two outskirts warehouses
    // end the list. The five-home entry names `home_level_04`, a tier this content set stops short
    // of, so it skips here — the direct top-tier placement has its own test below.
    const barracks = nextPlacement(sim);
    if (barracks?.kind !== 'placeBuilding') throw new Error('expected the barracks placement');
    expect(barracks.buildingType).toBe(BARRACKS_TYPE);
    applyAndFinish(sim, barracks);
    const upgrade = nextPlacement(sim);
    if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected the bakery upgrade');
    expect(sim.world.get(upgrade.building, Building).buildingType).toBe(BAKERY_TYPE);
    applyAndFinish(sim, upgrade);
    for (const expected of [BAKERY_TOP_TYPE, BREWERY_TYPE, STOCK_TOP_TYPE, STOCK_TOP_TYPE]) {
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

  it('places a further home straight at the top tier instead of growing it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    // The tail's housing rule (user decision 2026-07-26): the opening homes walk the upgrade chain,
    // but every home after them is placed at the top tier outright — its own construction bill.
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
    // The building now stands at the upper tier — the level-0 place entry stays satisfied.
    expect(sim.world.get(bakery, Building).buildingType).toBe(BAKERY_TOP_TYPE);
    expect([...placeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
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
      sim.enqueue({ kind: 'debugCompleteConstruction', target: e });
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
    sim.enqueue({
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

    // The tower SITE already counts as coverage; a finished tower keeps the entry satisfied — and
    // the entry is perpetual: another far building re-arms it.
    sim.enqueue(order);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    completeSites(sim);
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    sim.enqueue({
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
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: WALL_TYPE,
      x: FAR.x - 2,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    // The wall shares kind 'tower' but is not in the tower id allowlist — the home stays uncovered.
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement despite the wall');
    expect(order.buildingType).toBe(TOWER_TYPE);
  });

  it('pushes an outskirts placement past the frontier building and spreads successive warehouses', () => {
    const sim = aiSim();
    placeHq(sim);
    const FRONTIER = { x: HQ_X + 14, y: HQ_Y };
    sim.enqueue({
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
    // The spot lands on the far side of the frontier building — farther from the settlement
    // centroid than the frontier itself.
    const centroid = { x: Math.floor((HQ_X + FRONTIER.x) / 2), y: HQ_Y };
    const frontierDist = Math.abs(FRONTIER.x - centroid.x) + Math.abs(FRONTIER.y - centroid.y);
    const spotDist = Math.abs(first.x - centroid.x) + Math.abs(first.y - centroid.y);
    expect(spotDist).toBeGreaterThan(frontierDist);
    sim.enqueue(first);
    sim.step();
    completeSites(sim);

    // The second warehouse never anchors on the first (its own kind is excluded from the frontier
    // pick) — the pair spreads instead of stacking.
    const second = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (second?.kind !== 'placeBuilding') throw new Error('expected the second warehouse placement');
    expect(second.x === first.x && second.y === first.y).toBe(false);
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

  it('stands the centre post one cell west of a footprinted HQ door, never in the doorway', () => {
    // A door is the one passable gate in the walk-block, so an unguarded legal-spot search settles
    // exactly on it — the post then blocks where the HQ's settlers enter and leave.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...signpostCoverageModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    const doorway = interactionNode(sim.world, ctx, entityOfBuilding(sim, HQ_TYPE));
    expect(doorway).toEqual({ x: HQ_X + HQ_DOOR.dx, y: HQ_Y + HQ_DOOR.dy });
    expect({ x: order.x, y: order.y }).toEqual({ x: (doorway?.x ?? 0) - 2, y: doorway?.y });
  });

  it('skips a legal spot sealed inside a walk-block pocket instead of re-aiming at it every decision', () => {
    // The overlay-sealed-target loop: the spot beside the door is clear ground, but a blocker ring
    // seals it into a one-node pocket. The walk there fails, playerOrderSystem sheds the failed order
    // before the stranded pacing can note it, and the module re-picks the same spot every decision.
    // The chooser must refuse the provably sealed spot up front and settle nearby instead.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    // Seal the centre spot (doorway - 2, proven by the door test above) inside a ring of its eight
    // lattice neighbours, leaving the spot itself clear ground both overlays accept.
    const sealed = { x: HQ_X + HQ_DOOR.dx - 2, y: HQ_Y + HQ_DOOR.dy };
    wallOver(
      sim,
      [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 2 },
        { dx: 1, dy: -2 },
        { dx: -1, dy: 2 },
        { dx: -1, dy: -2 },
      ].map((o) => ({ x: sealed.x + o.dx, y: sealed.y + o.dy })),
    );

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...signpostCoverageModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    expect({ x: order.x, y: order.y }).not.toEqual(sealed);
    // Still the centre target: the pick settles on reachable ground within the same tolerance.
    expect(withinNodeRadius(order.x, order.y, sealed.x, sealed.y, SIGNPOST_TARGET_TOLERANCE_NODES)).toBe(
      true,
    );
  });

  it('fails open to the unvetoed search when the door itself is sealed in a pocket', () => {
    // The inversion hazard: the veto judges spots from the HQ door, so a door sealed inside its own
    // pocket would read every open-ground spot as unroutable and the module would stop erecting
    // entirely. A pocketed reference must disable the veto, not invert it.
    const sim = new Simulation({ seed: 1, content: doorHqContent(), map: grassNodeMap(64, 32) });
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();

    // Wall the door's seven open lattice neighbours (the eighth, east, is the HQ body): the door
    // becomes a one-node pocket.
    const door = { x: HQ_X + HQ_DOOR.dx, y: HQ_Y + HQ_DOOR.dy };
    wallOver(
      sim,
      [
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 2 },
        { dx: 1, dy: -2 },
        { dx: -1, dy: 2 },
        { dx: -1, dy: -2 },
      ].map((o) => ({ x: door.x + o.dx, y: door.y + o.dy })),
    );

    const ctx = { ...ctxOf(sim), content: doorHqContent() };
    const order = [...signpostCoverageModule.run(sim.world, ctx, SEAT)][0];
    if (order?.kind !== 'placeSignpost') throw new Error('expected a placeSignpost order');
    expect(withinNodeRadius(order.x, order.y, door.x - 2, door.y, SIGNPOST_TARGET_TOLERANCE_NODES)).toBe(
      true,
    );
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

  it('leaves a scout mid-action alone, so a meal longer than the decision beat can finish', () => {
    // The regression: both order markers are shed the moment a need drive starts an atomic, so an
    // eating scout used to read as idle. The module then re-ordered it every 24-tick beat and
    // `moveUnit` cancelled the half-eaten meal — the scout ate forever and never fed.
    const sim = aiSim();
    placeHq(sim);
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('expected a spawned scout');
    // Work remains, and with no atomic running the module does want to order it.
    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);

    sim.world.add(scout, CurrentAtomic, {
      atomicId: EAT_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 50,
      effect: { kind: 'eat', goodType: 3, from: null },
      targetEntity: scout,
      targetTile: null,
    });

    expect([...signpostCoverageModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('does not retire a scout mid-action — setJob would cancel the running atomic', () => {
    // The retirement twin of the guard above, and the more destructive one: `setJob` cancels whatever
    // the settler is doing, so retiring an eating scout throws the meal away.
    const sim = aiSim();
    placeHq(sim);
    // No resources and one man: the lattice has no work left to want, so the scout is retirable.
    sim.enqueue({ kind: 'spawnSettler', jobType: SCOUT, x: 10, y: 10, tribe: VIKING, owner: SEAT });
    sim.step();
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('expected a spawned scout');

    sim.world.add(scout, CurrentAtomic, {
      atomicId: EAT_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 50,
      effect: { kind: 'eat', goodType: 3, from: null },
      targetEntity: scout,
      targetTile: null,
    });

    const retires = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
      (c) => c.kind === 'setJob' && c.entity === scout,
    );
    expect(retires).toEqual([]);
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

  // A long unattended run shares CPU with the whole suite — the explicit timeout keeps a loaded
  // machine from flaking it.
  it('carries the opening list to completion unattended (stocked HQ + a large crew)', {
    timeout: 60_000,
  }, () => {
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
    // Deep deposits: a whole ladder of gatherers works these spots for the length of the run, and a
    // 5-unit deposit would run dry long before the list closes.
    placeResources(sim, Object.values(RESOURCE_SPOTS), 40);
    // The crew covers the ladder's essentials — the collectors (with top-ups), the scout, the
    // minimum staffing of every workshop the list raises, and the eight-builder reserve that
    // actually raises it. Target-tier extras beyond that wait for grown sons, which this run
    // doesn't simulate. The list closes by ~5000 ticks; 6000 keeps slack without dragging the
    // suite (per-tick cost here is dominated by the settler micro-planner, not the strategic AI).
    spawnMen(sim, 26);
    sim.enqueue({ kind: 'setPlayerAi', player: SEAT, enabled: true });
    sim.run(6000);
    const built = [...sim.world.query(Building)].filter(
      (e) => !sim.world.has(e, UnderConstruction) && sim.world.get(e, Building).buildingType !== HQ_TYPE,
    );
    // The whole fixture-expressible list stands finished: the farm/mill/bakery/well chain, three
    // TOP-tier homes (the tail's further homes name a tier above this content set's chain, so they
    // skip here), the upgraded bakery AND the direct-placed second level-2 bakery, two breweries,
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
        BREWERY_TYPE,
        BREWERY_TYPE,
        JOINERY_TYPE,
        BARRACKS_TYPE,
        STOCK_TOP_TYPE,
        STOCK_TOP_TYPE,
      ].sort((a, b) => a - b),
    );
    // The farm runs its two-farmer minimum and the first bakery keeps its carrier; the joinery's
    // joiner was locked onto iron tools; the gated iron collector was hired once the list reached
    // its entry (the tiny fixture patch is long harvested dry by now, so the proof is the logged
    // command); and the builder crew never exceeds its cap of eight.
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
  });
});
