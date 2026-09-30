import { expect, it } from 'vitest';
import {
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Position,
} from '../../../src/components/index.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { ownedWoodcutter } from './support.js';

it.each(['straight', 'diagonal-first', 'diagonal-second', 'replace-stop'] as const)(
  'finishes only the live step after a refused redirect: %s',
  (kind) => {
    const map = grassNodeMap(24, 16);
    const typeIds = [...map.typeIds];
    for (let y = 0; y < 16; y++) typeIds[y * 24 + 12] = 1;
    const sim = new Simulation({ seed: 1, content: testContent(), map: { ...map, typeIds } });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped simulation');
    const e = ownedWoodcutter(sim, 0, 0);
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: 8, y: kind === 'straight' ? 4 : 8 });
    for (let i = 0; i < 40; i++) {
      sim.step();
      const follow = sim.world.tryGet(e, PathFollow);
      const p = sim.world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      const centre = positionOfNode(n.hx, n.hy);
      if (follow?.index === (kind === 'diagonal-second' ? 2 : 1) && (p.x !== centre.x || p.y !== centre.y))
        break;
    }
    expect(sim.world.has(e, PathFollow)).toBe(true);
    sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: 20, y: 4 });
    sim.step();
    expect(sim.world.get(e, PathRequest).failed).toBe(true);
    const follow = sim.world.get(e, PathFollow);
    const stop = sim.world
      .get(e, PathRoute)
      .waypoints.slice(follow.index)
      .find((p) => {
        const c = positionOfNode(terrain.xOf(p.node), terrain.yOf(p.node));
        return p.x === c.x && p.y === c.y;
      });
    if (stop === undefined) throw new Error('safe stopping node');
    let lost = 0;
    sim.step();
    lost += sim.events.current().filter((ev) => ev.kind === 'settlerLost' && ev.entity === e).length;
    expect(sim.world.has(e, PlayerOrder)).toBe(false);
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    if (kind === 'replace-stop') sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: 2, y: 2 });
    for (let i = 0; i < 100; i++) {
      sim.step();
      lost += sim.events.current().filter((ev) => ev.kind === 'settlerLost' && ev.entity === e).length;
    }
    expect(lost).toBe(1);
    expect(sim.world.get(e, Position)).toEqual(
      kind === 'replace-stop' ? positionOfNode(2, 2) : { x: stop.x, y: stop.y },
    );
    expect(sim.world.has(e, PathFollow)).toBe(false);
    sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: 6, y: 4 });
    sim.run(100);
    expect(sim.world.get(e, Position)).toEqual(positionOfNode(6, 4));
    expect(sim.checkInvariants()).toEqual([]);
  },
);
