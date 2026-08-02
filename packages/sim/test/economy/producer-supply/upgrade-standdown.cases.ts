import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Position,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, nodeOfPosition, Simulation } from '../../../src/index.js';
import { constructionWorkCells, dynamicBlockOverlay } from '../../../src/systems/footprint/index.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PLANK,
  pileAt,
  SAWMILL,
  settlerAt,
  WOOD,
} from './support.js';

/**
 * Workers of an UPGRADING building stop working it (user requirement 2026-07-18: "pracownik budynku który
 * jest ulepszany powinien przestać pracować"). Source basis: readable original - `jobtypes.ini` gives
 * every bound trade we model `mustHaveFinishedWorkHouseFlag 1` (its 0 rows - hunter/scout/jester - never
 * bind a workplace), so a trade needs its finished workhouse. The upgrade turns the
 * building back into a construction site whose emptied stockpile is the construction hold, so an
 * ungated crew would read the stashed stock as starvation and shuttle goods, or strip the site's
 * delivered materials as "output".
 *
 * What the crew does INSTEAD is `planSiteStaff`: a craftsman waits it out at the site, a carrier hauls the
 * upgrade's own bill. Neither is its trade's work, which is what these cases pin.
 */

/** Re-open `b` as an upgrade site exactly like the `upgradeBuilding` command: built drops to 0, the
 *  construction + upgrade markers ride beside the Building, the live stockpile is the (empty) hold. */
function startUpgrade(sim: Simulation, b: Entity): void {
  sim.world.get(b, Building).built = fx.fromInt(0);
  sim.world.add(b, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(b, Upgrading, { savedStock: new Map(), seeded: new Map() });
}

/** Assert `settler` is waiting out `site`'s build: standing on one of its work cells, or walking to one. */
function expectWaitingAtSite(sim: Simulation, settler: Entity, site: Entity): void {
  const terrain = sim.terrain;
  if (terrain === null || terrain === undefined) throw new Error('fixture has no terrain');
  const ctx = ctxOf(sim);
  const cells = constructionWorkCells(
    sim.world,
    ctx,
    terrain,
    site,
    dynamicBlockOverlay(sim.world, ctx, terrain),
  );
  const goal = sim.world.tryGet(settler, MoveGoal)?.cell;
  const pos = sim.world.get(settler, Position);
  const node = nodeOfPosition(pos.x, pos.y);
  expect(cells).toContain(goal ?? terrain.nodeAtClamped(node.hx, node.hy));
}

describe('an upgrading workplace - its crew stands down', () => {
  it('the bound producer neither fetches inputs nor takes a seat while the upgrade runs', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // empty input slots - reads as "starved"
    startUpgrade(sim, mill);
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // wood is available next door…
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // …but the workhouse is a site: no fetch walk to the store, no pickup - the smith waits it out ON the
    // site's own work perimeter.
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expectWaitingAtSite(sim, smith, mill);
  });

  it('a load lifted before the upgrade goes to a store, never into the sealed workshop', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 5, 0); // the bound workshop, far
    startUpgrade(sim, mill);
    buildingAt(sim, HEADQUARTERS, 1, 0); // an open store, near
    const smith = settlerAt(sim, 2, 0, CARPENTER, mill);
    sim.world.add(smith, Carrying, { goodType: WOOD, amount: 1 }); // fetched just before the upgrade

    plannerSystem(sim.world, ctxOf(sim));

    // Delivery case 1 (the bound workshop) is gated off - the wood routes to the HQ instead.
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 1, 0));
  });

  it('a porter bound to an upgrading warehouse stops ferrying piles into it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const hq = buildingAt(sim, HEADQUARTERS, 0, 0);
    startUpgrade(sim, hq);
    pileAt(sim, 3, 0, [[WOOD, 2]]); // a loose pile it would normally ferry in
    const porter = settlerAt(sim, 1, 0, CARRIER, hq);

    plannerSystem(sim.world, ctxOf(sim));

    // The porter rung is off (its store is a site, and the fixture's headquarters has no upgrade bill to
    // fetch either), so nothing is lifted: it waits at the site with the rest of the crew.
    expect(sim.world.has(porter, CurrentAtomic)).toBe(false);
    expectWaitingAtSite(sim, porter, hq);
  });

  it('a store carrier never strips an upgrade site whose delivered stock looks like recipe output', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 2]]); // stocked with its own "output" good
    startUpgrade(sim, mill);
    buildingAt(sim, HEADQUARTERS, 0, 0); // the store the haul would deliver to
    const hauler = settlerAt(sim, 1, 0, CARRIER, buildingAt(sim, HEADQUARTERS, 5, 0));

    plannerSystem(sim.world, ctxOf(sim));

    // The site's stock is construction material, not output - nothing qualifies, the carrier idles.
    expect(sim.world.has(hauler, MoveGoal)).toBe(false);
    expect(sim.world.has(hauler, CurrentAtomic)).toBe(false);
  });

  it('another workshop’s producer sources its input from a store, never from the upgrade site', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const mill = buildingAt(sim, SAWMILL, 0, 0); // a WORKING mill, needs wood
    const site = buildingAt(sim, SAWMILL, 2, 0, [[WOOD, 2]]); // the NEAR source is an upgrade site
    startUpgrade(sim, site);
    buildingAt(sim, HEADQUARTERS, 6, 0, [[WOOD, 3]]); // the legitimate source, farther away
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // The fetch walks past the site's delivered wood to the warehouse.
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 6, 0));
  });
});
