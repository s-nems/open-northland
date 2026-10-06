import {
  addPerson,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  WALK_DIRECTION,
  WalkFacing,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation, type TerrainMap } from '../../../src/index.js';
import { ROW_STEP, worldX } from '../../../src/nav/world-metric.js';
import { testContent } from '../../fixtures/content.js';

export const COUNT = 1000;
export const WIDTH = 400;
export const HEIGHT = 128;
export const DESTINATION_SHIFT = 200;

export function report(kind: string, reports: readonly ReturnType<typeof geometry>[]): void {
  if (process.env.ON_ARMY_GEOMETRY_REPORT === 'on') console.log(JSON.stringify({ kind, reports }));
}

export function makeArmy(wall: boolean, count = COUNT) {
  const typeIds = new Array<number>(WIDTH * HEIGHT).fill(0);
  if (wall) {
    for (let y = 0; y < HEIGHT; y++) if (y < 52 || y > 64) typeIds[y * WIDTH + 150] = 1;
  }
  const map: TerrainMap = { resolution: 'half-cell', width: WIDTH, height: HEIGHT, typeIds };
  const sim = new Simulation({
    seed: 7,
    content: testContent(),
    map,
  });
  const members: { entity: Entity; x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x = 8 + (i % 40) * 2,
      y = 8 + Math.floor(i / 40) * 2;
    const entity = sim.world.create();
    sim.world.add(entity, Position, positionOfNode(x, y));
    addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(entity, Owner, { player: 0 });
    sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
    members.push({ entity, x, y });
  }
  return { sim, members, map };
}

export function geometry(sim: Simulation, members: readonly { entity: Entity; x: number; y: number }[]) {
  const positions = members.map(({ entity }) => {
    const p = sim.world.get(entity, Position);
    return { x: fx.toFloat(worldX(p.x, p.y)), y: fx.toFloat(fx.mul(p.y, ROW_STEP)) };
  });
  const ys = positions.map((p) => p.y).sort((a, b) => a - b);
  const exact = new Set(positions.map((p) => `${p.x},${p.y}`));
  const buckets = new Map<string, typeof positions>();
  // The collision radius is 0.26 columns. This stricter distance counts visible deep overlaps,
  // not harmless near neighbours; buckets keep even the diagnostic local to crowded areas.
  let nearPairs = 0;
  for (const p of positions) {
    const bx = Math.floor(p.x / 0.2),
      by = Math.floor(p.y / 0.2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if ((p.x - other.x) ** 2 + (p.y - other.y) ** 2 < 0.2 ** 2) nearPairs++;
        }
      }
    const key = `${bx},${by}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  const arrived = members.filter(({ entity, x, y }) => {
    const p = sim.world.get(entity, Position),
      goal = positionOfNode(x, y);
    return p.x === goal.x && p.y === goal.y;
  }).length;
  const walking = members.filter(({ entity }) => sim.world.has(entity, PathFollow)).length;
  return {
    tick: sim.tick,
    width90: (ys[Math.floor(ys.length * 0.95)] ?? 0) - (ys[Math.floor(ys.length * 0.05)] ?? 0),
    exactStacked: positions.length - exact.size,
    nearPairs,
    walking,
    pending: members.filter(({ entity }) => sim.world.has(entity, PathRequest)).length,
    arrived,
    stoppedAway: members.filter(({ entity, x, y }) => {
      const p = sim.world.get(entity, Position),
        goal = positionOfNode(x, y);
      return !sim.world.has(entity, PathFollow) && (p.x !== goal.x || p.y !== goal.y);
    }).length,
  };
}

export function translated(
  members: readonly { entity: Entity; x: number; y: number }[],
  dx = DESTINATION_SHIFT,
  dy = 0,
) {
  return members.map(({ entity, x, y }) => ({ entity, x: x + dx, y: y + dy }));
}
