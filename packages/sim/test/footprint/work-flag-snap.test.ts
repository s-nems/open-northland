import { describe, expect, it } from 'vitest';
import { Owner, Position, Settler, WorkFlag } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { nodeOfPosition, type Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { canPlaceWorkFlag, workFlagPlacementBlocks } from '../../src/systems/index.js';
import { ctxOf } from '../fixtures/context.js';
import { HUT, mappedSim, terrainOf, VIKING, WOODCUTTER } from './building-placement/support.js';

/**
 * The player's `setWorkFlag` SNAPS onto the nearest legal node instead of silently dropping a click that
 * landed on a body. A gatherer's flag belongs at the patch it should work, but a resource cluster (or a
 * building) blocks its own cells, so "work this iron mine" lands on the ore itself: dropping that command
 * left the collector standing at its previous flag with no feedback, and any construction site needing
 * that good stalled forever. Auto-created flags and the AI's flag planting already snapped; this pins the
 * player order onto the same rule.
 */

const P0 = 0;

function ownedGatherer(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(hx), y: fx.fromInt(hy) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: P0 });
  return e;
}

/** The node the gatherer's flag marker currently stands on. */
function flagNodeOf(sim: Simulation, gatherer: Entity): NodeId {
  const binding = sim.world.get(gatherer, WorkFlag);
  const p = sim.world.get(binding.flag, Position);
  const n = nodeOfPosition(p.x, p.y);
  return terrainOf(sim).nodeAt(n.hx, n.hy);
}

describe('setWorkFlag snapping', () => {
  it('snaps a click that landed on a blocked body to a legal node nearby', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const gatherer = ownedGatherer(sim, 2, 2);
    // The player first plants the flag far from the body, so a dropped command is visible as "unmoved".
    sim.enqueue({ kind: 'setWorkFlag', entity: gatherer, x: 2, y: 2 });
    sim.step();
    const before = flagNodeOf(sim, gatherer);

    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: 10, y: 10, tribe: VIKING, owner: P0 });
    sim.step();
    const onTheBody = terrain.nodeAt(10, 10);
    expect(workFlagPlacementBlocks(sim.world, sim.content, terrain).has(onTheBody)).toBe(true);

    sim.enqueue({ kind: 'setWorkFlag', entity: gatherer, x: 10, y: 10 });
    sim.step();

    const after = flagNodeOf(sim, gatherer);
    expect(after).not.toBe(before); // the order was obeyed, not silently dropped
    expect(after).not.toBe(onTheBody); // …but never onto the blocked cell itself
    // Legal ignoring the flag's own marker, which now stands there and reserves its spacing.
    const flag = sim.world.get(gatherer, WorkFlag).flag;
    expect(canPlaceWorkFlag(sim.world, ctxOf(sim), terrain, after, flag)).toBe(true);
    // Snapped off the body, not relocated across the map.
    const at = terrain.coordsOf(after);
    expect(Math.abs(at.x - 10) + Math.abs(at.y - 10)).toBeLessThanOrEqual(6);
  });

  it('leaves an unblocked click exactly where the player put it', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const gatherer = ownedGatherer(sim, 2, 2);

    sim.enqueue({ kind: 'setWorkFlag', entity: gatherer, x: 9, y: 5 });
    sim.step();

    expect(flagNodeOf(sim, gatherer)).toBe(terrain.nodeAt(9, 5));
  });
});
