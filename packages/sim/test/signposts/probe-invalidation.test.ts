import { describe, expect, it } from 'vitest';
import { Owner, Position, Settler, WorkFlag } from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { setWorkFlag } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';
import { HUT, mappedSim, VIKING } from '../footprint/building-placement/support.js';

/**
 * The signpost placement probe (`Simulation.signpostProbe`) is memoized on `workFlagBlockerVersion`,
 * and a work flag is the one blocker that MOVES (an in-place Position write `componentGeneration`
 * cannot see). These tests pin the version's flag-move counter: after a relocation — with no
 * intervening add/remove of any blocker — the probe must report the flag's new cell blocked and its
 * old cell free.
 */

const WOODCUTTER = 1;
const P0 = 0;

function ownedGatherer(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
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

const flagCmd = (entity: Entity, x: number, y: number): Extract<Command, { kind: 'setWorkFlag' }> => ({
  kind: 'setWorkFlag',
  entity,
  x,
  y,
});

/** The half-cell node the entity's Position occupies. */
function nodeXY(sim: Simulation, e: Entity): { x: number; y: number } {
  const p = sim.world.get(e, Position);
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  return { x: hx, y: hy };
}

function probeOf(sim: Simulation) {
  const probe = sim.signpostProbe(P0);
  if (probe === null) throw new Error('fixture map missing');
  return probe;
}

describe('signpostProbe invalidation on a work-flag move', () => {
  it('reports the new cell blocked and the old cell free after a setWorkFlag relocate', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 2) });
    const g = ownedGatherer(sim, 0, 0);
    const OLD = { x: 10, y: 0 };
    const NEW = { x: 22, y: 0 };
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, OLD.x, OLD.y));
    expect(probeOf(sim).canPlace(OLD.x, OLD.y)).toBe(false);
    expect(probeOf(sim).canPlace(NEW.x, NEW.y)).toBe(true);

    // The relocate branch: same flag entity, in-place Position write, no add/remove of anything.
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, NEW.x, NEW.y));

    expect(probeOf(sim).canPlace(NEW.x, NEW.y)).toBe(false); // the flag now stands here
    expect(probeOf(sim).canPlace(OLD.x, OLD.y)).toBe(true); // …and no longer here
  });

  it('reports the pushed-out flag at its new cell after a placeBuilding eviction', () => {
    // End-to-end only: the placeBuilding itself bumps placementBlockerVersion, so this cannot isolate
    // the flag-move counter — the relocate test above is the counter's regression pin.
    const sim = mappedSim();
    const g = ownedGatherer(sim, 12, 12);
    const ANCHOR = { x: 5, y: 5 };
    setWorkFlag(sim.world, ctxOf(sim), flagCmd(g, ANCHOR.x, ANCHOR.y));
    const flag = sim.world.get(g, WorkFlag).flag;
    const before = nodeXY(sim, flag);

    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();

    const after = nodeXY(sim, flag);
    expect(after).not.toEqual(before); // the eviction really moved the marker
    expect(probeOf(sim).canPlace(after.x, after.y)).toBe(false); // probe sees its new cell
  });
});
