import { describe, expect, it } from 'vitest';
import { MoveGoal, Owner, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  forEachRingNode,
  type HalfCellNode,
  hexDistanceBetween,
  hexNeighboursOf,
} from '../../src/nav/halfcell.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_SWORD_SHORT,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

// A melee attacker's contact slot is drawn among the free cells of its band at the nearest distance from it.

const P0 = 0;
const P1 = 1;
const MAP_CELLS = 40;
const MAP_ROWS = 12;
const ENEMY: HalfCellNode = { hx: 40, hy: 10 };
/** Enough seeds to see every choice of a draw among a few cells. */
const SEEDS = 24;

function distance(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

/** The cell a lone swordsman starting at `from` is dealt against an enemy at {@link ENEMY}, per seed. */
function dealtSlot(seed: number, from: HalfCellNode): HalfCellNode {
  const s = new Simulation({ seed, content: combatCadenceContent(), map: grass(MAP_CELLS, MAP_ROWS) });
  const at = (node: HalfCellNode, owner: number, mode: number, job: number): Entity => {
    const e = fighterAtNode(s, node.hx, node.hy, owner === P0 ? VIKING : SAXON, job);
    s.world.add(e, Owner, { player: owner });
    s.world.add(e, Stance, { mode, anchorCell: null });
    return e;
  };
  at(ENEMY, P1, MILITARY_MODE.IGNORE, WOMAN);
  const sword = at(from, P0, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
  combatSystem(s.world, ctxOf(s));
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  const goal = s.world.get(sword, MoveGoal).cell;
  return { hx: terrain.xOf(goal), hy: terrain.yOf(goal) };
}

describe('contact slot - the draw stays at the nearest distance', () => {
  it('sends a lone swordsman three map points off to the near side, whatever the seed', () => {
    const from = { hx: ENEMY.hx + 3, hy: ENEMY.hy };
    expect(distance(from, ENEMY)).toBe(3);
    const nearSide = hexNeighboursOf(ENEMY.hx, ENEMY.hy).filter((n) => distance(n, from) === 2);
    expect(nearSide).toHaveLength(1);
    for (let seed = 1; seed <= SEEDS; seed++) {
      expect(dealtSlot(seed, from)).toEqual(nearSide[0]);
    }
  });

  it('still draws among the free cells that share the nearest distance', () => {
    // Two map points off, around the bend: two of the enemy's sides are equally near.
    const sides = hexNeighboursOf(ENEMY.hx, ENEMY.hy);
    const nearSidesOf = (from: HalfCellNode): string[] => {
      const nearest = Math.min(...sides.map((n) => distance(n, from)));
      return sides.filter((n) => distance(n, from) === nearest).map((n) => `${n.hx},${n.hy}`);
    };
    let from: HalfCellNode | undefined;
    forEachRingNode(ENEMY, 2, MAP_CELLS * 2, MAP_ROWS * 2, (hx, hy) => {
      if (nearSidesOf({ hx, hy }).length === 2) from = { hx, hy };
      return from === undefined;
    });
    if (from === undefined) throw new Error('no bent approach two points off');
    const nearSides = nearSidesOf(from);
    const dealt = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const slot = dealtSlot(seed, from);
      dealt.add(`${slot.hx},${slot.hy}`);
      expect(nearSides).toContain(`${slot.hx},${slot.hy}`);
    }
    expect(dealt.size).toBe(2);
  });
});
