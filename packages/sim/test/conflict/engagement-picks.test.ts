import { describe, expect, it } from 'vitest';
import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  MoveGoal,
  Owner,
  Position,
  Stance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import {
  combatSystem,
  DEFEND_LEASH_NODES,
  DEFEND_RADIUS_NODES,
  IGNORE_LEASH_NODES,
  REPATH_CADENCE,
  SIGHT_RADIUS_NODES,
} from '../../src/systems/index.js';
import { moveUnit } from '../../src/systems/orders/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import {
  BOW_MIN_RANGE,
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_BOW,
  SOLDIER_SPEAR,
  SOLDIER_SWORD_SHORT,
  VIKING,
  WOLF_TRIBE,
  WOMAN,
} from './combat-cadence/support.js';

const P0 = 0;
const P1 = 1;
/** The row every unit stands on; node distances are then plain column differences. */
const ROW = 0;
const MAP_CELLS = 40;
/** Long enough to walk 20 nodes, retire the order and, without the fix, walk back to the old anchor. */
const SETTLE_TICKS = 400;

function sim(seed = 1): Simulation {
  return new Simulation({ seed, content: combatCadenceContent(), map: grass(MAP_CELLS, 2) });
}

/** An owned unit at node (hx, ROW) under `mode`. */
function unit(s: Simulation, hx: number, owner: number, mode: MilitaryMode, job = SOLDIER_SPEAR): Entity {
  const e = fighterAtNode(s, hx, ROW, owner === P0 ? VIKING : SAXON, job);
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode, anchorCell: null });
  return e;
}

function anchorAt(s: Simulation, e: Entity, hx: number): void {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('mapless sim');
  s.world.mut(e, Stance).anchorCell = terrain.nodeAtClamped(hx, ROW);
}

function held(s: Simulation, e: Entity): Entity | undefined {
  return s.world.tryGet(e, Engagement)?.target;
}

function hold(s: Simulation, e: Entity, target: Entity): void {
  s.world.add(e, Engagement, { repathAt: s.tick, target });
}

describe('engagement - how far each stance looks', () => {
  it('ATTACK takes an enemy 18 nodes off and none past it', () => {
    for (const [off, found] of [
      [SIGHT_RADIUS_NODES, true],
      [SIGHT_RADIUS_NODES + 1, false],
    ] as const) {
      const s = sim();
      const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
      const enemy = unit(s, off, P1, MILITARY_MODE.IGNORE, WOMAN);
      combatSystem(s.world, ctxOf(s));
      expect(held(s, soldier)).toBe(found ? enemy : undefined);
    }
    expect(SIGHT_RADIUS_NODES).toBe(18);
  });

  it('counts its reach in map points, where a diagonal half as wide as it is tall comes free', () => {
    const ROWS = SIGHT_RADIUS_NODES; // an even row span, so no half-node lean applies
    const FREE_COLUMNS = ROWS / 2;
    for (const [columns, found] of [
      [FREE_COLUMNS, true], // 27 Manhattan nodes off, still 18 map points
      [FREE_COLUMNS + 1, false],
    ] as const) {
      const s = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(MAP_CELLS, ROWS) });
      const soldier = fighterAtNode(s, 20, 0, VIKING, SOLDIER_SPEAR);
      s.world.add(soldier, Owner, { player: P0 });
      s.world.add(soldier, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
      const enemy = fighterAtNode(s, 20 + columns, ROWS, SAXON, WOMAN);
      s.world.add(enemy, Owner, { player: P1 });
      s.world.add(enemy, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null });
      combatSystem(s.world, ctxOf(s));
      expect(held(s, soldier)).toBe(found ? enemy : undefined);
    }
  });

  it('DEFEND looks 18 around its anchor and lets a held enemy go past 40', () => {
    expect([DEFEND_RADIUS_NODES, DEFEND_LEASH_NODES]).toEqual([18, 40]);
    const anchor = 10;
    for (const [off, found] of [
      [DEFEND_RADIUS_NODES, true],
      [DEFEND_RADIUS_NODES + 1, false],
    ] as const) {
      const s = sim();
      const guard = unit(s, anchor, P0, MILITARY_MODE.DEFEND);
      anchorAt(s, guard, anchor);
      const enemy = unit(s, anchor + off, P1, MILITARY_MODE.IGNORE, WOMAN);
      combatSystem(s.world, ctxOf(s));
      expect(held(s, guard)).toBe(found ? enemy : undefined);
    }
    for (const [off, kept] of [
      [DEFEND_LEASH_NODES, true],
      [DEFEND_LEASH_NODES + 1, false],
    ] as const) {
      const s = sim();
      const guard = unit(s, 0, P0, MILITARY_MODE.DEFEND);
      anchorAt(s, guard, 0);
      const enemy = unit(s, off, P1, MILITARY_MODE.IGNORE, WOMAN);
      hold(s, guard, enemy);
      combatSystem(s.world, ctxOf(s));
      expect(held(s, guard)).toBe(kept ? enemy : undefined);
    }
  });

  it('IGNORE strikes only inside its weapon reach, and only a fighter does', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.IGNORE);
    const near = unit(s, 2, P1, MILITARY_MODE.IGNORE, WOMAN); // the spear reaches 1..2
    combatSystem(s.world, ctxOf(s));
    expect(s.world.get(soldier, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: near });

    const t = sim();
    const out = unit(t, 0, P0, MILITARY_MODE.IGNORE);
    unit(t, 3, P1, MILITARY_MODE.IGNORE, WOMAN);
    const civilian = unit(t, 20, P0, MILITARY_MODE.IGNORE, WOMAN);
    unit(t, 21, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(t.world, ctxOf(t));
    expect(t.world.has(out, Engagement)).toBe(false);
    expect(t.world.has(civilian, Engagement)).toBe(false);
  });

  it('a move order carries an IGNORE anchor along, so the unit stays where it was sent', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.IGNORE);
    anchorAt(s, soldier, 0);
    unit(s, 2 * MAP_CELLS - 1, P1, MILITARY_MODE.IGNORE, WOMAN); // keeps the combat pass awake, out of reach
    const sent = 20;
    moveUnit(s.world, ctxOf(s), { kind: 'moveUnit', entity: soldier, x: sent, y: ROW });
    for (let t = 0; t < SETTLE_TICKS; t++) s.step();
    const p = s.world.get(soldier, Position);
    expect(nodeOfPosition(p.x, p.y)).toEqual({ hx: sent, hy: ROW });
  });

  it('IGNORE lets a held enemy go past 18 from its anchor', () => {
    expect(IGNORE_LEASH_NODES).toBe(18);
    for (const [off, kept] of [
      [IGNORE_LEASH_NODES, true],
      [IGNORE_LEASH_NODES + 1, false],
    ] as const) {
      const s = sim();
      const soldier = unit(s, 0, P0, MILITARY_MODE.IGNORE);
      anchorAt(s, soldier, 0);
      const enemy = unit(s, off, P1, MILITARY_MODE.IGNORE, WOMAN);
      hold(s, soldier, enemy);
      combatSystem(s.world, ctxOf(s));
      expect(held(s, soldier)).toBe(kept ? enemy : undefined);
    }
  });
});

