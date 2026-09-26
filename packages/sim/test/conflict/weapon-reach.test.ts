import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Engagement, MoveGoal, Owner, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { type HalfCellNode, hexDistanceBetween, hexNeighboursOf } from '../../src/nav/halfcell.js';
import { forEachNodeInBand } from '../../src/systems/conflict/melee-slots.js';
import { combatSystem } from '../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import {
  BOW_MIN_RANGE,
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_BOW,
  SOLDIER_SWORD_SHORT,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

// Weapon reach counts map points: a target is in reach when its map-point distance lies in the band.

const P0 = 0;
const P1 = 1;
const MAP_CELLS = 40;
const MAP_ROWS = 12;
/** The fixture bow's far reach; its near reach is {@link BOW_MIN_RANGE}. */
const BOW_MAX_RANGE = 12;
/** One node on an even row and one on an odd row, whose neighbours in the rows beside them differ. */
const PARITIES: readonly HalfCellNode[] = [
  { hx: 20, hy: 10 },
  { hx: 20, hy: 11 },
];

function sim(): Simulation {
  return new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(MAP_CELLS, MAP_ROWS) });
}

function unitAt(s: Simulation, at: HalfCellNode, owner: number, mode: MilitaryMode, job: number): Entity {
  const e = fighterAtNode(s, at.hx, at.hy, owner === P0 ? VIKING : SAXON, job);
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

function swingsAt(s: Simulation, e: Entity, target: Entity): boolean {
  const effect = s.world.tryGet(e, CurrentAtomic)?.effect;
  return effect?.kind === 'attack' && effect.target === target;
}

function goalOf(s: Simulation, e: Entity): HalfCellNode {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  const goal = s.world.get(e, MoveGoal).cell;
  return { hx: terrain.xOf(goal), hy: terrain.yOf(goal) };
}

function distance(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

describe('weapon reach - a reach-1 band', () => {
  it('is the six map points around the target on either row parity', () => {
    for (const at of PARITIES) {
      const s = sim();
      const terrain = s.terrain;
      if (terrain === undefined) throw new Error('mapless sim');
      const band: string[] = [];
      forEachNodeInBand(terrain, terrain.nodeAt(at.hx, at.hy), { minRange: 1, maxRange: 1 }, (cell) => {
        band.push(`${terrain.xOf(cell)},${terrain.yOf(cell)}`);
        return true;
      });
      const around = hexNeighboursOf(at.hx, at.hy).map((n) => `${n.hx},${n.hy}`);
      expect(band.sort()).toEqual(around.sort());
    }
  });

  it('lets a swordsman strike from each of the six, and from no node a map point farther', () => {
    for (const at of PARITIES) {
      for (const side of hexNeighboursOf(at.hx, at.hy)) {
        const s = sim();
        const enemy = unitAt(s, at, P1, MILITARY_MODE.IGNORE, WOMAN);
        const sword = unitAt(s, side, P0, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
        combatSystem(s.world, ctxOf(s));
        expect(swingsAt(s, sword, enemy)).toBe(true);
      }
      // A diagonal neighbour on the lattice that is two map points off: the side the row parity leans away
      // from.
      const lean = at.hy % 2 === 0 ? 1 : -1;
      const beyond = { hx: at.hx + lean, hy: at.hy + 1 };
      expect(distance(at, beyond)).toBe(2);
      const s = sim();
      const enemy = unitAt(s, at, P1, MILITARY_MODE.IGNORE, WOMAN);
      const sword = unitAt(s, beyond, P0, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
      combatSystem(s.world, ctxOf(s));
      expect(swingsAt(s, sword, enemy)).toBe(false);
    }
  });
});

describe('weapon reach - a bow', () => {
  it('shoots a target inside its band in map points though farther in lattice steps', () => {
    const s = sim();
    const archer = unitAt(s, { hx: 10, hy: 4 }, P0, MILITARY_MODE.ATTACK, SOLDIER_BOW);
    // Ten rows down and five columns across: a diagonal half as wide as it is tall is free.
    const mark = { hx: 15, hy: 14 };
    expect(distance({ hx: 10, hy: 4 }, mark)).toBe(10);
    const enemy = unitAt(s, mark, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(s.world, ctxOf(s));
    expect(swingsAt(s, archer, enemy)).toBe(true);
  });

  it('holds its fire on a target inside its dead zone in map points and steps back out to shoot', () => {
    const here = { hx: 10, hy: 4 };
    const mark = { hx: 11, hy: 6 }; // three lattice steps, two map points
    expect(distance(here, mark)).toBe(BOW_MIN_RANGE - 1);

    const ignoring = sim();
    const still = unitAt(ignoring, here, P0, MILITARY_MODE.IGNORE, SOLDIER_BOW);
    unitAt(ignoring, mark, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(ignoring.world, ctxOf(ignoring));
    expect(ignoring.world.has(still, Engagement)).toBe(false);

    const s = sim();
    const archer = unitAt(s, here, P0, MILITARY_MODE.ATTACK, SOLDIER_BOW);
    const enemy = unitAt(s, mark, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(s.world, ctxOf(s));
    expect(swingsAt(s, archer, enemy)).toBe(false);
    // The nearest node at its near reach, canonical by (distance, cell id): of the steps that put the mark
    // a near reach away, the lowest node.
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    const back = hexNeighboursOf(here.hx, here.hy)
      .filter((n) => distance(n, mark) === BOW_MIN_RANGE)
      .map((n) => terrain.nodeAt(n.hx, n.hy));
    expect(back.length).toBeGreaterThan(0);
    expect(s.world.get(archer, MoveGoal).cell).toBe(Math.min(...back));
  });

  it('closes on a far target to the standoff (2 * max - min) / 2 in map points', () => {
    const STANDOFF = (2 * BOW_MAX_RANGE - BOW_MIN_RANGE) >> 1;
    const s = sim();
    const archer = unitAt(s, { hx: 10, hy: 0 }, P0, MILITARY_MODE.ATTACK, SOLDIER_BOW);
    const mark = { hx: 14, hy: 17 };
    expect(distance({ hx: 10, hy: 0 }, mark)).toBeGreaterThan(BOW_MAX_RANGE);
    unitAt(s, mark, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(s.world, ctxOf(s));
    expect(distance(goalOf(s, archer), mark)).toBe(STANDOFF);
  });
});
