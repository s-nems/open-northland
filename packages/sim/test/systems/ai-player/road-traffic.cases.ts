import { describe, expect, it } from 'vitest';
import { Owner, PathFollow, Position, RoadTraffic, Settler } from '../../../src/components/index.js';
import { aiCommand } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  hexNeighboursOf,
  nodeOfPosition,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { roadBuildPlan, TRAFFIC_ROAD_WALKS } from '../../../src/systems/ai-player/road-build.js';
import {
  hottestTraffic,
  TRAFFIC_BUCKET_NODES,
  TRAFFIC_HALF_LIFE_TICKS,
  trafficCounter,
  trafficWalksAt,
} from '../../../src/systems/ai-player/traffic.js';
import { layRoad } from '../../../src/systems/roads/index.js';
import { roadSitesByNode } from '../../../src/systems/roads/site-index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { apply, HQ_DOOR, paved, paveSites, roadSim, terrainOf } from './road-support.js';
import { CIVILIST, ctxOf, makeAiSeat, SEAT, VIKING } from './support.js';

/** A second computer seat that runs without roads, and a human seat. */
const QUIET_SEAT = SEAT + 1;
const HUMAN_SEAT = SEAT + 2;

/** The deposit the synthetic seat's men walk to, in the far corner from the HQ. */
const DEPOSIT = { x: 58, y: 28 };
/** Men walking between the HQ door and the deposit. */
const WALKERS = 6;
/** How long the walking run lasts, and how often its road sites are paved as a road crew would. */
const WALK_RUN_TICKS = 7200;
const PAVE_EVERY_TICKS = 240;
/** Ticks into the walking run where the determinism case saves and restores. */
const SAVE_AT_TICKS = 3000;
/** The west edge of the deposit's bucket. */
const DEPOSIT_BUCKET_EDGE = Math.floor(DEPOSIT.x / TRAFFIC_BUCKET_NODES) * TRAFFIC_BUCKET_NODES;
/** Traffic turns within which the deposit's route must be placed whole. */
const TRAFFIC_ROUTE_TURNS = 8;
/** Walks one bucket counts in the decay case. */
const DECAY_WALKS = 4;

function spawnFor(sim: Simulation, owner: number, x: number, y: number): Entity {
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: CIVILIST, x, y, tribe: VIKING, owner });
  sim.step();
  let latest: Entity | null = null;
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Owner).player === owner && (latest === null || e > latest)) latest = e;
  }
  if (latest === null) throw new Error('setup: no settler spawned');
  return latest;
}

/** The walks each of `player`'s buckets counts at `tick`, by bucket. */
function trafficOf(sim: Simulation, player: number, tick = sim.tick): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of sim.world.query(RoadTraffic)) {
    const traffic = sim.world.get(e, RoadTraffic);
    if (traffic.player === player) counts.set(traffic.bucket, trafficWalksAt(traffic, tick));
  }
  return counts;
}

/** Two nodes one step apart on either side of the first bucket border, on row `y`. */
function crossing(sim: Simulation, y: number): { from: NodeId; to: NodeId } {
  const terrain = terrainOf(sim);
  return { from: terrain.nodeAt(TRAFFIC_BUCKET_NODES - 1, y), to: terrain.nodeAt(TRAFFIC_BUCKET_NODES, y) };
}

/** Hex-connected pieces of road and road sites on the map. */
function roadPieces(sim: Simulation): number {
  const terrain = terrainOf(sim);
  const sites = roadSitesByNode(sim.world, terrain);
  const laid = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) && (terrain.isRoad(terrain.nodeAt(x, y)) || sites.has(terrain.nodeAt(x, y)));
  const seen = new Set<number>();
  let pieces = 0;
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      if (!laid(x, y) || seen.has(terrain.nodeAt(x, y))) continue;
      pieces++;
      const open = [{ hx: x, hy: y }];
      seen.add(terrain.nodeAt(x, y));
      for (let at = open.pop(); at !== undefined; at = open.pop()) {
        for (const n of hexNeighboursOf(at.hx, at.hy)) {
          if (!laid(n.hx, n.hy) || seen.has(terrain.nodeAt(n.hx, n.hy))) continue;
          seen.add(terrain.nodeAt(n.hx, n.hy));
          open.push(n);
        }
      }
    }
  }
  return pieces;
}

/** Whether a road or road site lies within one bucket's width of the deposit. */
function pavedNearDeposit(sim: Simulation): boolean {
  const terrain = terrainOf(sim);
  const sites = roadSitesByNode(sim.world, terrain);
  for (let y = DEPOSIT.y - TRAFFIC_BUCKET_NODES; y <= DEPOSIT.y + TRAFFIC_BUCKET_NODES; y++) {
    for (let x = DEPOSIT.x - TRAFFIC_BUCKET_NODES; x <= DEPOSIT.x + TRAFFIC_BUCKET_NODES; x++) {
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (terrain.isRoad(node) || sites.has(node)) return true;
    }
  }
  return false;
}

