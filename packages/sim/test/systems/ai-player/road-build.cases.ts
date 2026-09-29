import { describe, expect, it } from 'vitest';
import {
  BuildMode,
  Position,
  RoadSite,
  Settler,
  Stockpile,
  setStockAmount,
} from '../../../src/components/index.js';
import { aiCommand, type PlayerCommand } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { hexNeighboursOf, nodeOfPosition, Simulation } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { ROADS_FROM_TICKS } from '../../../src/systems/ai-player/game-phase.js';
import {
  BACKLOG_ROAD_CREW,
  DEFAULT_BUILD_ORDER,
  MAX_PENDING_ROAD_SITES,
  ROAD_BACKLOG_SITES,
  ROAD_CREW,
  ROAD_SITES_PER_DECISION,
  roadBuildModule,
  SeatSupply,
  supplyLines,
} from '../../../src/systems/ai-player/index.js';
import { ownedBuildings } from '../../../src/systems/ai-player/seat-roster.js';
import {
  OPENING_SITE_SHORTAGE_POSTS,
  ROAD_SITE_SHORTAGE_POSTS,
  wantedCollectorGoods,
} from '../../../src/systems/ai-player/workforce/collectors/index.js';
import { structureBlockOverlay } from '../../../src/systems/footprint/blocked.js';
import { createSignpost } from '../../../src/systems/index.js';
import { layRoad, roadNodeCount, roadNodes } from '../../../src/systems/roads/index.js';
import { ownedRoadSites, roadSitesByNode } from '../../../src/systems/roads/site-index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  BUILDER,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  SEAT,
  STONE,
  spawnMen,
  VIKING,
} from './support.js';

/** A home far enough west of the HQ that its road runs a good stretch of open grass. */
const HOME_X = HQ_X - 16;
const HOME_Y = HQ_Y;
/** The first row the crew cases lay their hand-placed road sites on, clear of the HQ's body, and the
 *  rows between two of their rows. */
const SITE_ROW = HQ_Y + 8;
const SITE_ROW_STEP = 2;
const FIRST_SITE_X = 6;
const SITES_PER_ROW = 12;
/** Nodes between two hand-placed sites in a row, so no site's finish paves another. */
const SITE_SPACING = 3;
/** Two home sites east of the HQ that keep the seat's automatic builders busy, so the road sites wait
 *  for the road crew (roads come after every building site). */
const BUSY_SITES = [
  { x: HQ_X + 12, y: HQ_Y - 8 },
  { x: HQ_X + 12, y: HQ_Y + 8 },
];
/** Game ticks the laying run lasts: enough for the crew to fetch the HQ's stone and pave the route. */
const LAYING_RUN_TICKS = 6000;
/** What the fixture HQ holds of stone once filled. */
const HQ_STONE_CAPACITY = 150;
/** Ticks within which a roadster notices his run has no site left: a stone errand across the map. */
const RUN_END_TICKS = 600;
/** Builders the crew cases give the seat. */
const CREW_CASE_BUILDERS = 6;

/** A seat at the road clock with its stocked HQ, a built home to the west and `men` builders. */
function roadSim(seed: number, men: number): Simulation {
  const sim = new Simulation({ seed, content: aiContent(), map: grassNodeMap(64, 32) });
  sim.restoreTick(ROADS_FROM_TICKS);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    fillStock: true,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HOME_TYPE,
    x: HOME_X,
    y: HOME_Y,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, men, BUILDER);
  sim.step();
  return sim;
}

/** {@link roadSim} whose builders are busy raising {@link BUSY_SITES}. */
function busySim(seed: number): Simulation {
  const sim = roadSim(seed, CREW_CASE_BUILDERS);
  for (const { x, y } of BUSY_SITES) {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x,
      y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
  }
  sim.step();
  return sim;
}

/** Hand-place `count` of the seat's road sites in rows from {@link SITE_ROW}. */
function placeSites(sim: Simulation, count: number, firstRow = SITE_ROW): void {
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'placeRoadSite',
      x: FIRST_SITE_X + SITE_SPACING * (i % SITES_PER_ROW),
      y: firstRow + SITE_ROW_STEP * Math.floor(i / SITES_PER_ROW),
      tribe: VIKING,
      owner: SEAT,
    });
  }
  sim.step();
}

function apply(sim: Simulation, commands: readonly PlayerCommand[]): void {
  for (const command of commands) sim.enqueue(aiCommand(SEAT, command));
  sim.step();
}

