import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Engagement,
  MoveGoal,
  Position,
  Resource,
  Stance,
} from '../../../src/components/index.js';
import { fx } from '../../../src/core/fixed.js';
import { Simulation } from '../../../src/index.js';
import { combatSystem, DEFEND_LEASH_NODES, DEFEND_RADIUS_NODES } from '../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  cell,
  combatant,
  combatantAtNode,
  ctxOf,
  grassMap,
  HARVEST_ATOMIC,
  P0,
  P1,
  tileOf,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('DEFEND — hold an anchor, don’t chase past the leash', () => {
  it('ignores an enemy OUTSIDE the defend radius (holds its post)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    sim.world.get(guard, Stance).anchorCell = cell(sim, 10, 0);
    // 1 node outside the radius: the anchor is node (20, 0), the enemy DEFEND_RADIUS_NODES+1 nodes east.
    combatantAtNode(sim, 20 + DEFEND_RADIUS_NODES + 1, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, CurrentAtomic)).toBe(false); // did not engage
    expect(sim.world.has(guard, Engagement)).toBe(false);
    expect(sim.world.has(guard, MoveGoal)).toBe(false); // stayed on its anchor
  });

  it('engages an enemy INSIDE the radius, and its chase never leaves the leash of the anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND);
    const anchor = cell(sim, 10, 0);
    sim.world.get(guard, Stance).anchorCell = anchor;
    // An enemy 6 nodes out: inside the radius (8), beyond reach (2) → chase, but leashed.
    const enemy = combatant(sim, 13, 0, P1, MILITARY_MODE.IGNORE);

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(guard, Engagement)).toBe(true); // engaged the in-radius enemy
    const goal = sim.world.get(guard, MoveGoal).cell;
    const g = sim.terrain?.coordsOf(goal);
    const a = sim.terrain?.coordsOf(anchor);
    const distToAnchor = Math.abs((g?.x ?? 0) - (a?.x ?? 0)) + Math.abs((g?.y ?? 0) - (a?.y ?? 0));
    expect(distToAnchor).toBeLessThanOrEqual(DEFEND_LEASH_NODES); // the chase stayed within the leash
    expect(enemy).toBeDefined();
  });

  it('over a run past a nearby enemy, the defender stays within the leash of its anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const guard = combatant(sim, 10, 0, P0, MILITARY_MODE.DEFEND, { hitpoints: 100000 });
    const anchorX = 10;
    sim.world.get(guard, Stance).anchorCell = cell(sim, anchorX, 0);
    // A tough enemy that marches in (ATTACK) — it reaches the defend radius during the run, so the guard
    // engages and chases; both are far too tough to die, so the fight lasts the whole run.
    combatant(sim, 16, 0, P1, MILITARY_MODE.ATTACK, { hitpoints: 100000 });

    sim.run(120);
    const gx = tileOf(sim, guard).x;
    // The leash is a NODE Manhattan bound; a same-row cell offset is 2 nodes, so double the cell delta.
    expect(Math.abs(gx - anchorX) * 2).toBeLessThanOrEqual(DEFEND_LEASH_NODES);
  });

  it('holds its post against the economy — a militia-job guard does not wander off to work', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 1) });
    // A DEFEND unit on a CIVILIAN job (woodcutter) — without the economy-skip it would walk off to harvest.
    const guard = combatant(sim, 5, 0, P0, MILITARY_MODE.DEFEND, { jobType: WOODCUTTER });
    // A wood node it could harvest, off to the side.
    const wood = sim.world.create();
    sim.world.add(wood, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(wood, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });

    sim.run(30);
    expect(tileOf(sim, guard)).toEqual({ x: 5, y: 0 }); // stayed on its post, never walked to the wood
  });
});
