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
import type { NodeId } from '../../src/nav/terrain/index.js';
import { CROWDING_WEIGHT } from '../../src/systems/conflict/engagement.js';
import { MeleeSlots, type OwnClaims } from '../../src/systems/conflict/melee-slots.js';
import { combatSystem, REPATH_CADENCE } from '../../src/systems/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_BOW,
  SOLDIER_SPEAR,
  SOLDIER_SWORD_SHORT,
  startSwing,
  VIKING,
  WOMAN,
} from './combat-cadence/support.js';

// The melee front without formations: a fighter picks the enemy fewest of its own side already stand at,
// steps along a full front and turns from a crowded enemy after a blow, so two lines meet along their
// length and the larger side wraps the smaller instead of piling onto one man.

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

/** A blue fighter of `job` set to ATTACK at {@link PICKER}. */
function picker(s: Simulation, job = SOLDIER_SWORD_SHORT): Entity {
  return unit(s, PICKER, P0, MILITARY_MODE.ATTACK, job);
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

/** Which of `build`'s two enemies a picker of `job` takes over {@link SEEDS} seeds: 'near', 'far' or both. */
function picksOver(
  build: (s: Simulation) => { near: Entity; far: Entity },
  job = SOLDIER_SWORD_SHORT,
): string[] {
  const picked = new Set<string>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = sim(seed);
    const soldier = picker(s, job);
    const { near, far } = build(s);
    combatSystem(s.world, ctxOf(s));
    const target = held(s, soldier);
    picked.add(target === near ? 'near' : target === far ? 'far' : 'other');
  }
  return [...picked].sort();
}

describe('melee front - the pick weighs the bodies already standing at an enemy', () => {
  const NEAR: HalfCellNode = { hx: PICKER.hx + 6, hy: ROW };
  /** One friend's weight farther, within the draw's spread of the nearest, so both are candidates. */
  const FAR: HalfCellNode = { hx: NEAR.hx + CROWDING_WEIGHT, hy: ROW };

  it('takes the nearer of two open enemies, and the farther one when two friends stand at the nearer', () => {
    expect(hexDistanceBetween(PICKER.hx, PICKER.hy, FAR.hx, FAR.hy)).toBe(6 + CROWDING_WEIGHT);
    expect(picksOver((s) => ({ near: enemy(s, NEAR), far: enemy(s, FAR) }))).toEqual(['near']);
    // Two bodies cost the nearer enemy twice the weight against the one weight it is nearer by.
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

  it('leaves an archer to the plain draw among the nearest few, whoever stands at them', () => {
    // Both enemies lie inside the bow's band; the two friends at the nearer one would decide a swordsman's
    // pick, and a bow keeps its standoff instead of forming a front.
    expect(
      picksOver((s) => {
        const near = enemy(s, NEAR);
        crowd(s, NEAR, 2);
        return { near, far: enemy(s, FAR) };
      }, SOLDIER_BOW),
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
    ring(s, OTHER, 1); // its near ring full too: only the seam a step south reaches it
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
    // Off its stride, so the pick never looks again and only the step along the front can turn it; a
    // fighter first finding the front full asks for its step at once.
    combatSystem(s.world, { ...ctxOf(s), tick: nextStride(s.tick, spearman) + 1 });
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

describe("melee front - what counts as an enemy's crowd", () => {
  const SWORD_REACH = { minRange: 1, maxRange: 1 };
  const AT: HalfCellNode = { hx: PICKER.hx + 1, hy: ROW };
  /** The enemy's sides other than the asker's own node. */
  const otherSides = hexNeighboursOf(AT.hx, AT.hy).filter((n) => n.hx !== PICKER.hx || n.hy !== ROW);

  function slotsOf(s: Simulation): { slots: MeleeSlots; node: (n: HalfCellNode) => NodeId } {
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    return { slots: new MeleeSlots(s.world, ctxOf(s), terrain), node: (n) => terrain.nodeAt(n.hx, n.hy) };
  }

  it("counts the asker's own node as a side left to strike from, not as crowd", () => {
    const s = sim();
    picker(s);
    enemy(s, AT);
    for (const n of otherSides) unit(s, n, P0, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
    const { slots, node } = slotsOf(s);
    const standing: OwnClaims = { goal: undefined, standingOn: node(PICKER) };
    expect(slots.crowdingAround(node(AT), SWORD_REACH, P0, standing)).toEqual({ occupied: 5, sealed: false });
    const elsewhere: OwnClaims = { goal: undefined, standingOn: undefined };
    expect(slots.crowdingAround(node(AT), SWORD_REACH, P0, elsewhere)).toEqual({ occupied: 6, sealed: true });
  });

  it('counts a friend still walking to a side as crowd, and any walker as taking the side', () => {
    const FAR_OFF: HalfCellNode = { hx: PICKER.hx + 10, hy: ROW + 4 };
    for (const [walkerSide, occupied] of [
      [P0, 6],
      [P1, 5],
    ] as const) {
      const s = sim();
      picker(s);
      enemy(s, AT);
      const [free, ...taken] = otherSides;
      if (free === undefined) throw new Error('fixture: no free side');
      for (const n of taken) unit(s, n, P0, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
      const walker = unit(s, FAR_OFF, walkerSide, MILITARY_MODE.IGNORE, SOLDIER_SWORD_SHORT);
      const { slots, node } = slotsOf(s);
      // Asked from elsewhere, so the picker's own node is one more taken side.
      const mine: OwnClaims = { goal: undefined, standingOn: undefined };
      expect(slots.crowdingAround(node(AT), SWORD_REACH, P0, mine)).toEqual({ occupied: 5, sealed: false });
      s.world.add(walker, Engagement, { repathAt: s.tick });
      s.world.add(walker, MoveGoal, { cell: node(free) });
      const later = slotsOf(s).slots;
      expect(later.crowdingAround(node(AT), SWORD_REACH, P0, mine)).toEqual({ occupied, sealed: true });
    }
  });
});
