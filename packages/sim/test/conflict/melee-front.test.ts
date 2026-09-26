import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Engagement, MoveGoal, Owner, Stance } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  forEachRingNode,
  type HalfCellNode,
  hexDistanceBetween,
  hexNeighboursOf,
} from '../../src/nav/halfcell.js';
import { CROWDING_WEIGHT } from '../../src/systems/conflict/engagement.js';
import { combatSystem, REPATH_CADENCE } from '../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_SPEAR,
  SOLDIER_SWORD_SHORT,
  startSwing,
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

describe('melee front - a fighter behind a full front steps along it', () => {
  const SPEAR_REACH = 2;
  /** The spearman stands a step behind the whole band around the enemy it holds. */
  const HELD: HalfCellNode = { hx: PICKER.hx + SPEAR_REACH + 1, hy: ROW };
  /** As far off, down the map: reached in one step from the node south of the spearman. */
  const OTHER: HalfCellNode = { hx: PICKER.hx, hy: ROW + SPEAR_REACH + 1 };
  const SEAM: HalfCellNode = { hx: PICKER.hx, hy: ROW + 1 };

  /** Blue spearmen on every node within `radius` of `at`, striking it where they stand. */
  function ring(s: Simulation, at: HalfCellNode, radius: number): void {
    for (let r = 1; r <= radius; r++) {
      forEachRingNode(at, r, 2 * MAP_CELLS, 2 * MAP_ROWS, (hx, hy) => {
        unit(s, { hx, hy }, P0, MILITARY_MODE.IGNORE, SOLDIER_SPEAR);
        return true;
      });
    }
  }

  /** The spearman holding an enemy whose whole band is taken; `waiting` marks one already standing in
   *  the second rank, whose next look comes on its stride rather than at once. */
  function front(waiting?: true): { s: Simulation; spearman: Entity; heldEnemy: Entity; other: Entity } {
    const s = sim();
    const spearman = unit(s, PICKER, P0, MILITARY_MODE.ATTACK, SOLDIER_SPEAR);
    const heldEnemy = enemy(s, HELD);
    ring(s, HELD, SPEAR_REACH); // every cell the spear could strike from is a friend's
    const other = enemy(s, OTHER);
    ring(s, OTHER, 1); // as crowded as the held one, so the pick keeps the held one on a tie
    s.world.add(spearman, Engagement, { repathAt: s.tick, target: heldEnemy, waiting });
    return { s, spearman, heldEnemy, other };
  }

  it('is the fixture it claims: a step behind both enemies, with the seam a step south', () => {
    const dist = (a: HalfCellNode, b: HalfCellNode) => hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
    expect(dist(PICKER, HELD)).toBe(SPEAR_REACH + 1);
    expect(dist(PICKER, OTHER)).toBe(SPEAR_REACH + 1);
    expect(dist(SEAM, OTHER)).toBe(SPEAR_REACH);
    expect(dist(SEAM, HELD)).toBe(SPEAR_REACH + 1); // the seam is no cell of the held enemy's band
  });

  it('steps to the free node that brings another enemy into reach and takes that enemy up', () => {
    const { s, spearman, other } = front();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    combatSystem(s.world, { ...ctxOf(s), tick: nextStride(s.tick, spearman) });
    expect(held(s, spearman)).toBe(other);
    expect(s.world.get(spearman, MoveGoal).cell).toBe(terrain.nodeAt(SEAM.hx, SEAM.hy));
    expect(s.world.get(spearman, Engagement).waiting).toBeUndefined();
  });

  it('holds where it stands between strides, and strikes from the seam once it gets there', () => {
    const { s, spearman, heldEnemy, other } = front(true);
    const off = nextStride(s.tick, spearman) + 1;
    combatSystem(s.world, { ...ctxOf(s), tick: off });
    expect(held(s, spearman)).toBe(heldEnemy);
    expect(s.world.get(spearman, Engagement).waiting).toBe(true);
    expect(s.world.has(spearman, MoveGoal)).toBe(false);
    let struck = false;
    for (let i = 0; i < 60 && !struck; i++) {
      s.step();
      struck = s.world.tryGet(spearman, CurrentAtomic)?.effect.kind === 'attack';
    }
    expect(struck).toBe(true);
    expect(s.world.get(spearman, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: other });
  });
});

describe('melee front - a fighter about to strike turns to a less crowded enemy in reach or a step off', () => {
  /** In the swordsman's reach. */
  const STRUCK: HalfCellNode = { hx: PICKER.hx + 1, hy: ROW };
  /** A step outside its reach, the other way. */
  const OPEN: HalfCellNode = { hx: PICKER.hx - 2, hy: ROW };
  const SWING_TICKS = 12;

  /** The swordsman holding an enemy in reach that `others` more blue swordsmen also stand at. */
  function inContact(others: number): { s: Simulation; soldier: Entity; struck: Entity } {
    const s = sim();
    const soldier = picker(s);
    const struck = enemy(s, STRUCK);
    // East of the struck enemy, away from the swordsman's own node.
    const sides = hexNeighboursOf(STRUCK.hx, STRUCK.hy).sort((a, b) => b.hx - a.hx || a.hy - b.hy);
    for (const n of sides.slice(0, others)) unit(s, n, P0, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
    s.world.add(soldier, Engagement, { repathAt: s.tick, target: struck });
    return { s, soldier, struck };
  }

  it('turns to an enemy a step off that nobody stands at when two friends share its own', () => {
    const { s, soldier } = inContact(2);
    const open = enemy(s, OPEN);
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(open);
    expect(s.world.has(soldier, CurrentAtomic)).toBe(false); // it walks the step before it strikes
    expect(s.world.has(soldier, MoveGoal)).toBe(true);
  });

  it('keeps striking when the other enemy is as crowded, and never turns mid-swing', () => {
    const { s, soldier, struck } = inContact(1);
    enemy(s, OPEN);
    crowd(s, OPEN, 1);
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(struck);
    expect(s.world.get(soldier, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: struck });

    const mid = inContact(2);
    const open = enemy(mid.s, OPEN);
    startSwing(mid.s, mid.soldier, { target: mid.struck, damage: 1 }, SWING_TICKS);
    combatSystem(mid.s.world, ctxOf(mid.s));
    expect(held(mid.s, mid.soldier)).toBe(mid.struck);
    expect(held(mid.s, mid.soldier)).not.toBe(open);
  });

  it('never turns from an enemy fighter to a civilian, however open she stands', () => {
    const s = sim();
    const soldier = picker(s);
    const fighter = unit(s, STRUCK, P1, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
    const sides = hexNeighboursOf(STRUCK.hx, STRUCK.hy).sort((a, b) => b.hx - a.hx || a.hy - b.hy);
    for (const n of sides.slice(0, 2)) unit(s, n, P0, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
    enemy(s, OPEN);
    s.world.add(soldier, Engagement, { repathAt: s.tick, target: fighter });
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(fighter);
  });
});