/** A seat running only its road module, whose men walk to and fro between the HQ door and the deposit. */
function walkingSim(seed: number): { sim: Simulation; men: Entity[] } {
  const sim = roadSim(seed, 0);
  sim.enqueueSetup({
    kind: 'setPlayerAi',
    player: SEAT,
    enabled: true,
    modules: {
      collectResources: false,
      guideBuild: false,
      homeExpansion: false,
      houseBuild: false,
      houseUpgrade: false,
      military: false,
    },
  });
  const men: Entity[] = [];
  for (let i = 0; i < WALKERS; i++) men.push(spawnFor(sim, SEAT, HQ_DOOR.x + i, HQ_DOOR.y));
  return { sim, men };
}

/** Walk `ticks` more ticks: every man standing still heads for the end he is farther from, and the
 *  road sites are paved every {@link PAVE_EVERY_TICKS}, as a road crew would. */
function walkOn(sim: Simulation, men: readonly Entity[], ticks: number): void {
  const end = sim.tick + ticks;
  while (sim.tick < end) {
    for (const man of men) {
      if (sim.world.has(man, PathFollow)) continue;
      const at = sim.world.get(man, Position);
      const node = nodeOfPosition(at.x, at.y);
      const toDeposit =
        Math.abs(node.hx - DEPOSIT.x) + Math.abs(node.hy - DEPOSIT.y) >
        Math.abs(node.hx - HQ_DOOR.x) + Math.abs(node.hy - HQ_DOOR.y);
      const goal = toDeposit ? DEPOSIT : HQ_DOOR;
      sim.enqueue(aiCommand(SEAT, { kind: 'moveUnit', entity: man, x: goal.x, y: goal.y }));
    }
    if (sim.tick % PAVE_EVERY_TICKS === 0) paveSites(sim);
    else sim.step();
  }
}

