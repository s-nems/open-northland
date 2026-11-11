import { describe, expect, it } from 'vitest';
import { Building, RallyPoint } from '../../../../src/components/index.js';
import { CommandQueue } from '../../../../src/core/command-queue.js';
import { PersonalNames } from '../../../../src/core/personal-names.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation } from '../../../../src/index.js';
import { homeBuildings } from '../../../../src/systems/ai-shared/home-roster.js';
import { rallyOrders } from '../../../../src/systems/computer-player/military/rally-stand.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { BARRACKS_TYPE, HOME_TYPE, HQ_TYPE, SEAT, VIKING } from '../support.js';

/** Where a computer seat keeps its barracks' rally flag while no tower of its own is manned. */

const RIVAL = 3;
const BASE = { x: 20, y: 40 };
const BARRACKS = { x: 30, y: 40 };
/** The seat's building nearest the rival: the settlement's edge on that side. */
const EDGE_HOME = { x: 50, y: 40 };
const RIVAL_BASE = { x: 110, y: 40 };

function setup(): { sim: Simulation; ctx: SystemContext; barracks: Entity } {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: RIVAL, tribes: [VIKING] });
  const place = (buildingType: number, at: { x: number; y: number }, owner: number): Entity => {
    const before = new Set(sim.world.query(Building));
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType, ...at, tribe: VIKING, owner, force: true });
    sim.step();
    const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
    if (placed === undefined) throw new Error(`setup: building ${buildingType} was refused`);
    return placed;
  };
  place(HQ_TYPE, BASE, SEAT);
  const barracks = place(BARRACKS_TYPE, BARRACKS, SEAT);
  place(HOME_TYPE, EDGE_HOME, SEAT);
  place(HQ_TYPE, RIVAL_BASE, RIVAL);
  const ctx: SystemContext = {
    content: aiContent(),
    rng: new Rng(1),
    names: new PersonalNames(1, []),
    tick: 0,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    terrain,
  };
  return { sim, ctx, barracks };
}

describe('rallyOrders', () => {
  it("plants the flag past the settlement's edge toward the rival, then leaves the standing flag alone", () => {
    const { sim, ctx, barracks } = setup();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const orders = rallyOrders(sim.world, ctx, terrain, SEAT, homeBuildings(sim.world, ctx, SEAT));
    expect(orders).toHaveLength(1);
    const order = orders[0];
    if (order?.kind !== 'setRallyPoint') throw new Error('expected a rally order');
    expect(order.building).toBe(barracks);
    expect(order.x).toBeGreaterThan(EDGE_HOME.x);
    expect(order.x).toBeLessThan(RIVAL_BASE.x);

    sim.enqueueSetup(order);
    sim.step();
    expect(sim.world.has(barracks, RallyPoint)).toBe(true);
    expect(rallyOrders(sim.world, ctx, terrain, SEAT, homeBuildings(sim.world, ctx, SEAT))).toHaveLength(0);
  });
});
