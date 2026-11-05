import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  GroundPlan,
  type GroundPlanState,
  type GroundPlot,
  StalledPlacements,
} from '../../../../src/components/index.js';
import type { DeepReadonly } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import type { TerrainGraph } from '../../../../src/nav/terrain/index.js';
import {
  PLANNED_HOMES_FLOOR,
  plannedHomes,
} from '../../../../src/systems/computer-player/build-order/ground-plan.js';
import { plottedNodes, seatHomesCap } from '../../../../src/systems/computer-player/build-order/plots.js';
import { NO_ROOM_HOMES } from '../../../../src/systems/computer-player/build-order/seat-order.js';
import { type BuildOrderEntry, buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import { clearingAim } from '../../../../src/systems/computer-player/workforce/collectors/index.js';
import { razeBuilding } from '../../../../src/systems/lifecycle/cleanup.js';
import { resourcesAtNode } from '../../../../src/systems/spatial/resources.js';
import {
  BARRACKS_AND_HOME_END,
  BARRACKS_ZONE,
  content,
  contextOf,
  decide,
  HQ,
  island,
  islandMap,
  LONG_END,
  MILL_ZONE,
  STRIP,
  settle,
} from '../../../fixtures/island-strip.js';
import {
  BARRACKS_TYPE,
  entityOfBuilding,
  oneLine,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TYPE,
  VIKING,
} from '../support.js';

function planOf(sim: Simulation): DeepReadonly<GroundPlanState> {
  const carrier = aiControlEntity(sim.world, SEAT);
  const plan = carrier === null ? undefined : sim.world.tryGet(carrier, GroundPlan);
  if (plan === undefined) throw new Error('expected a ground plan');
  return plan;
}

const HELD = { kind: 'tick', tick: Number.MAX_SAFE_INTEGER } as const;
const HOMES: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 2 };
const BARRACKS: BuildOrderEntry = { kind: 'place', building: 'barracks', count: 1 };
const HELD_BARRACKS: BuildOrderEntry = { ...BARRACKS, holdUntil: HELD };
const HELD_MILL: BuildOrderEntry = {
  kind: 'place',
  building: 'work_mill_00',
  count: 1,
  holdUntil: HELD,
};
/** A step whose zone a home-sized gap takes: it needs no plot. */
const HELD_WELL: BuildOrderEntry = { ...HELD_MILL, building: 'work_well_00' };

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: a map');
  return sim.terrain;
}

/** A plot's anchor, by building. */
function plotAt(sim: Simulation, building: string): GroundPlot {
  const plot = planOf(sim).plots.find((held) => held.building === building);
  if (plot === undefined) throw new Error(`expected a plot of ${building}`);
  return { ...plot };
}

/** One decision past the plan's review. */
function reviewed(sim: Simulation, steps: readonly BuildOrderEntry[]): void {
  const context = { ...contextOf(sim), tick: planOf(sim).reviewTick };
  buildOrderModule(oneLine(steps)).run(sim.world, context, SEAT);
}

function placesBarracks(sim: Simulation, steps: readonly BuildOrderEntry[]): boolean {
  return decide(sim, steps).some((c) => c.kind === 'placeBuilding' && c.buildingType === BARRACKS_TYPE);
}