const roadsters = (sim: Simulation): Entity[] =>
  [...sim.world.query(Settler, BuildMode)].filter((e) => sim.world.get(e, BuildMode).kind === 'roads');

const sitesOf = (sim: Simulation): number =>
  sim.terrain === undefined ? 0 : ownedRoadSites(sim.world, sim.terrain, SEAT).size;

const named = (commands: readonly PlayerCommand[], e: Entity): PlayerCommand[] =>
  commands.filter((c) => 'entity' in c && c.entity === e);

/** The seat's HQ door, where every route of these cases ends. */
const HQ_DOOR = { x: HQ_X, y: HQ_Y + 4 };
/** A node on the straight line between the home and the HQ door, clear of both bodies. */
const MIDWAY = { x: HQ_X - 8, y: HQ_Y + 2 };
/** Decisions a route between the home and the HQ takes to place whole, a site cap's worth apiece. */
const ROUTE_DECISIONS = 4;
/** How far from either end of the road the cut falls, in nodes, so both sides keep a stretch of road. */
const CUT_MARGIN_NODES = 4;

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim');
  return sim.terrain;
}

/** Run the road module decision after decision, applying each, until it places nothing more. Returns
 *  every command it placed. */
function placeWholeRoute(sim: Simulation): PlayerCommand[] {
  const placed: PlayerCommand[] = [];
  for (let i = 0; i < ROUTE_DECISIONS; i++) {
    const commands = roadBuildModule.run(sim.world, ctxOf(sim, sim.tick), SEAT);
    if (commands.length === 0) break;
    placed.push(...commands);
    apply(sim, commands);
  }
  return placed;
}

/** Whether roads and road sites join the building at `from` to the one at `to` node by node over the
 *  ring a road paints across, from beside the one to beside the other: an entrance on a building's
 *  own body takes no road. */
function paved(sim: Simulation, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const terrain = terrainOf(sim);
  const sites = roadSitesByNode(sim.world, terrain);
  const blocked = structureBlockOverlay(sim.world, ctxOf(sim, sim.tick), terrain);
  const carries = (node: NodeId): boolean => (terrain.isRoad(node) || sites.has(node)) && !blocked.has(node);
  const ring = (x: number, y: number): NodeId[] => [
    terrain.nodeAt(x, y),
    ...hexNeighboursOf(x, y)
      .filter((n) => terrain.inBounds(n.hx, n.hy))
      .map((n) => terrain.nodeAt(n.hx, n.hy)),
  ];
  const goal = new Set(ring(to.x, to.y));
  const open = ring(from.x, from.y).filter(carries);
  const seen = new Set<NodeId>(open);
  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    if (goal.has(node)) return true;
    for (const next of ring(terrain.xOf(node), terrain.yOf(node))) {
      if (seen.has(next) || !carries(next)) continue;
      seen.add(next);
      open.push(next);
    }
  }
  return false;
}

/** Turn every road site into road, as a finished run would. */
function paveSites(sim: Simulation): void {
  const terrain = terrainOf(sim);
  const nodes: NodeId[] = [];
  for (const e of sim.world.query(RoadSite, Position)) {
    const at = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
    nodes.push(terrain.nodeAt(at.hx, at.hy));
  }
  layRoad(sim.world, terrain, nodes);
  apply(
    sim,
    [...sim.world.query(RoadSite)].map((roadSite) => ({ kind: 'cancelRoadSite', roadSite }) as const),
  );
}