describe('road traffic (roadBuild)', () => {
  it("counts only the steps of a road-building computer seat's settlers that enter a bucket off-road", () => {
    const sim = roadSim(1, 0);
    makeAiSeat(sim, SEAT);
    makeAiSeat(sim, QUIET_SEAT, { roadBuild: false });
    const own = spawnFor(sim, SEAT, 2, 2);
    const quiet = spawnFor(sim, QUIET_SEAT, 2, 4);
    const human = spawnFor(sim, HUMAN_SEAT, 2, 6);
    const terrain = terrainOf(sim);
    const count = trafficCounter(sim.world, ctxOf(sim, sim.tick));
    if (count === null) throw new Error('a road-building seat counts');

    const open = crossing(sim, 2);
    count(own, open.from, open.to);
    count(quiet, open.from, open.to);
    count(human, open.from, open.to);
    expect([...trafficOf(sim, SEAT).values()]).toEqual([1]);
    expect(trafficOf(sim, QUIET_SEAT).size).toBe(0);
    expect(trafficOf(sim, HUMAN_SEAT).size).toBe(0);

    // A step inside one bucket, and a step onto a road, count nothing.
    count(own, terrain.nodeAt(1, 2), terrain.nodeAt(2, 2));
    const paved = crossing(sim, 4);
    layRoad(sim.world, terrain, [paved.to]);
    count(own, paved.from, paved.to);
    expect([...trafficOf(sim, SEAT).values()]).toEqual([1]);

    // A world with no road-building seat pays nothing at all.
    const lone = roadSim(1, 0);
    expect(trafficCounter(lone.world, ctxOf(lone, lone.tick))).toBeNull();
  });

  it('halves a count once per half-life and drops a bucket that cooled to nothing', () => {
    const sim = roadSim(1, 0);
    makeAiSeat(sim, SEAT);
    const man = spawnFor(sim, SEAT, 2, 2);
    const start = Math.ceil(sim.tick / TRAFFIC_HALF_LIFE_TICKS) * TRAFFIC_HALF_LIFE_TICKS;
    const { from, to } = crossing(sim, 2);
    const count = trafficCounter(sim.world, ctxOf(sim, start));
    if (count === null) throw new Error('a road-building seat counts');
    for (let i = 0; i < DECAY_WALKS; i++) count(man, from, to);

    const [bucket] = trafficOf(sim, SEAT, start).keys();
    if (bucket === undefined) throw new Error('the walks were counted');
    const at = (halfLives: number): number | undefined =>
      trafficOf(sim, SEAT, start + halfLives * TRAFFIC_HALF_LIFE_TICKS).get(bucket);
    expect(at(0)).toBe(DECAY_WALKS);
    expect(at(1)).toBe(DECAY_WALKS / 2);
    expect(at(2)).toBe(DECAY_WALKS / 4);
    expect(at(3)).toBe(0);

    // A walk after a half-life adds to the halved count.
    const later = trafficCounter(sim.world, ctxOf(sim, start + TRAFFIC_HALF_LIFE_TICKS));
    later?.(man, from, to);
    expect(at(1)).toBe(DECAY_WALKS / 2 + 1);

    // Nothing is hot enough, and the scan drops the bucket once it reads 0.
    const cold = start + 4 * TRAFFIC_HALF_LIFE_TICKS;
    expect(hottestTraffic(sim.world, SEAT, cold, 1)).toBeNull();
    expect(trafficOf(sim, SEAT).size).toBe(0);
  });

  it('paves the way its men walk to a far deposit, joined to the network', { timeout: 60_000 }, () => {
    const { sim, men } = walkingSim(1);
    walkOn(sim, men, WALK_RUN_TICKS);
    expect(pavedNearDeposit(sim)).toBe(true);
    expect(roadPieces(sim)).toBe(1);
  });

  it('continues byte-identically from a save taken mid-run', { timeout: 60_000 }, () => {
    const straight = walkingSim(2);
    walkOn(straight.sim, straight.men, SAVE_AT_TICKS);
    expect(trafficOf(straight.sim, SEAT).size).toBeGreaterThan(0);
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(straight.sim))));
    const restored = restoreSimulation(save, { content: aiContent(), map: grassNodeMap(64, 32) });
    expect(restored.hashState()).toBe(straight.sim.hashState());

    walkOn(straight.sim, straight.men, WALK_RUN_TICKS - SAVE_AT_TICKS);
    walkOn(restored, straight.men, WALK_RUN_TICKS - SAVE_AT_TICKS);
    expect(restored.hashState()).toBe(straight.sim.hashState());
    const again = walkingSim(2);
    walkOn(again.sim, again.men, WALK_RUN_TICKS);
    expect(again.sim.hashState()).toBe(straight.sim.hashState());
  });

  describe('the traffic turn', () => {
    /** The first traffic turn at or after `tick`, and the building turn right after it. */
    const trafficTurnFrom = (tick: number): number => {
      const decision = Math.ceil(tick / AI_DECISION_INTERVAL_TICKS);
      return (decision % 2 === 1 ? decision : decision + 1) * AI_DECISION_INTERVAL_TICKS;
    };

    /** A seat whose deposit bucket counts {@link TRAFFIC_ROAD_WALKS} walks at the returned tick. */
    function hotSim(): { sim: Simulation; tick: number; bucket: Entity } {
      const sim = roadSim(1, 0);
      makeAiSeat(sim, SEAT);
      const man = spawnFor(sim, SEAT, DEPOSIT.x, DEPOSIT.y);
      const terrain = terrainOf(sim);
      const tick = trafficTurnFrom(sim.tick);
      const count = trafficCounter(sim.world, ctxOf(sim, tick));
      if (count === null) throw new Error('a road-building seat counts');
      const from = terrain.nodeAt(DEPOSIT_BUCKET_EDGE - 1, DEPOSIT.y);
      const to = terrain.nodeAt(DEPOSIT_BUCKET_EDGE, DEPOSIT.y);
      for (let i = 0; i < TRAFFIC_ROAD_WALKS; i++) count(man, from, to);
      const [bucket] = sim.world.query(RoadTraffic);
      if (bucket === undefined) throw new Error('setup: no bucket');
      return { sim, tick, bucket };
    }

    const walksOf = (sim: Simulation, bucket: Entity, tick: number): number =>
      trafficWalksAt(sim.world.get(bucket, RoadTraffic), tick);

    it('routes a hot bucket to the network over its turns, then clears it; buildings keep theirs', () => {
      const { sim, tick, bucket } = hotSim();
      // The building turn after it links a building though the bucket stays hot.
      expect(roadBuildPlan(sim.world, ctxOf(sim, tick + AI_DECISION_INTERVAL_TICKS), SEAT).source).toBe(
        'building',
      );
      let at = tick;
      let turns = 0;
      while (walksOf(sim, bucket, at) > 0) {
        const plan = roadBuildPlan(sim.world, ctxOf(sim, at), SEAT);
        expect(plan.source).toBe('traffic');
        expect(plan.commands.length).toBeGreaterThan(0);
        apply(sim, plan.commands);
        paveSites(sim);
        at += 2 * AI_DECISION_INTERVAL_TICKS;
        turns++;
        expect(turns).toBeLessThan(TRAFFIC_ROUTE_TURNS);
      }
      // The route was longer than one decision's sites, so it took more than one turn.
      expect(turns).toBeGreaterThan(1);
      expect(paved(sim, { x: DEPOSIT_BUCKET_EDGE, y: DEPOSIT.y }, HQ_DOOR)).toBe(true);
      expect(roadPieces(sim)).toBe(1);
    });

    it('clears a bucket a road already serves without placing anything', () => {
      const { sim, tick, bucket } = hotSim();
      const hot = hottestTraffic(sim.world, SEAT, tick, TRAFFIC_ROAD_WALKS);
      if (hot === null) throw new Error('setup: the bucket is hot');
      const terrain = terrainOf(sim);
      layRoad(sim.world, terrain, [terrain.nodeAt(hot.centre.hx, hot.centre.hy)]);
      const plan = roadBuildPlan(sim.world, ctxOf(sim, tick), SEAT);
      expect(plan).toEqual({ source: 'traffic', commands: [] });
      expect(walksOf(sim, bucket, tick)).toBe(0);
    });
  });
});
