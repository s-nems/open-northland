import { describe, expect, it, vi } from 'vitest';
import { Position } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { hexDistance, positionOfNode } from '../../src/nav/halfcell.js';
import { groupsWithinRange } from '../../src/systems/missions/nearby.js';

function placed(world: World, hx: number, hy: number) {
  const e = world.create();
  world.add(e, Position, positionOfNode(hx, hy));
  return e;
}

describe('mission proximity index', () => {
  it('matches the hex metric at both row parities and negative coordinates', () => {
    const world = new World();
    const source = placed(world, 0, 0);
    const target = placed(world, 0, 0);
    for (let ay = -2; ay <= 2; ay++) {
      world.add(source, Position, positionOfNode(0, ay));
      for (let by = -6; by <= 6; by++) {
        for (let bx = -6; bx <= 6; bx++) {
          world.add(target, Position, positionOfNode(bx, by));
          for (let range = 0; range <= 5; range++) {
            expect(groupsWithinRange(world, [source], [target], range)).toBe(
              hexDistance({ hx: bx, hy: by }, { hx: 0, hy: ay }) <= range,
            );
          }
        }
      }
    }
  });

  it('reads each position once for separated groups, including dense occupied rows', () => {
    const reads: number[] = [];
    for (const size of [100, 200, 400]) {
      const world = new World();
      const sources = Array.from({ length: size }, (_, x) => placed(world, x, 0));
      const targets = Array.from({ length: size }, (_, x) => placed(world, 1000 + x, 0));
      const read = vi.spyOn(world, 'tryGet');
      expect(groupsWithinRange(world, sources, targets, 5)).toBe(false);
      reads.push(read.mock.calls.length);
      read.mockRestore();
    }
    expect(reads).toEqual([200, 400, 800]);
  });

  it('rebuilds after movement and ignores entities without positions', () => {
    const world = new World();
    const source = placed(world, 1, 1);
    const target = placed(world, 20, 20);
    const nowhere = world.create();
    expect(groupsWithinRange(world, [source], [nowhere, target], 0)).toBe(false);
    world.add(target, Position, positionOfNode(1, 1));
    expect(groupsWithinRange(world, [nowhere, source], [target], 0)).toBe(true);
    world.destroy(target);
    expect(groupsWithinRange(world, [source], [target], 0)).toBe(false);
  });
});
