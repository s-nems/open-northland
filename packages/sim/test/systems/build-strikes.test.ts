import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Palisade, Position, UnderConstruction } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import { siteClaimHolder } from '../../src/systems/economy/site-claim.js';
import {
  BUILD_CLIP_TICKS,
  BUILD_ROAD_ATOMIC,
  BUILD_TICKS,
  BUILD_WALL_ATOMIC,
  builderAt,
  HUMAN,
  orderRoads,
  ROW,
  roadAt,
  roadSim,
  STORE_HX,
  siteAt,
  storeAt,
  VIKING,
  WALL,
} from './road-support.js';

const SITE_HX = 20;
const BUILDER_HX = 8;

interface Strike {
  readonly atomicId: number;
  readonly duration: number;
  readonly startTick: number;
  /** Ticks the strike was seen running, each with the site unfinished and still claimed by its builder. */
  readonly runningTicks: number;
  readonly finishTick: number;
}

/** Run until `finished(site)`, recording the builder's one construct strike at it. */
function strikeAt(sim: Simulation, builder: Entity, site: Entity, finished: () => boolean): Strike {
  let strike: Omit<Strike, 'finishTick' | 'runningTicks'> | null = null;
  let runningTicks = 0;
  let starts = 0;
  let running = false;
  for (let tick = 0; tick < BUILD_TICKS && !finished(); tick++) {
    sim.step();
    const atomic = sim.world.tryGet(builder, CurrentAtomic);
    const striking = atomic?.effect.kind === 'construct' && atomic.effect.site === site;
    if (striking && !running) starts++;
    running = striking;
    if (atomic === undefined || !striking) continue;
    strike ??= { atomicId: atomic.atomicId, duration: atomic.duration, startTick: sim.tick };
    runningTicks++;
    expect(finished(), `site finished mid-strike at tick ${sim.tick}`).toBe(false);
    expect(siteClaimHolder(sim.world, site)).toBe(builder);
  }
  if (strike === null) throw new Error('expected a construct strike');
  expect(starts).toBe(1);
  return { ...strike, runningTicks, finishTick: sim.tick };
}

describe('a one-strike site', () => {
  it('lays a road only as the whole build-road clip ends', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    const builder = builderAt(sim, BUILDER_HX);
    orderRoads(sim, [{ hx: SITE_HX, hy: ROW }]);
    const site = siteAt(sim, SITE_HX, ROW);
    if (site === undefined) throw new Error('expected a road site');

    const strike = strikeAt(sim, builder, site, () => !sim.world.isAlive(site));
    expect(strike.atomicId).toBe(BUILD_ROAD_ATOMIC);
    expect(strike.duration).toBe(BUILD_CLIP_TICKS);
    // The strike runs every tick of its clip but the one it lands on, which lays the road.
    expect(strike.runningTicks).toBe(BUILD_CLIP_TICKS - 1);
    expect(strike.finishTick - strike.startTick).toBe(BUILD_CLIP_TICKS - 1);
    expect(roadAt(sim, SITE_HX, ROW)).toBe(true);
  });

  it('raises a wall segment only as the whole build-wall clip ends', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: SITE_HX,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      underConstruction: true,
    });
    sim.step();
    const centre = positionOfNode(SITE_HX, ROW);
    const wall = [...sim.world.query(Palisade, Position)].find(
      (e) => sim.world.get(e, Position).x === centre.x && sim.world.get(e, Position).y === centre.y,
    );
    if (wall === undefined) throw new Error('expected a wall site');
    const builder = builderAt(sim, BUILDER_HX);

    const strike = strikeAt(sim, builder, wall, () => !sim.world.has(wall, UnderConstruction));
    expect(strike.atomicId).toBe(BUILD_WALL_ATOMIC);
    expect(strike.duration).toBe(BUILD_CLIP_TICKS);
    expect(strike.runningTicks).toBe(BUILD_CLIP_TICKS - 1);
    expect(strike.finishTick - strike.startTick).toBe(BUILD_CLIP_TICKS - 1);
  });
});