describe('engagement - an archer closing on a far enemy', () => {
  it('stops at the standoff (2 * max - min) / 2, inside its farthest shot', () => {
    const BOW_MAX_RANGE = 12;
    const STANDOFF = (2 * BOW_MAX_RANGE - BOW_MIN_RANGE) >> 1;
    const s = sim();
    const archer = unit(s, 0, P0, MILITARY_MODE.ATTACK, SOLDIER_BOW);
    const enemyAt = BOW_MAX_RANGE + 4;
    unit(s, enemyAt, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(s.world, ctxOf(s));
    const goal = s.world.get(archer, MoveGoal).cell;
    expect(enemyAt - (s.terrain?.xOf(goal) ?? 0)).toBe(STANDOFF);
  });
});

describe("engagement - an enemy inside an archer's dead zone", () => {
  const INSIDE = BOW_MIN_RANGE - 1;

  it('is seen under ATTACK and DEFEND, and the archer steps back out to shoot', () => {
    for (const mode of [MILITARY_MODE.ATTACK, MILITARY_MODE.DEFEND]) {
      const s = sim();
      const archer = unit(s, 10, P0, mode, SOLDIER_BOW);
      anchorAt(s, archer, 10);
      const enemy = unit(s, 10 + INSIDE, P1, MILITARY_MODE.IGNORE, WOMAN);
      combatSystem(s.world, ctxOf(s));
      expect(held(s, archer)).toBe(enemy);
      const goal = s.world.get(archer, MoveGoal).cell;
      expect(Math.abs((s.terrain?.xOf(goal) ?? 0) - (10 + INSIDE))).toBeGreaterThanOrEqual(BOW_MIN_RANGE);
    }
  });

  it('is left alone under IGNORE, which strikes only inside its reach', () => {
    const s = sim();
    const archer = unit(s, 10, P0, MILITARY_MODE.IGNORE, SOLDIER_BOW);
    unit(s, 10 + INSIDE, P1, MILITARY_MODE.IGNORE, WOMAN);
    combatSystem(s.world, ctxOf(s));
    expect(s.world.has(archer, Engagement)).toBe(false);
  });
});

describe('engagement - which enemy it picks', () => {
  it('takes an enemy fighter before a nearer civilian', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    unit(s, 4, P1, MILITARY_MODE.IGNORE, WOMAN);
    const fighter = unit(s, 10, P1, MILITARY_MODE.IGNORE);
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(fighter);
  });

  it('takes a wild animal before a nearer civilian', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    unit(s, 4, P1, MILITARY_MODE.IGNORE, WOMAN);
    const wolf = fighterAtNode(s, 10, ROW, WOLF_TRIBE, null);
    s.world.add(wolf, Anger, { until: s.tick + REPATH_CADENCE }); // provoked, so a fair target
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(wolf);
  });

  it('draws among the five nearest only, however many stand within the spread', () => {
    const at = 20;
    // Seven candidates within 3 of the nearest: two at 6, two at 7, two at 8, one at 9. By (distance, id)
    // the draw keeps the pairs at 6 and 7 and the first one at 8.
    const offsets = [-6, 6, -7, 7, -8, 8, -9];
    const FIVE_NEAREST = [0, 1, 2, 3, 4];
    const drawn = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = sim(seed);
      const soldier = unit(s, at, P0, MILITARY_MODE.ATTACK);
      const candidates = offsets.map((off) => unit(s, at + off, P1, MILITARY_MODE.IGNORE, WOMAN));
      combatSystem(s.world, ctxOf(s));
      const target = held(s, soldier);
      if (target === undefined) throw new Error('nothing picked');
      drawn.add(candidates.indexOf(target));
    }
    expect([...drawn].sort()).toEqual(FIVE_NEAREST);
  });

  it('draws among the nearest within 3 nodes of the nearest, never one farther', () => {
    const picked = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const s = sim(seed);
      const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
      const nearest = unit(s, 6, P1, MILITARY_MODE.IGNORE, WOMAN);
      const within = unit(s, 9, P1, MILITARY_MODE.IGNORE, WOMAN);
      const past = unit(s, 10, P1, MILITARY_MODE.IGNORE, WOMAN);
      combatSystem(s.world, ctxOf(s));
      const target = held(s, soldier);
      expect(target).not.toBe(past);
      picked.add(target === nearest ? 'nearest' : target === within ? 'within' : 'other');
    }
    expect([...picked].sort()).toEqual(['nearest', 'within']);
  });

  it('keeps a held enemy unless a pick is strictly nearer', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    const heldEnemy = unit(s, 10, P1, MILITARY_MODE.IGNORE, WOMAN);
    unit(s, 10, P1, MILITARY_MODE.IGNORE, WOMAN);
    hold(s, soldier, heldEnemy);
    combatSystem(s.world, ctxOf(s));
    expect(held(s, soldier)).toBe(heldEnemy); // an equally near one does not take over

    const t = sim();
    const other = unit(t, 0, P0, MILITARY_MODE.ATTACK);
    const far = unit(t, 12, P1, MILITARY_MODE.IGNORE, WOMAN);
    const near = unit(t, 4, P1, MILITARY_MODE.IGNORE, WOMAN);
    hold(t, other, far);
    // It looks again only on its chase's re-path tick, once it walks.
    for (let tick = 0; tick < REPATH_CADENCE; tick++) {
      t.step();
      expect(held(t, other)).toBe(far);
    }
    t.step();
    expect(held(t, other)).toBe(near);
  });

  it('does not look again while it stands and strikes', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    const struck = unit(s, 2, P1, MILITARY_MODE.IGNORE, WOMAN);
    const nearer = unit(s, 1, P1, MILITARY_MODE.IGNORE, WOMAN);
    hold(s, soldier, struck);
    s.world.mut(soldier, Engagement).repathAt = s.tick - REPATH_CADENCE; // long past its re-path tick
    combatSystem(s.world, ctxOf(s));
    expect(s.world.get(soldier, CurrentAtomic).effect).toMatchObject({ kind: 'attack', target: struck });
    expect(held(s, soldier)).not.toBe(nearer);
  });
});

