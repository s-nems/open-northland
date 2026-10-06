import { tileToScreen } from '@open-northland/render';
import { components, type Entity, fx, positionOfNode, Simulation } from '@open-northland/sim';
import { testContent } from '../../../sim/test/fixtures/content.js';

export const COUNT = 1000;
export const WIDTH = 400;
export const HEIGHT = 128;

/** The app exercises its public simulation dependency, including the branded command/query seam. */
export function makeArmy() {
  const sim = new Simulation({
    seed: 7,
    content: testContent(),
    map: {
      resolution: 'half-cell',
      width: WIDTH,
      height: HEIGHT,
      typeIds: new Array<number>(WIDTH * HEIGHT).fill(0),
    },
  });
  const members: { entity: Entity }[] = [];
  for (let i = 0; i < COUNT; i++) {
    const entity = sim.world.create();
    sim.world.add(entity, components.Position, positionOfNode(8 + (i % 40) * 2, 8 + Math.floor(i / 40) * 2));
    components.addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(entity, components.Owner, { player: 0 });
    sim.world.add(entity, components.WalkFacing, {
      direction: components.WALK_DIRECTION.E,
      target: components.WALK_DIRECTION.E,
    });
    members.push({ entity });
  }
  return { sim, members };
}

export function geometry(sim: Simulation, members: readonly { entity: Entity; x: number; y: number }[]) {
  const positions = members.map(({ entity }) => sim.world.get(entity, components.Position));
  const exact = new Set(positions.map((p) => `${p.x},${p.y}`));
  // Rendering's 68-pixel column pitch expresses visual distances in the same world-column units as
  // the simulation. The 0.2 threshold detects deep overlaps, below the 0.26 collision radius.
  const projected = positions.map((p) => {
    const point = tileToScreen(fx.toFloat(p.x), fx.toFloat(p.y));
    return { x: point.x / 68, y: point.y / 68 };
  });
  const buckets = new Map<string, typeof projected>();
  let nearPairs = 0;
  for (const p of projected) {
    const bx = Math.floor(p.x / 0.2),
      by = Math.floor(p.y / 0.2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? [])
          if ((p.x - other.x) ** 2 + (p.y - other.y) ** 2 < 0.2 ** 2) nearPairs++;
    const key = `${bx},${by}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  const ys = projected.map((p) => p.y).sort((a, b) => a - b);
  return {
    tick: sim.tick,
    width90: (ys[Math.floor(ys.length * 0.95)] ?? 0) - (ys[Math.floor(ys.length * 0.05)] ?? 0),
    exactStacked: positions.length - exact.size,
    nearPairs,
    arrived: members.filter(({ entity, x, y }) => {
      const p = sim.world.get(entity, components.Position),
        goal = positionOfNode(x, y);
      return p.x === goal.x && p.y === goal.y;
    }).length,
  };
}

export function report(kind: string, reports: readonly ReturnType<typeof geometry>[]): void {
  if (process.env.ON_ARMY_GEOMETRY_REPORT === 'on') console.log(JSON.stringify({ kind, reports }));
}
