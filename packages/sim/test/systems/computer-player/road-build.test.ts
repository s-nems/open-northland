import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerColony, Settler } from '../../../src/components/index.js';
import type { PlayerCommand } from '../../../src/core/commands/index.js';
import type { Simulation } from '../../../src/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-shared/cadence.js';
import { SpareForce } from '../../../src/systems/ai-shared/workforce/pool.js';
import { roadBuildPlan } from '../../../src/systems/computer-player/road-build.js';
import { allocateRoadCrew } from '../../../src/systems/computer-player/workforce/road-crew.js';
import { ownedRoadSites } from '../../../src/systems/roads/site-index.js';
import { blankColony, colonyWorld } from '../../fixtures/colony-islands.js';
import { ctxOf } from '../../fixtures/context.js';
import { BUILDER, HOME_TYPE, SEAT, STOCK_TYPE, VIKING } from './support.js';

/** The colony's store and a home well apart on the east island, so a road runs between them. */
const COLONY_STORE = { x: 160, y: 64 };
const COLONY_HOME = { x: 160, y: 96 };
/** Decisions enough for every building's turn to come round. */
const DECISIONS = 8;
/** A builder on the home island, beside its headquarters. */
const HOME_BUILDER_AT = { x: 60, y: 70 };

/** A seat grown past the road threshold at home, with a colony of a built store and a built home. */
function seatWithColony(): { sim: Simulation; land: number } {
  const sim = colonyWorld();
  const built = { tribe: VIKING, owner: SEAT, force: true, underConstruction: false };
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: STOCK_TYPE, ...COLONY_STORE, ...built });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, ...COLONY_HOME, ...built });
  sim.step();
  const terrain = sim.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or AI seat');
  const land = terrain.componentOf(terrain.nodeAt(COLONY_STORE.x, COLONY_STORE.y));
  sim.world.add(carrier, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
  return { sim, land };
}

function roadSitesOn(sim: Simulation, land: number, commands: readonly PlayerCommand[]): number {
  const terrain = sim.terrain;
  if (terrain === undefined) return 0;
  return commands.filter(
    (c) => c.kind === 'placeRoadSite' && terrain.componentOf(terrain.nodeAt(c.x, c.y)) === land,
  ).length;
}

describe('roads on a colony', () => {
  it('link its buildings to its store once home lays roads', () => {
    const { sim, land } = seatWithColony();
    let placed = 0;
    for (let k = 0; k < DECISIONS; k++) {
      const ctx = { ...ctxOf(sim), tick: k * COMPUTER_DECISION_INTERVAL_TICKS };
      placed += roadSitesOn(sim, land, roadBuildPlan(sim.world, ctx, SEAT).commands);
    }
    expect(placed).toBeGreaterThan(0);
  });

  it('are no work for home’s road crew, who would sail for them', () => {
    const { sim, land } = seatWithColony();
    const ctx = ctxOf(sim);
    for (const command of roadBuildPlan(sim.world, { ...ctx, tick: 0 }, SEAT).commands)
      sim.enqueueSetup(command);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: BUILDER,
      ...HOME_BUILDER_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain');
    const colonySites = [...ownedRoadSites(sim.world, terrain, SEAT).values()].filter(
      (site) => terrain.componentOf(site.node) === land,
    );
    expect(colonySites.length).toBeGreaterThan(0);
    const builders = [...sim.world.query(Settler)].filter(
      (e) => sim.world.get(e, Settler).jobType === BUILDER,
    );
    expect(builders.length).toBe(1);
    const crew = allocateRoadCrew(sim.world, ctxOf(sim), SEAT, [], new SpareForce(builders), BUILDER);
    expect(crew.commands.filter((c) => c.kind === 'assignBuilder')).toEqual([]);
  });
});