describe('engagement - a struck fighter turns on its attacker', () => {
  const blow = { damage: 10 };

  it('only under ATTACK or DEFEND, and never against its attack order', () => {
    for (const [mode, turns] of [
      [MILITARY_MODE.ATTACK, true],
      [MILITARY_MODE.DEFEND, true],
      [MILITARY_MODE.IGNORE, false],
      [MILITARY_MODE.FLEE, false],
    ] as const) {
      const s = sim();
      const soldier = unit(s, 0, P0, mode);
      const attacker = unit(s, 2, P1, MILITARY_MODE.IGNORE);
      resolveCombatHit(s.world, ctxOf(s), attacker, soldier, blow, [], 'melee');
      expect(held(s, soldier)).toBe(turns ? attacker : undefined);
    }
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    const ordered = unit(s, 12, P1, MILITARY_MODE.IGNORE, WOMAN);
    const attacker = unit(s, 2, P1, MILITARY_MODE.IGNORE);
    s.world.add(soldier, AttackOrder, { target: ordered });
    resolveCombatHit(s.world, ctxOf(s), attacker, soldier, blow, [], 'melee');
    expect(held(s, soldier)).toBeUndefined();
    expect(s.world.get(soldier, AttackOrder).target).toBe(ordered);
  });

  it('when the attacker is nearer than the enemy it holds', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    const far = unit(s, 12, P1, MILITARY_MODE.IGNORE, WOMAN);
    const attacker = unit(s, 2, P1, MILITARY_MODE.IGNORE);
    hold(s, soldier, far);
    resolveCombatHit(s.world, ctxOf(s), attacker, soldier, blow, [], 'melee');
    expect(held(s, soldier)).toBe(attacker);
  });

  it('but keeps a nearer held enemy, and a civilian does not turn at all', () => {
    const s = sim();
    const soldier = unit(s, 0, P0, MILITARY_MODE.ATTACK);
    const near = unit(s, 2, P1, MILITARY_MODE.IGNORE, WOMAN);
    const attacker = unit(s, 12, P1, MILITARY_MODE.IGNORE);
    hold(s, soldier, near);
    resolveCombatHit(s.world, ctxOf(s), attacker, soldier, blow, [], 'projectile');
    expect(held(s, soldier)).toBe(near);

    const civilian = unit(s, 20, P0, MILITARY_MODE.ATTACK, WOMAN);
    resolveCombatHit(s.world, ctxOf(s), attacker, civilian, blow, [], 'projectile');
    expect(held(s, civilian)).toBeUndefined();
  });
});

