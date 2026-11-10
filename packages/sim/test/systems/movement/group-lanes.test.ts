import { describe, expect, it } from 'vitest';
import { fx, Simulation } from '../../../src/index.js';
import { NodeMask } from '../../../src/nav/block-overlay.js';
import { findPath } from '../../../src/nav/pathfinding/index.js';
import { latticeDistanceTo, type NodeId, StepBuffer } from '../../../src/nav/terrain/index.js';
import { GroupLanes } from '../../../src/systems/movement/group-lanes.js';
import { GroupRoutes } from '../../../src/systems/movement/group-routes.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

function roadOf(path: readonly NodeId[]): ReadonlySet<NodeId> {
  return new Set(path);
}

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
  it.each([
    ['odd', 35],
    ['even', 36],
  ])('matches the distance-oracle lane in every quadrant from an %s row', (_parity, sy) => {
    const { terrain, blocked, lanes } = fixture();
    const sx = 90,
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

  it('translates a detour with a slanted edge for followers an odd number of rows off', () => {
    const { terrain, blocked, lanes } = fixture();
    for (let y = 0; y <= 30; y++) blocked.set(terrain.nodeAt(80, y), true);
    for (let x = 100; x <= 104; x++) for (let y = 41; y <= 60; y++) blocked.set(terrain.nodeAt(x, y), true);
    const lead = findPath(terrain, terrain.nodeAt(10, 20), terrain.nodeAt(180, 20), blocked);
    if (lead === null) throw new Error('missing lead route');
    // The premise: the detour takes a column-shifting edge, which a row of the other parity leans away
    // from, so a plain shift of the leader's steps is no walk for an odd offset.
    const slanted = lead.filter((node, i) => {
      const previous = lead[i - 1];
      return (
        previous !== undefined &&
        Math.abs(terrain.xOf(node) - terrain.xOf(previous)) === 1 &&
        Math.abs(terrain.yOf(node) - terrain.yOf(previous)) === 1
      );
    });
    expect(slanted.length).toBeGreaterThan(0);
    const leadRows = lead.map((node) => terrain.yOf(node));
    const leadMinY = Math.min(...leadRows);
    const leadMaxY = Math.max(...leadRows);
    const steps = new StepBuffer();
    for (const dy of [1, 3, 5, 7, 9]) {
      const start = terrain.nodeAt(10, 20 + dy);
      const goal = terrain.nodeAt(180, 20 + dy);
      const lane = lanes.translated(blocked, lead, start, goal, fx.fromInt(2), 2 * dy);
      if (lane === null) throw new Error(`no lane ${dy} rows off the leader`);
      expect(lane[0]).toBe(start);
      expect(lane.at(-1)).toBe(goal);
      // Its own lane: the leader's rows shifted by the offset, a bridged slant adding no row, and every
      // step one the walk may take.
      for (const node of lane) {
        expect(terrain.yOf(node)).toBeGreaterThanOrEqual(leadMinY + dy);
        expect(terrain.yOf(node)).toBeLessThanOrEqual(leadMaxY + dy);
      }
      for (let i = 1; i < lane.length; i++) {
        const previous = lane[i - 1];
        const node = lane[i];
        if (previous === undefined || node === undefined) throw new Error('missing step');
        terrain.stepsInto(previous, blocked, steps);
        expect(Array.from({ length: steps.length }, (_, j) => steps.nodeAt(j))).toContain(node);
      }
    }
  });

  it('bridges a slant on the side away from the leader, so a lane one row off shares none of its nodes', () => {
    const { terrain, blocked, lanes } = fixture();
    // The leader runs east along row 21, takes the SE edge from (50,21) to (51,22) and runs on along row 22.
    const route: NodeId[] = [];
    for (let x = 10; x <= 50; x++) route.push(terrain.nodeAt(x, 21));
    for (let x = 51; x <= 80; x++) route.push(terrain.nodeAt(x, 22));
    const routeNodes = new Set(route);
    for (const dy of [1, -1]) {
      const start = terrain.nodeAt(10, 21 + dy);
      const goal = terrain.nodeAt(80, 22 + dy);
      const lane = lanes.translated(blocked, route, start, goal, fx.fromInt(2), 2);
      if (lane === null) throw new Error(`no lane ${dy} rows off the leader`);
      expect(lane[0]).toBe(start);
      expect(lane.at(-1)).toBe(goal);
      expect(lane.some((node) => routeNodes.has(node))).toBe(false);
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

  it('refuses a translated slant whose landing and bridge are both blocked', () => {
    const { terrain, blocked, lanes } = fixture();
    const corridor: NodeId[] = [terrain.nodeAt(10, 10), terrain.nodeAt(10, 11), terrain.nodeAt(11, 12)];
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
  it("ends a member's search on the route of its own order, not another order's road passing nearer", () => {
    const width = 400;
    const height = 160;
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(width, height) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    const blocked = new NodeMask(terrain.nodeCount);
    // A wall between the two orders' roads, open only at the far end of the map.
    const wallY = 60;
    for (let x = 0; x < width - 10; x++) blocked.set(terrain.nodeAt(x, wallY), true);
    // A spur below it that B's road rounds at its foot, so no straight lane runs to B's slots.
    const spurX = 200;
    const spurFoot = 149;
    for (let y = wallY + 1; y <= spurFoot; y++) blocked.set(terrain.nodeAt(spurX, y), true);
    const routes = new GroupRoutes(terrain);
    // Order A marches above the wall, order B below it, both searched in one drain under one view.
    const orderA = findPath(terrain, terrain.nodeAt(4, 4), terrain.nodeAt(340, 8), blocked);
    const orderB = findPath(terrain, terrain.nodeAt(4, 150), terrain.nodeAt(340, 140), blocked);
    if (orderA === null || orderB === null) throw new Error('missing order routes');
    routes.offer(blocked, orderA);
    routes.offer(blocked, orderB);
    // A member of B just below the wall: A's road lies nearer it, beyond the wall, and nowhere near its slot.
    const goal = terrain.nodeAt(344, 140);
    const start = terrain.nodeAt(4, 66);
    const stops = routes.meetingStops(blocked, goal, false);
    if (stops === null) throw new Error('no route passes by the slot');
    const onto = findPath(terrain, start, goal, blocked, undefined, 'land', undefined, false, stops);
    if (onto === null) throw new Error('the member found no way onto a route');
    expect(roadOf(orderB).has(onto.at(-1) as NodeId)).toBe(true);
    const route = routes.followMeeting(blocked, onto, goal, { explored: 0 }, false);
    if (route === null) throw new Error('the member found no route to ride');
    expect(route.at(-1)).toBe(goal);
    expect(route.every((node) => terrain.yOf(node) > wallY)).toBe(true);
    // It rounds the spur on B's own road, and may leave it toward its slot only past the spur.
    const roadB = new Set(orderB);
    const atSpur = route.filter((node) => terrain.xOf(node) === spurX);
    expect(atSpur.length).toBeGreaterThan(0);
    expect(atSpur.every((node) => roadB.has(node))).toBe(true);
    // Its own search ran only as far as B's road.
    expect(route.slice(0, onto.length)).toEqual(onto);
  });
});
