import { describe, expect, it } from 'vitest';
import { Engagement, Owner, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { type HalfCellNode, hexDistanceBetween, hexNeighboursOf } from '../../src/nav/halfcell.js';
import { CROWDING_WEIGHT } from '../../src/systems/conflict/engagement.js';
import { combatSystem, REPATH_CADENCE } from '../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
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

// The melee front without formations: a fighter picks the enemy fewest bodies already stand at, so two
// lines meet along their length and the larger side wraps the smaller instead of piling onto one man.

const P0 = 0;
const P1 = 1;
const MAP_CELLS = 40;
const MAP_ROWS = 6;
/** The row the picker and its enemies stand on; node distances along it are plain column differences. */
const ROW = 6;
const PICKER: HalfCellNode = { hx: 10, hy: ROW };
/** Enough seeds to see every choice of a draw among a few candidates. */
const SEEDS = 24;

function sim(seed = 1): Simulation {
  return new Simulation({ seed, content: combatCadenceContent(), map: grass(MAP_CELLS, MAP_ROWS) });
}

function unit(s: Simulation, at: HalfCellNode, owner: number, mode: MilitaryMode, job: number): Entity {
  const e = fighterAtNode(s, at.hx, at.hy, owner === P0 ? VIKING : SAXON, job);
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

/** A blue swordsman set to ATTACK at {@link PICKER}. */
function picker(s: Simulation): Entity {
  return unit(s, PICKER, P0, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
}

/** A red civilian standing still at `at`, a target that neither strikes nor runs. */
function enemy(s: Simulation, at: HalfCellNode): Entity {
  return unit(s, at, P1, MILITARY_MODE.IGNORE, WOMAN);
}

/** `count` blue swordsmen standing on `at`'s neighbours, western ones first so a partial crowd never also
 *  neighbours an enemy farther east, striking whatever they reach where they stand. */
function crowd(s: Simulation, at: HalfCellNode, count: number): void {
  const sides = hexNeighboursOf(at.hx, at.hy).sort((a, b) => a.hx - b.hx || a.hy - b.hy);
  for (const n of sides.slice(0, count)) unit(s, n, P0, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
}

function held(s: Simulation, e: Entity): Entity | undefined {
  return s.world.tryGet(e, Engagement)?.target;
}

/** The first tick from `from` on which a standing `e` with its target out of reach looks again. */
function nextStride(from: number, e: Entity): number {
  let tick = from;
  while ((tick + e) % REPATH_CADENCE !== 0) tick++;
  return tick;
}

/** Which of `build`'s two enemies the picker takes over {@link SEEDS} seeds: 'near', 'far' or both. */
function picksOver(build: (s: Simulation) => { near: Entity; far: Entity }): string[] {
  const picked = new Set<string>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = sim(seed);
    const soldier = picker(s);
    const { near, far } = build(s);
    combatSystem(s.world, ctxOf(s));
    const target = held(s, soldier);
    picked.add(target === near ? 'near' : target === far ? 'far' : 'other');
  }
  return [...picked].sort();
}

describe('melee front - the pick weighs the bodies already standing at an enemy', () => {
  const NEAR: HalfCellNode = { hx: PICKER.hx + 6, hy: ROW };
  /** Within the draw's spread of the nearest, so both are candidates. */
  const FAR: HalfCellNode = { hx: PICKER.hx + 8, hy: ROW };

  it('takes the nearer of two open enemies, and the farther one when two friends stand at the nearer', () => {
    expect(CROWDING_WEIGHT).toBe(2);
    expect(hexDistanceBetween(PICKER.hx, PICKER.hy, FAR.hx, FAR.hy)).toBe(8);
    expect(picksOver((s) => ({ near: enemy(s, NEAR), far: enemy(s, FAR) }))).toEqual(['near']);
    // Two bodies cost the nearer enemy four map points against the two it is nearer by.
    expect(
      picksOver((s) => {
        const near = enemy(s, NEAR);
        crowd(s, NEAR, 2);
        return { near, far: enemy(s, FAR) };
      }),
    ).toEqual(['far']);
  });

  it('draws between them when one friend stands at the nearer, which only ties the scores', () => {
    expect(
      picksOver((s) => {
        const near = enemy(s, NEAR);
        crowd(s, NEAR, 1);
        return { near, far: enemy(s, FAR) };
      }),
    ).toEqual(['far', 'near']);
  });

  it('never takes an enemy more than the spread past the nearest, however crowded the nearest is', () => {
    const EVERY_SIDE = 6;
    const past: HalfCellNode = { hx: PICKER.hx + 10, hy: ROW };
    expect(
      picksOver((s) => {
        const near = enemy(s, NEAR);
        crowd(s, NEAR, EVERY_SIDE);
        return { near, far: enemy(s, past) };
      }),
    ).toEqual(['near']);
  });

  it('leaves an enemy nobody can step up to any more for any other candidate, and takes it alone', () => {
    const EVERY_SIDE = 6;
    // Sealed at 6 scores 18; five bodies at 9 score 19, which the sealed enemy would beat on score alone.
    const farOff: HalfCellNode = { hx: PICKER.hx + 9, hy: ROW };
    expect(
      picksOver((s) => {
        const near = enemy(s, NEAR);
        crowd(s, NEAR, EVERY_SIDE);
        const far = enemy(s, farOff);
        crowd(s, farOff, EVERY_SIDE - 1);
        return { near, far };
      }),
    ).toEqual(['far']);
    const s = sim();
    const soldier = picker(s);
    const sealed = enemy(s, NEAR);
    crowd(s, NEAR, EVERY_SIDE);
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(sealed);
  });

  it('lets a rescan take over an enemy as near as the held one when fewer bodies stand at it', () => {
    const s = sim();
    const soldier = picker(s);
    const heldEnemy = enemy(s, NEAR);
    crowd(s, NEAR, 1);
    const open = enemy(s, { hx: PICKER.hx - 6, hy: ROW });
    s.world.add(soldier, Engagement, { repathAt: s.tick, target: heldEnemy });
    // A standing fighter with its target out of reach looks again on its re-path stride.
    combatSystem(s.world, { ...ctxOf(s), tick: nextStride(s.tick, soldier) });
    expect(held(s, soldier)).toBe(open);
  });
});