describe('engagement - a crowd on one enemy', () => {
  const RUN_TICKS = 150;

  /** `size` owned ATTACK soldiers of `job` in a column ten nodes off one tough enemy woman, run for
   *  {@link RUN_TICKS}: who swung, and how often any of them changed the enemy it holds. */
  function crowdOn(size: number, job: number): { swung: number; flips: number; holding: number } {
    const s = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(MAP_CELLS, 12) });
    const target = fighterAtNode(s, 30, 10, SAXON, WOMAN, { hitpoints: 100_000_000 });
    s.world.add(target, Owner, { player: P1 });
    s.world.add(target, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null });
    const crowd: Entity[] = [];
    for (let i = 0; i < size; i++) {
      const e = fighterAtNode(s, 20, 6 + i, VIKING, job);
      s.world.add(e, Owner, { player: P0 });
      s.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
      crowd.push(e);
    }
    const swung = new Set<Entity>();
    const last = new Map<Entity, Entity | undefined>();
    let flips = 0;
    for (let t = 0; t < RUN_TICKS; t++) {
      s.step();
      for (const e of crowd) {
        if (s.world.tryGet(e, CurrentAtomic)?.effect.kind === 'attack') swung.add(e);
        const now = held(s, e);
        if (last.has(e) && last.get(e) !== now) flips++;
        last.set(e, now);
      }
    }
    const holding = crowd.filter((e) => held(s, e) === target).length;
    return { swung: swung.size, flips, holding };
  }

  it('every attacker swings while the enemy has room around it, and none changes its target', () => {
    const CROWD = 8; // the spear's 1..2 band holds twelve nodes around one enemy
    expect(crowdOn(CROWD, SOLDIER_SPEAR)).toEqual({ swung: CROWD, flips: 0, holding: CROWD });
  });

  it('an overflow keeps its target and waits beside the front instead of letting it go', () => {
    const CROWD = 6; // the short sword's 1..1 band holds four nodes around one enemy
    const SIDES = 4;
    expect(crowdOn(CROWD, SOLDIER_SWORD_SHORT)).toEqual({ swung: SIDES, flips: 0, holding: CROWD });
  });
});

describe('engagement - two fighters closing on each other', () => {
  it('strike once in reach instead of walking through to the side they were dealt', () => {
    const MAX_TICKS = 200;
    for (const gap of [12, 14, 16]) {
      const s = sim();
      const west = unit(s, 0, P0, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
      const east = unit(s, gap, P1, MILITARY_MODE.ATTACK, SOLDIER_SWORD_SHORT);
      let swung = false;
      for (let t = 0; t < MAX_TICKS && !swung; t++) {
        s.step();
        swung = [west, east].some((e) => s.world.tryGet(e, CurrentAtomic)?.effect.kind === 'attack');
        expect(s.world.get(west, Position).x).toBeLessThan(s.world.get(east, Position).x);
      }
      expect(swung).toBe(true);
    }
  });
});
