import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { Position } from '../../sim/src/components/index.js';
import type { Entity } from '../../sim/src/ecs/world.js';
import { nodeOfPosition, type Simulation, SnapshotMirror } from '../../sim/src/index.js';
import { createSignpost } from '../../sim/src/systems/index.js';
import { HUT, mappedSim, terrainOf, VIKING } from '../../sim/test/footprint/building-placement/support.js';
import { networkInventoryOf } from '../src/data/hud/inventory.js';
import { signpostOverlayIndex } from '../src/data/signposts.js';

/** A hut anchor with an own post one node east, under its walls, and a linked post outside them. */
const ANCHOR = { x: 10, y: 10 };
const COVERED = { x: 11, y: 10 };
const NEIGHBOUR = { x: 28, y: 10 };
const COVERED_NODE = { hx: COVERED.x, hy: COVERED.y };
const P0 = 0;

/** The sim fixtures come from its source and render reads the package's declarations: the same runtime
 *  objects under two copies of one type. */
function rendered(snapshot: object): WorldSnapshot {
  return snapshot as unknown as WorldSnapshot;
}

function post(sim: Simulation, at: { x: number; y: number }): Entity {
  const terrain = terrainOf(sim);
  return createSignpost(sim.world, terrain, terrain.nodeAt(at.x, at.y), P0);
}

describe('signpost relocation through the delta stream', () => {
  it('moves the pushed post in the overlay index and keeps every index equal to a fresh walk', () => {
    const sim = mappedSim();
    const covered = post(sim, COVERED);
    const neighbour = post(sim, NEIGHBOUR);
    const deltas = sim.snapshotDeltas();
    const mirror = new SnapshotMirror();
    const carry = (): void => {
      const delta = deltas.next();
      if (delta !== null) mirror.apply(structuredClone(delta));
    };
    carry();
    expect(signpostOverlayIndex(rendered(mirror.snapshot())).posts.get(covered)).toMatchObject(COVERED_NODE);
    networkInventoryOf(rendered(mirror.snapshot()), neighbour);

    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      x: ANCHOR.x,
      y: ANCHOR.y,
      tribe: VIKING,
      owner: P0,
    });
    sim.step();
    carry();

    const p = sim.world.get(covered, Position);
    const moved = nodeOfPosition(p.x, p.y);
    expect(moved).not.toEqual(COVERED_NODE);
    expect(signpostOverlayIndex(rendered(mirror.snapshot())).posts.get(covered)).toMatchObject(moved);
    expect(mirror.verifyIndexes()).toEqual([]);
  });
});
