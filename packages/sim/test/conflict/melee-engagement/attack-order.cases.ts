import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  CurrentAtomic,
  Engagement,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import type { TerrainMap } from '../../../src/nav/terrain/index.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../../src/systems/index.js';
import { attackUnit } from '../../../src/systems/orders/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

describe('attackUnit — the explicit attack order', () => {
  it('stamps an AttackOrder + Engagement and chases the target REGARDLESS of sight radius', () => {
    const far = SIGHT_RADIUS_NODES / 2 + 3; // cells — node distance SIGHT+6, beyond auto-engage sight
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(far + 2, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, far, 0, VIKING, WOODCUTTER, { owner: P1 }); // beyond auto-engage sight

    sim.enqueue({ kind: 'attackUnit', entity: a, target: enemy });
    sim.step();

    expect(sim.world.get(a, AttackOrder).target).toBe(enemy);
    expect(sim.world.has(a, Engagement)).toBe(true);
    // It is advancing on the far target (auto-engagement would have ignored an out-of-sight enemy).
    const travelling =
      sim.world.has(a, MoveGoal) || sim.world.has(a, PathRequest) || sim.world.has(a, PathFollow);
    expect(travelling).toBe(true);
  });

  it('drops the order and disengages once the target dies', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0, hitpoints: 1_000_000 });
    const enemy = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1, hitpoints: 80 }); // frail, adjacent

    sim.enqueue({ kind: 'attackUnit', entity: a, target: enemy });
    for (let i = 0; i < 60 && sim.world.isAlive(enemy); i++) sim.step();

    expect(sim.world.isAlive(enemy)).toBe(false); // felled under the focused attack
    expect(sim.world.has(a, AttackOrder)).toBe(false); // order dropped — no target left
    expect(sim.world.has(a, Engagement)).toBe(false); // and disengaged (no other enemy in sight)
  });

  it('skips a neutral (unowned) issuer, a non-combatant issuer, a self-target, and a dead target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const neutral = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // no owner
    const owned = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 2, 0, VIKING, WOODCUTTER, { owner: P1 });
    // A plain settler with NO Health (a non-combatant) that owns nothing to fight with.
    const civilian = sim.world.create();
    sim.world.add(civilian, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(civilian, Settler, {
      tribe: VIKING,
      jobType: WOODCUTTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(civilian, Owner, { player: P0 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: neutral, target: enemy });
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: civilian, target: enemy });
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: owned, target: owned }); // self
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: owned, target: 999 as Entity }); // dead id

    expect(sim.world.has(neutral, AttackOrder)).toBe(false);
    expect(sim.world.has(civilian, AttackOrder)).toBe(false);
    expect(sim.world.has(owned, AttackOrder)).toBe(false);
  });

  it('gives up (disengages, drops the order) when the target cannot be approached into range', () => {
    // A 3×3-cell map hand-authored at HALF-CELL resolution whose ONLY walkable node is (3, 2) — the
    // anchor node of cell (1,1); every other node is water. (A cell-resolution map cannot express this:
    // upsampling stamps a walkable 2×2 block, which always leaves an adjacent approach node.) An attacker
    // stacked on its ordered target (distance 0, below melee minRange 1) can never step into the weapon
    // band — approachCell finds no walkable band node. The chase must give up, not loop engaged-forever.
    const boxedWidth = 6;
    const boxedTypeIds = new Array<number>(6 * boxedWidth).fill(1); // water everywhere...
    boxedTypeIds[2 * boxedWidth + 3] = 0; // ...except grass on node (3, 2)
    const boxed: TerrainMap = {
      resolution: 'half-cell',
      width: boxedWidth,
      height: 6,
      typeIds: boxedTypeIds,
    };
    const sim = new Simulation({ seed: 1, content: testContent(), map: boxed });
    const a = fighterAt(sim, 1, 1, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 1, 1, VIKING, WOODCUTTER, { owner: P1 }); // same node (3, 2) — dist 0

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target: enemy });
    expect(sim.world.has(a, AttackOrder)).toBe(true); // the order was accepted

    combatSystem(sim.world, ctxOf(sim));

    // Unreachable target → disengaged, order dropped, no lingering chase (no frozen engaged unit).
    expect(sim.world.has(a, AttackOrder)).toBe(false);
    expect(sim.world.has(a, Engagement)).toBe(false);
    expect(sim.world.has(a, MoveGoal)).toBe(false);
    expect(sim.world.has(a, CurrentAtomic)).toBe(false);
  });

  it('is a no-op on a mapless sim (no cells to fight over)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() }); // no map
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const enemy = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });

    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: a, target: enemy });

    expect(sim.world.has(a, AttackOrder)).toBe(false);
  });
});