describe('ground plan', () => {
  it('plots the steps too big for a home-sized gap, biggest first and apart, and no seat with room', () => {
    const sim = island(LONG_END);
    decide(sim, [HOMES, HELD_MILL, HELD_WELL, HELD_BARRACKS]);
    expect(planOf(sim).plots.map((plot) => plot.building)).toEqual(['barracks', 'work_mill_00']);
    expect(plottedNodes(sim.world, contextOf(sim), terrainOf(sim), SEAT)?.size).toBe(
      BARRACKS_ZONE.length + MILL_ZONE.length,
    );

    const roomy = island(LONG_END, []);
    decide(roomy, [HOMES, HELD_BARRACKS]);
    const carrier = aiControlEntity(roomy.world, SEAT);
    expect(carrier !== null && roomy.world.has(carrier, GroundPlan)).toBe(false);
  });

  it('keeps homes off the plot, and lets the plotted building stand and release it', () => {
    const order = [HOMES, HELD_BARRACKS];
    const sim = island(BARRACKS_AND_HOME_END);
    settle(sim, order);
    // The second home has no room and passes: the line still reaches the barracks.
    expect(placesBarracks(sim, [HOMES, BARRACKS])).toBe(true);
    settle(sim, [HOMES, BARRACKS]);
    expect(planOf(sim).plots).toEqual([]);

    const unplanned = island(BARRACKS_AND_HOME_END, []);
    settle(unplanned, order);
    expect(placesBarracks(unplanned, [HOMES, BARRACKS])).toBe(false);
  });

  it('moves a plot something came to block, and drops it where no ground is left', () => {
    const sim = island(LONG_END);
    decide(sim, [HELD_BARRACKS]);
    const before = plotAt(sim, 'barracks');
    const blockAt = { x: before.hx, y: before.hy };
    placeResources(sim, [{ ...RESOURCE_SPOTS.wood, ...blockAt }]);
    sim.step();
    decide(sim, [HELD_BARRACKS]);
    expect(plotAt(sim, 'barracks').hx).not.toBe(before.hx);

    const crowded = island(BARRACKS_AND_HOME_END);
    decide(crowded, [HELD_BARRACKS]);
    // Every barracks zone the strip holds covers this node.
    const STRIP_MIDDLE = { x: 26, y: HQ.y };
    crowded.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      ...STRIP_MIDDLE,
      tribe: VIKING,
      owner: SEAT + 1,
      force: true,
    });
    crowded.step();
    decide(crowded, [HELD_BARRACKS]);
    expect(planOf(crowded).plots).toEqual([]);
  });

  it('keeps a plot while its step is skipped, for the step to come back to', () => {
    const sim = island(LONG_END);
    decide(sim, [HELD_BARRACKS]);
    const plotted = plotAt(sim, 'barracks');
    // No iron on the island: the same step skips.
    decide(sim, [{ ...HELD_BARRACKS, needsResources: ['iron'] }]);
    expect(plotAt(sim, 'barracks')).toEqual(plotted);
  });

  it('plots a lost barracks again at the next review, and keeps a later home off it', () => {
    const sim = island(BARRACKS_AND_HOME_END);
    settle(sim, [BARRACKS]);
    expect(planOf(sim).plots).toEqual([]);
    razeBuilding(sim.world, contextOf(sim), entityOfBuilding(sim, BARRACKS_TYPE));
    sim.step();
    reviewed(sim, [HELD_BARRACKS]);
    expect(plotAt(sim, 'barracks').building).toBe('barracks');
  });

  it('saves and restores the plan', () => {
    const sim = island(LONG_END);
    decide(sim, [HOMES, HELD_BARRACKS]);
    const plan = planOf(sim);
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content,
      map: islandMap(LONG_END),
    });
    const carrier = aiControlEntity(restored.world, SEAT);
    expect(carrier === null ? undefined : restored.world.tryGet(carrier, GroundPlan)).toEqual(plan);
  });

  it('scales the homes with the fit, from the floor to the seat cap', () => {
    expect(plannedHomes(0)).toBe(PLANNED_HOMES_FLOOR);
    expect(plannedHomes(2)).toBe(PLANNED_HOMES_FLOOR);
    expect(plannedHomes(6)).toBe(3);
    expect(plannedHomes(13)).toBe(NO_ROOM_HOMES);
    expect(plannedHomes(40)).toBe(NO_ROOM_HOMES);
  });

  it('cuts the homes by the room left beside the plots', () => {
    const plotted = island(BARRACKS_AND_HOME_END);
    decide(plotted, [HELD_BARRACKS]);
    expect(seatHomesCap(plotted.world, SEAT, NO_ROOM_HOMES + 1)).toBe(PLANNED_HOMES_FLOOR);
  });

  it("sizes the homes at the seat's first decision, with no plot on the ground until the plan is due", () => {
    const sim = island(BARRACKS_AND_HOME_END);
    const early = { ...contextOf(sim), tick: 1 };
    buildOrderModule(oneLine([HELD_BARRACKS])).run(sim.world, early, SEAT);
    expect(seatHomesCap(sim.world, SEAT, NO_ROOM_HOMES + 1)).toBe(PLANNED_HOMES_FLOOR);
    expect(planOf(sim).plots).toEqual([]);
    expect(planOf(sim).drawn).toBe(false);
    decide(sim, [HELD_BARRACKS]);
    expect(planOf(sim).plots).not.toEqual([]);
    expect(planOf(sim).drawn).toBe(true);
  });

  it('plots ground to clear where no free fit is left, and aims the clearing there', () => {
    const TREE_APART = 6;
    const trees: { x: number; y: number }[] = [];
    for (let x = STRIP.x0 + 2; x <= LONG_END; x += TREE_APART) trees.push({ x, y: HQ.y });
    const sim = island(LONG_END, ['noRoom'], trees);
    decide(sim, [HELD_BARRACKS]);
    const [plot] = planOf(sim).plots;
    expect(plot).toMatchObject({ building: 'barracks', clearing: true });
    if (plot === undefined) throw new Error('expected the plot');

    // Felled trees leave the review a free fit, which the plot takes.
    const cleared = island(LONG_END, ['noRoom'], trees);
    decide(cleared, [HELD_BARRACKS]);
    for (const tree of trees)
      for (const e of resourcesAtNode(cleared.world, tree.x, tree.y)) cleared.world.destroy(e);
    cleared.step();
    reviewed(cleared, [HELD_BARRACKS]);
    expect(plotAt(cleared, 'barracks').clearing).toBe(false);

    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([['opening:0', Number.MAX_SAFE_INTEGER]]),
      holding: new Map([['opening', 'opening:0']]),
    });
    const aim = clearingAim(sim.world, contextOf(sim), SEAT, oneLine([BARRACKS]), {
      hx: HQ.x,
      hy: HQ.y,
    });
    expect(aim.size).toBeGreaterThan(0);
  });
});
