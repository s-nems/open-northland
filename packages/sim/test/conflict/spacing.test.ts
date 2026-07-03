import { beforeEach, describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for the IDLE-SPACING (de-stack) drive: owned settlers don't HARD-collide (a walker passes freely
 * through any tile) but they won't come to REST stacked on top of one another — a unit that has arrived
 * with nothing to do and shares its tile with a lower-id resting owned unit steps off to the nearest free
 * cell. Faithful in spirit to the original's per-cell valency (docs/FIDELITY.md). Gated on Owner, so the
 * unowned golden/economy fixtures never de-stack (their planner output stays byte-identical).
 */

const GRASS = 0;
const VIKING = 1;
const WOODCUTTER = 1;
const HUMAN_PLAYER = 0;

beforeEach(() => {
  for (const c of [
    Position,
    Settler,
    Resource,
    Building,
    Stockpile,
    Carrying,
    CurrentAtomic,
    MoveGoal,
    PathFollow,
    PathRequest,
    JobAssignment,
    Age,
    Owner,
    PlayerOrder,
  ]) {
    c.store.clear();
  }
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function sim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 6) });
}

/** An idle OWNED viking woodcutter (no job binding, so with no resources nearby it has nothing to do). */
function idleWoodcutter(s: Simulation, x: number, y: number, owner: number | null = HUMAN_PLAYER): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (owner !== null) s.world.add(e, Owner, { player: owner });
  return e;
}

/** The integer tile an entity stands on. */
function tileOf(s: Simulation, e: Entity): { x: number; y: number } {
  const p = s.world.get(e, Position);
  return { x: fx.toInt(p.x), y: fx.toInt(p.y) };
}

describe('idle-spacing (de-stack) drive', () => {
  it('spreads two stacked idle owned settlers so they end on different tiles (lowest id keeps the tile)', () => {
    const s = sim();
    const keeper = idleWoodcutter(s, 4, 3); // lower id — holds the tile
    const mover = idleWoodcutter(s, 4, 3); // higher id — steps aside
    s.run(15); // one de-stack step (~8 ticks to walk the single tile) plus slack

    expect(tileOf(s, keeper)).toEqual({ x: 4, y: 3 }); // the keeper never moved
    const m = tileOf(s, mover);
    expect(m.x === 4 && m.y === 3).toBe(false); // the mover left the shared tile
    expect(Math.abs(m.x - 4) + Math.abs(m.y - 3)).toBe(1); // to an adjacent cell
  });

  it('settles to a stable, non-stacked configuration (no endless churn)', () => {
    const s = sim();
    const a = idleWoodcutter(s, 4, 3);
    const b = idleWoodcutter(s, 4, 3);
    const c = idleWoodcutter(s, 4, 3);
    s.run(40); // long enough to spread AND prove it stops moving afterwards

    const tiles = [a, b, c].map((e) => tileOf(s, e));
    const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(3); // all three on distinct tiles
    for (const e of [a, b, c]) {
      expect(s.world.has(e, MoveGoal)).toBe(false); // arrived — no lingering order
      expect(s.world.has(e, PathFollow)).toBe(false); // and not still walking (churn would show here)
    }
  });

  it('does NOT de-stack UNOWNED settlers — the Owner gate keeps neutral/golden fixtures byte-identical', () => {
    const s = sim();
    const a = idleWoodcutter(s, 4, 3, null); // no Owner
    const b = idleWoodcutter(s, 4, 3, null);
    s.run(15);

    expect(tileOf(s, a)).toEqual({ x: 4, y: 3 });
    expect(tileOf(s, b)).toEqual({ x: 4, y: 3 }); // both still stacked — no spacing applied
    expect(s.world.has(b, MoveGoal)).toBe(false);
  });

  it('never de-stacks an unowned settler sharing a tile with TWO owned units (the owner gate is real)', () => {
    // The tricky case: occupancy holds only OWNED units, so an unowned e is never its own tile's keeper —
    // without the explicit Owner guard it would slip past the `bucket[0] === e` check and wrongly move.
    const s = sim();
    const o1 = idleWoodcutter(s, 4, 3); // owned — keeper (lowest id)
    const o2 = idleWoodcutter(s, 4, 3); // owned — steps aside
    const neutral = idleWoodcutter(s, 4, 3, null); // unowned — MUST stay put
    s.run(20);

    expect(tileOf(s, neutral)).toEqual({ x: 4, y: 3 }); // the neutral never moved
    expect(s.world.has(neutral, MoveGoal)).toBe(false);
    // ...and the owned pair still spaced out around it (spacing keeps working for the owned units).
    expect(tileOf(s, o1)).toEqual({ x: 4, y: 3 });
    expect(tileOf(s, o2)).not.toEqual({ x: 4, y: 3 });
  });

  it('leaves a lone idle owned settler exactly where it stands', () => {
    const s = sim();
    const e = idleWoodcutter(s, 4, 3);
    s.run(15);
    expect(tileOf(s, e)).toEqual({ x: 4, y: 3 });
    expect(s.world.has(e, MoveGoal)).toBe(false);
  });
});
