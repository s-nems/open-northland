import { expect, it } from 'vitest';
import {
  Building,
  Carrying,
  MoveGoal,
  Owner,
  Palisade,
  Position,
  Stockpile,
} from '../../src/components/index.js';
import { ONE, positionOfNode, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { StoreSinks } from '../../src/systems/settlers/targets/stores/sinks.js';
import { ownedWoodcutter } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

it('delivers carried wood directly to a store past finished walls without a lost report', () => {
  const wallType: ScriptLandscapeType = {
    typeId: 691,
    walk: [{ dx: 0, dy: 0 }],
    build: [],
    groups: [],
    wall: {
      maxHitpoints: 100,
      repairPerStrike: 1,
      construction: [{ goodType: 1, amount: 1 }],
    },
  };
  const s = new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(32, 16),
      landscapes: { types: [wallType], placements: [] },
    },
  });
  const store = s.world.create();
  s.world.add(store, Position, positionOfNode(24, 8));
  s.world.add(store, Building, {
    buildingType: 1,
    tribe: 1,
    built: ONE,
    level: 0,
  });
  s.world.add(store, Stockpile, { amounts: new Map() });
  s.world.add(store, Owner, { player: 0 });
  s.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: 691,
    x: 10,
    y: 8,
    tribe: 1,
    owner: 0,
  });
  s.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: 691,
    x: 14,
    y: 8,
    tribe: 1,
    owner: 0,
  });
  const worker = ownedWoodcutter(s, 2, 4);
  s.world.add(worker, Carrying, { goodType: 1, amount: 1 });
  const lost: number[] = [];
  let firstGoal: number | undefined;
  for (let i = 0; i < 500; i++) {
    s.step();
    firstGoal ??= s.world.tryGet(worker, MoveGoal)?.cell;
    for (const wall of s.world.query(Palisade)) {
      for (const good of s.content.goods) {
        for (const mode of [false, true])
          expect(StoreSinks.of(s.world, ctxOf(s)).sinks(good.typeId, mode).has(wall)).toBe(false);
      }
    }
    for (const ev of s.events.current())
      if (ev.kind === 'settlerLost' && ev.entity === worker) lost.push(s.tick);
  }
  expect([...s.world.query(Palisade)]).toHaveLength(2);
  expect(firstGoal).toBe(s.terrain?.nodeAt(24, 8));
  expect(lost).toEqual([]);
  expect(s.world.get(store, Stockpile).amounts.get(1)).toBe(1);
  expect(s.world.verifyCaches()).toEqual([]);
  expect(s.checkInvariants()).toEqual([]);
});
