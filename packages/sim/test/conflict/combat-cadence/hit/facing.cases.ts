import { describe, expect, it } from 'vitest';
import { Health, WALK_DIRECTION, type WalkDirection, WalkFacing } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { combatSystem } from '../../../../src/systems/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  IRON_SPEAR_DAMAGE,
  SAXON,
  SOLDIER_SPEAR,
  VIKING,
} from '../support.js';

const POOL = 1_000_000;

function faceAway(sim: Simulation, e: Entity, direction: WalkDirection): void {
  sim.world.add(e, WalkFacing, { direction, target: direction });
}

/** Two spearmen a cell apart on one row, each looking away from the other. */
function backToBack(): { sim: Simulation; west: Entity; east: Entity } {
  const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
  const west = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR, { hitpoints: POOL });
  const east = fighterAt(sim, 1, 0, SAXON, SOLDIER_SPEAR, { hitpoints: POOL });
  faceAway(sim, west, WALK_DIRECTION.W);
  faceAway(sim, east, WALK_DIRECTION.E);
  return { sim, west, east };
}

describe('combatSystem - a swing turns the striker to its victim', () => {
  it('a person in reach looking away turns to face its target at once', () => {
    const { sim, west, east } = backToBack();
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(west, WalkFacing)).toEqual({
      direction: WALK_DIRECTION.E,
      target: WALK_DIRECTION.E,
    });
    expect(sim.world.get(east, WalkFacing)).toEqual({
      direction: WALK_DIRECTION.W,
      target: WALK_DIRECTION.W,
    });
  });

  it('two fighters trading blows face to face each take the plain column', () => {
    const { sim, west, east } = backToBack();
    const firstBlow = new Map<Entity, number>();
    const last = new Map<Entity, number>([
      [west, POOL],
      [east, POOL],
    ]);
    for (let tick = 0; tick < 60 && firstBlow.size < 2; tick++) {
      sim.step();
      for (const e of [west, east]) {
        const hp = sim.world.get(e, Health).hitpoints;
        const before = last.get(e) ?? POOL;
        if (hp < before && !firstBlow.has(e)) firstBlow.set(e, before - hp);
        last.set(e, hp);
      }
    }
    // Turned back to back they would take x1.5 from behind; facing each other it is x1.
    expect(firstBlow.get(west)).toBe(IRON_SPEAR_DAMAGE['0']);
    expect(firstBlow.get(east)).toBe(IRON_SPEAR_DAMAGE['0']);
  });
});
