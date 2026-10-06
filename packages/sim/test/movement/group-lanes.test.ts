import { describe, expect, it } from 'vitest';
import { fx, Simulation } from '../../src/index.js';
import { NodeMask } from '../../src/nav/block-overlay.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { latticeDistanceTo, type NodeId, StepBuffer } from '../../src/nav/terrain/index.js';
import { GroupLanes } from '../../src/systems/movement/group-lanes.js';
import { GroupRoutes } from '../../src/systems/movement/group-routes.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(200, 70) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  return {
    terrain,
    blocked: new NodeMask(terrain.nodeCount),
    routes: new GroupRoutes(terrain),
    lanes: new GroupLanes(terrain),
  };
}

describe('army route lanes', () => {
  it('matches the distance-oracle lane in every quadrant and both row parities', () => {
    const { terrain, blocked, lanes } = fixture();
    const sx = 90,
      sy = 35,
      start = terrain.nodeAt(sx, sy);
    const steps = new StepBuffer();
    for (let dx = -12; dx <= 12; dx++) {
      for (let dy = -15; dy <= 15; dy++) {
        const gx = sx + dx,
          gy = sy + dy,
          goal = terrain.nodeAt(gx, gy);
        const route = lanes.direct(blocked, start, goal, fx.fromInt(2));
        if (route === null) throw new Error(`missing clear lane for ${dx},${dy}`);
        expect(route.at(-1)).toBe(goal);
        for (let i = 1; i < route.length; i++) {
          const at = route[i - 1];
          if (at === undefined) throw new Error('missing route node');
          terrain.stepsInto(at, blocked, steps);
          const remaining = latticeDistanceTo(terrain, gx, gy, at);
          const candidates = Array.from({ length: steps.length }, (_, index) => index)
            .filter(
              (index) =>
                steps.costAt(index) + latticeDistanceTo(terrain, gx, gy, steps.nodeAt(index)) === remaining,
            )
            .map((index) => steps.nodeAt(index));
          const deviation = (node: NodeId): number =>
            Math.abs((terrain.xOf(node) - sx) * dy - (terrain.yOf(node) - sy) * dx);
          candidates.sort((a, b) => deviation(a) - deviation(b) || a - b);
          expect(route[i]).toBe(candidates[0]);
        }
      }
    }
  });
  it('keeps parallel members on their own clear lane instead of converging onto the first path', () => {
    const { terrain, blocked, routes } = fixture();
    const lead = findPath(terrain, terrain.nodeAt(10, 10), terrain.nodeAt(180, 10), blocked);
    if (lead === null) throw new Error('missing lead route');
    routes.offer(blocked, lead);
    for (const row of [12, 20, 48]) {
      const route = routes.borrow(blocked, terrain.nodeAt(10, row), terrain.nodeAt(180, row), {
        explored: 0,
      });
      expect(route).not.toBeNull();
      expect(route?.every((node) => terrain.yOf(node) === row)).toBe(true);
      expect(route).toHaveLength(171);
    }
  });

  it('validates separate detour lanes and leaves the corridor once each member can reach its slot', () => {
    const { terrain, blocked, routes } = fixture();
    for (let y = 0; y <= 30; y++) blocked.set(terrain.nodeAt(80, y), true);
    const lead = findPath(terrain, terrain.nodeAt(10, 20), terrain.nodeAt(180, 20), blocked);
    if (lead === null) throw new Error('missing lead route');
    routes.offer(blocked, lead);
    const goal = terrain.nodeAt(180, 24);
    const route = routes.borrow(blocked, terrain.nodeAt(10, 24), goal, { explored: 0 });
    if (route === null) throw new Error('missing follower route');
    expect(route[0]).toBe(terrain.nodeAt(10, 24));
    expect(route.at(-1)).toBe(goal);
    expect(route.filter((node) => terrain.xOf(node) === 80).every((node) => terrain.yOf(node) >= 34)).toBe(
      true,
    );
    const steps = new StepBuffer();
    for (let i = 1; i < route.length; i++) {
      const previous = route[i - 1],
        node = route[i];
      if (previous === undefined || node === undefined) throw new Error('missing step');
      terrain.stepsInto(previous, blocked, steps);
      expect(Array.from({ length: steps.length }, (_, j) => steps.nodeAt(j))).toContain(node);
    }
  });

  it('keeps the obstacle corner fixed when another column joins the same lateral detour', () => {
    const { terrain, blocked, routes } = fixture();
    for (let y = 0; y <= 30; y++) blocked.set(terrain.nodeAt(80, y), true);
    const lead = findPath(terrain, terrain.nodeAt(10, 20), terrain.nodeAt(150, 20), blocked);
    if (lead === null) throw new Error('missing lead route');
    routes.offer(blocked, lead);
    for (const x of [14, 22, 40]) {
      const goal = terrain.nodeAt(x + 140, 24);
      const route = routes.borrow(blocked, terrain.nodeAt(x, 24), goal, { explored: 0 });
      expect(route?.[0]).toBe(terrain.nodeAt(x, 24));
      expect(route?.at(-1)).toBe(goal);
      expect(route?.some((node) => terrain.xOf(node) === 80 && terrain.yOf(node) >= 34)).toBe(true);
      expect(new Set(route).size).toBe(route?.length);
    }
  });

  it('drops an old lane and its edge checks after a footprint version changes', () => {
    const { terrain, blocked, routes } = fixture();
    routes.refresh(0);
    const lead = findPath(terrain, terrain.nodeAt(10, 10), terrain.nodeAt(180, 10), blocked);
    if (lead === null) throw new Error('missing lead route');
    routes.offer(blocked, lead);
    const start = terrain.nodeAt(10, 12),
      goal = terrain.nodeAt(180, 12);
    expect(routes.borrow(blocked, start, goal, { explored: 0 })).not.toBeNull();
    blocked.set(terrain.nodeAt(80, 12), true);
    routes.refresh(1);
    expect(routes.borrow(blocked, start, goal, { explored: 0 })).toBeNull();
    routes.offer(blocked, lead);
    const changed = routes.borrow(blocked, start, goal, { explored: 0 });
    expect(changed).not.toBeNull();
    expect(changed).not.toContain(terrain.nodeAt(80, 12));
  });

  it('cuts a translated connector loop without mutating the shared route', () => {
    const { terrain, blocked, lanes } = fixture();
    const corridor = [
      ...Array.from({ length: 101 }, (_, i) => terrain.nodeAt(10 + i, 10)),
      terrain.nodeAt(110, 11),
      terrain.nodeAt(110, 12),
      ...Array.from({ length: 40 }, (_, i) => terrain.nodeAt(109 - i, 12)),
    ];
    const original = [...corridor];
    const route = lanes.translated(
      blocked,
      corridor,
      terrain.nodeAt(10, 10),
      terrain.nodeAt(70, 8),
      fx.fromInt(2),
      48,
    );
    expect(route?.at(-1)).toBe(terrain.nodeAt(70, 8));
    expect(new Set(route).size).toBe(route?.length);
    expect(corridor).toEqual(original);
    expect(route?.length).toBeLessThan(100);
  });

  it('refuses a translated diagonal across two blocked midpoint flanks', () => {
    const { terrain, blocked, lanes } = fixture();
    const corridor: NodeId[] = [terrain.nodeAt(10, 10), terrain.nodeAt(11, 12)];
    blocked.set(terrain.nodeAt(10, 12), true);
    blocked.set(terrain.nodeAt(11, 12), true);
    expect(
      lanes.translated(blocked, corridor, terrain.nodeAt(10, 11), terrain.nodeAt(11, 13), fx.fromInt(2), 48),
    ).toBeNull();
  });

  it('keeps a cheap-road reference from sending followers straight across slower ground', () => {
    const { terrain, blocked, lanes } = fixture();
    expect(lanes.direct(blocked, terrain.nodeAt(10, 10), terrain.nodeAt(180, 10), fx.fromInt(1))).toBeNull();
    expect(
      lanes.direct(blocked, terrain.nodeAt(10, 10), terrain.nodeAt(180, 10), fx.fromInt(2)),
    ).toHaveLength(171);
  });

  it('accepts a long rough-terrain reference without overflowing its mean resistance', () => {
    const width = 300,
      height = 120;
    const map = {
      ...grassNodeMap(width, height),
      roughness: Array.from({ length: width * height }, () => 255),
    };
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const routes = new GroupRoutes(terrain);
    const blocked = new NodeMask(terrain.nodeCount);
    const longRoute = Array.from({ length: width * 100 }, (_, i) => {
      const y = Math.floor(i / width),
        x = i % width;
      return terrain.nodeAt(y % 2 === 0 ? x : width - x - 1, y);
    });
    expect(() => routes.offer(blocked, longRoute)).not.toThrow();
    const path = routes.borrow(blocked, terrain.nodeAt(0, 110), terrain.nodeAt(299, 110), { explored: 0 });
    expect(path).toHaveLength(300);
  });
});
