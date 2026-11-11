import { describe, expect, it } from 'vitest';
import {
  Engagement,
  Owner,
  Position,
  Stance,
  setDiplomacyStance,
} from '../../../../../../../src/components/index.js';
import type { Entity } from '../../../../../../../src/ecs/world.js';
import { Simulation } from '../../../../../../../src/index.js';
import { holdEnemy } from '../../../../../../../src/systems/conflict/chase.js';
import { CombatIndex, holdPassIndex } from '../../../../../../../src/systems/conflict/combat-index.js';
import { dropPath } from '../../../../../../../src/systems/movement/nav-state.js';
import { MILITARY_MODE } from '../../../../../../../src/systems/readviews/index.js';
import { turnOnAttacker } from '../../../../../../../src/systems/settlers/atomics/effects/combat/hit/reactions.js';
import { hexNodeDistance } from '../../../../../../../src/systems/spatial/metric.js';
import { entityNode } from '../../../../../../../src/systems/spatial/nodes.js';
import { midColumnStep } from '../../../../../../fixtures/waypoints.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAtNode,
  grass,
  SAXON,
  SOLDIER_SPEAR,
  VIKING,
} from '../../../../../conflict/combat-cadence/support.js';

const P0 = 0;
const P1 = 1;

describe('turnOnAttacker', () => {
  it("weighs the held enemy at its live node when its route was dropped after the pass's index was built", () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(40, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const world = sim.world;
    setDiplomacyStance(world, P0, P1, 'enemy');
    setDiplomacyStance(world, P1, P0, 'enemy');
    const owned = (e: Entity, player: number): Entity => {
      world.add(e, Owner, { player });
      world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
      return e;
    };
    const fighter = owned(fighterAtNode(sim, 20, 16, VIKING, SOLDIER_SPEAR), P0);
    const striker = owned(fighterAtNode(sim, 24, 16, SAXON, SOLDIER_SPEAR), P1);
    const held = owned(fighterAtNode(sim, 20, 20, SAXON, SOLDIER_SPEAR), P1);
    const between = midColumnStep(world, terrain, held, 20, 20);
    const ctx = ctxOf(sim);
    holdEnemy(world, ctx, fighter, held);
    holdPassIndex(world, new CombatIndex(world, ctx, terrain));
    const here = entityNode(world, terrain, fighter);
    const strikeReach = hexNodeDistance(terrain, here, entityNode(world, terrain, striker));
    expect(hexNodeDistance(terrain, here, entityNode(world, terrain, held))).toBe(strikeReach);

    // A pass that drops the route leaves the enemy on the node it passes through, one step farther off.
    dropPath(world, held);
    expect(world.get(held, Position)).toEqual(between);
    expect(hexNodeDistance(terrain, here, entityNode(world, terrain, held))).toBeGreaterThan(strikeReach);
    turnOnAttacker(world, ctx, striker, fighter);

    expect(world.get(fighter, Engagement).target).toBe(striker);
  });
});