describe('road build module (roadBuild)', () => {
  it('routes a built home to the base with road sites, from the road clock on', () => {
    const sim = roadSim(1, 0);
    expect(roadBuildModule.run(sim.world, ctxOf(sim, ROADS_FROM_TICKS - 1), SEAT)).toEqual([]);

    const placed = roadBuildModule.run(sim.world, ctxOf(sim, ROADS_FROM_TICKS), SEAT);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThanOrEqual(ROAD_SITES_PER_DECISION);
    for (const c of placed) {
      if (c.kind !== 'placeRoadSite') throw new Error(`unexpected ${c.kind}`);
      expect(c.owner).toBe(SEAT);
      // Between the home and the HQ's door, which stands below its body.
      expect(c.x).toBeGreaterThanOrEqual(HOME_X);
      expect(c.x).toBeLessThanOrEqual(HQ_X);
    }
    apply(sim, placed);
    expect(sitesOf(sim)).toBe(placed.length);

    // The next decisions carry the route on, never over a node already a site.
    const next = roadBuildModule.run(
      sim.world,
      ctxOf(sim, ROADS_FROM_TICKS + AI_DECISION_INTERVAL_TICKS),
      SEAT,
    );
    const taken = new Set(placed.map((c) => (c.kind === 'placeRoadSite' ? `${c.x},${c.y}` : '')));
    for (const c of next) {
      if (c.kind === 'placeRoadSite') expect(taken.has(`${c.x},${c.y}`)).toBe(false);
    }
  });

  it('places a route node by node from the home to the base, around ground a road may not take', () => {
    const sim = roadSim(1, 0);
    const terrain = terrainOf(sim);
    // A signpost stands on the straight way: walkers cross its node, a road site may not.
    createSignpost(sim.world, terrain, terrain.nodeAt(MIDWAY.x, MIDWAY.y), SEAT);
    const placed = placeWholeRoute(sim);
    // The probe took every node the route named: none is left a gap.
    expect(sitesOf(sim)).toBe(placed.length);
    expect(paved(sim, { x: HOME_X, y: HOME_Y }, HQ_DOOR)).toBe(true);
    expect(roadSitesByNode(sim.world, terrain).has(terrain.nodeAt(MIDWAY.x, MIDWAY.y))).toBe(false);
  });

  it('re-routes around a building that cut its road, joining the road on both sides', () => {
    const sim = roadSim(1, 0);
    const first = placeWholeRoute(sim);
    paveSites(sim);
    const terrain = terrainOf(sim);
    expect(paved(sim, { x: HOME_X, y: HOME_Y }, HQ_DOOR)).toBe(true);
    // Another seat's headquarters goes up on the road midway, its body over the road. Its walls stand
    // on even rows only, so its anchor goes on an even-row road node.
    const middle = [...roadNodes(sim.world)].find((n) => {
      const x = terrain.xOf(n);
      return x > HOME_X + CUT_MARGIN_NODES && x < HQ_X - CUT_MARGIN_NODES && terrain.yOf(n) % 2 === 0;
    });
    if (middle === undefined) throw new Error('setup: no road midway');
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: terrain.xOf(middle),
      y: terrain.yOf(middle),
      tribe: VIKING,
      owner: SEAT + 1,
    });
    sim.step();
    expect(paved(sim, { x: HOME_X, y: HOME_Y }, HQ_DOOR)).toBe(false);

    const detour = placeWholeRoute(sim);
    expect(detour.length).toBeGreaterThan(0);
    // A detour off the road it keeps, not a second road beside it.
    expect(detour.length).toBeLessThan(first.length);
    expect(sitesOf(sim)).toBe(detour.length);
    expect(paved(sim, { x: HOME_X, y: HOME_Y }, HQ_DOOR)).toBe(true);
  });

  it(`keeps at most ${MAX_PENDING_ROAD_SITES} road sites pending`, () => {
    const sim = roadSim(1, 0);
    placeSites(sim, MAX_PENDING_ROAD_SITES);
    expect(sitesOf(sim)).toBe(MAX_PENDING_ROAD_SITES);
    expect(roadBuildModule.run(sim.world, ctxOf(sim, ROADS_FROM_TICKS), SEAT)).toEqual([]);
  });

  it('puts one builder on roads, a second over the backlog, and the rest of the workforce leaves them be', () => {
    const one = busySim(1);
    placeSites(one, 1);
    const posted = collectModule
      .run(one.world, ctxOf(one, one.tick), SEAT)
      .filter((c) => c.kind === 'assignBuilder');
    expect(posted).toHaveLength(ROAD_CREW);

    const backlog = busySim(1);
    placeSites(backlog, ROAD_BACKLOG_SITES);
    const commands = collectModule.run(backlog.world, ctxOf(backlog, backlog.tick), SEAT);
    const crew = commands.filter((c) => c.kind === 'assignBuilder');
    expect(crew).toHaveLength(BACKLOG_ROAD_CREW);
    for (const c of crew) expect(backlog.world.has(c.site, RoadSite)).toBe(true);
    apply(backlog, commands);
    expect(roadsters(backlog)).toHaveLength(BACKLOG_ROAD_CREW);

    // A later decision neither posts another roadster nor re-jobs one it has.
    const later = collectModule.run(backlog.world, ctxOf(backlog, backlog.tick), SEAT);
    expect(later.filter((c) => c.kind === 'assignBuilder')).toEqual([]);
    for (const e of roadsters(backlog)) expect(named(later, e)).toEqual([]);
  });

  it('hands a roadster back when no road site is left, and posts one again for new sites', () => {
    const sim = busySim(1);
    placeSites(sim, 1);
    apply(sim, collectModule.run(sim.world, ctxOf(sim, sim.tick), SEAT));
    const [roadster] = roadsters(sim);
    if (roadster === undefined) throw new Error('setup: no roadster posted');

    const site = [...sim.world.query(RoadSite)][0];
    if (site === undefined) throw new Error('setup: the road site is gone');
    apply(sim, [{ kind: 'cancelRoadSite', roadSite: site }]);
    // He re-plans once the errand he is on ends: the walk to the store for the site's stone.
    sim.run(RUN_END_TICKS);
    expect(sim.world.has(roadster, BuildMode)).toBe(false);
    expect(sim.world.get(roadster, Settler).jobType).toBe(BUILDER);

    placeSites(sim, 1);
    const again = collectModule.run(sim.world, ctxOf(sim, sim.tick), SEAT);
    expect(again.filter((c) => c.kind === 'assignBuilder')).toHaveLength(ROAD_CREW);
  });

  it("counts the road sites' stone as owed, so a stone shortage hires more gatherers", () => {
    const sim = roadSim(1, 0);
    const hq = entityOfBuilding(sim, HQ_TYPE);
    const comfort = supplyLines(aiContent(), DEFAULT_BUILD_ORDER, 'opening').get(STONE)?.comfort ?? 0;
    setStockAmount(sim.world, hq, STONE, comfort);
    const stoneTarget = (): number | undefined => {
      const ctx = ctxOf(sim, sim.tick);
      const supply = SeatSupply.of(
        sim.world,
        ctx,
        SEAT,
        ownedBuildings(sim.world, SEAT),
        DEFAULT_BUILD_ORDER,
      );
      return wantedCollectorGoods(sim.world, ctx, SEAT, [], [], supply).find((w) => w.good.typeId === STONE)
        ?.target;
    };
    const calm = stoneTarget();
    if (calm === undefined) throw new Error('setup: stone is not a wanted good');

    placeSites(sim, MAX_PENDING_ROAD_SITES);
    const ctx = ctxOf(sim, sim.tick);
    const supply = SeatSupply.of(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT), DEFAULT_BUILD_ORDER);
    expect(supply.surplus(STONE)).toBe(comfort - MAX_PENDING_ROAD_SITES);
    // The opening's one site shortage post, plus the paving good's own while road sites are pending.
    expect(stoneTarget()).toBe(calm + OPENING_SITE_SHORTAGE_POSTS + ROAD_SITE_SHORTAGE_POSTS);
  });

  describe('the seat left to itself', () => {
    /** The road and workforce modules alone, so the run measures roads, not the build order. */
    function layingRun(seed: number): Simulation {
      const sim = roadSim(seed, CREW_CASE_BUILDERS);
      sim.enqueueSetup({
        kind: 'setPlayerAi',
        player: SEAT,
        enabled: true,
        modules: {
          guideBuild: false,
          homeExpansion: false,
          houseBuild: false,
          houseUpgrade: false,
          military: false,
        },
      });
      sim.run(LAYING_RUN_TICKS);
      return sim;
    }

    it('lays the whole road between the home and the base, then hands its crew back', {
      timeout: 60_000,
    }, () => {
      const sim = layingRun(3);
      const laid = roadNodeCount(sim.world);
      expect(laid).toBeGreaterThan(0);
      expect(sitesOf(sim)).toBe(0);
      expect(roadsters(sim)).toEqual([]);
      // The route is road end to end, so the next decision on it places nothing.
      expect(roadBuildModule.run(sim.world, ctxOf(sim, sim.tick), SEAT)).toEqual([]);
      // A finished site paves its pending neighbours too, so the road took fewer stones than nodes.
      const left = sim.world.get(entityOfBuilding(sim, HQ_TYPE), Stockpile).amounts.get(STONE) ?? 0;
      const spent = HQ_STONE_CAPACITY - left;
      expect(spent).toBeGreaterThan(0);
      expect(spent).toBeLessThan(laid);
    });

    it('same seed twice gives byte-identical state', { timeout: 60_000 }, () => {
      expect(layingRun(5).hashState()).toBe(layingRun(5).hashState());
    });
  });
});
