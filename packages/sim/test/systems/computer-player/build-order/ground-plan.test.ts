import { type FootprintCell, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  type EconomicSide,
  GroundPlan,
  type GroundPlanState,
  type GroundPlot,
  StalledPlacements,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { DeepReadonly } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../../../src/index.js';
import type { TerrainGraph } from '../../../../src/nav/terrain/index.js';
import {
  GROUND_PLAN_FROM_TICKS,
  PLANNED_HOMES_FLOOR,
} from '../../../../src/systems/computer-player/build-order/ground-plan.js';
import { plottedNodes, seatHomesCap } from '../../../../src/systems/computer-player/build-order/plots.js';
import { NO_ROOM_HOMES } from '../../../../src/systems/computer-player/build-order/seat-order.js';
import { type BuildOrderEntry, buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import { clearingAim } from '../../../../src/systems/computer-player/workforce/collectors/index.js';
import type { SystemContext } from '../../../../src/systems/index.js';
import { razeBuilding } from '../../../../src/systems/lifecycle/cleanup.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  BARRACKS_TYPE,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  makeAiSeat,
  oneLine,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TYPE,
  seatEconomy,
  VIKING,
} from '../support.js';

const GRASS = 0;
const WATER = 1;
const MAP_W = 64;
const MAP_H = 32;
const HQ = { x: 12, y: 15 };
/** The land under the headquarters' whole zone, and the strip running east of it. */
const HQ_LAND = { x0: 9, x1: 16, y0: 12, y1: 18 };
const STRIP = { x0: 16, y0: 13, y1: 17 };
/** A strip east end that fits one barracks and one home side by side, not the barracks beside two homes. */
const BARRACKS_AND_HOME_END = 36;
/** A strip east end with room for more homes than a seat with no room ever raises. */
const LONG_END = 60;
/** A strip east end with no room for a home at all. */
const TINY_END = STRIP.x0;

/** A filled block of half-widths `dx` and `dy`. */
function block(dx: number, dy: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let y = -dy; y <= dy; y++) for (let x = -dx; x <= dx; x++) cells.push({ dx: x, dy: y });
  return cells;
}

const HOME_ZONE = block(3, 1);
const BARRACKS_ZONE = block(6, 2);
const MILL_ZONE = block(4, 1);
const WELL_ZONE = block(1, 1);

const footprintOf = (zone: readonly FootprintCell[]) => ({
  blocked: [{ dx: 0, dy: 0 }],
  reserved: zone,
  door: { dx: 0, dy: 1 },
});

const ZONES: Readonly<Record<string, readonly FootprintCell[]>> = {
  headquarters: block(3, 3),
  home_level_00: HOME_ZONE,
  barracks: BARRACKS_ZONE,
  work_mill_00: MILL_ZONE,
  work_well_00: WELL_ZONE,
};

const base = aiContent();
const content = parseContentSet({
  ...base,
  buildings: base.buildings.map((b) => {
    const zone = ZONES[b.id];
    return zone === undefined ? b : { ...b, footprint: footprintOf(zone) };
  }),
  // A tree's walk body blocks its own node, as a real tree's does.
  landscapeGfx: base.landscapeGfx.map((gfx) => ({ ...gfx, walkBlockAreas: [[0, 0, 0, 1]] })),
});

function islandMap(stripEnd: number): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(WATER);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const hq = x >= HQ_LAND.x0 && x <= HQ_LAND.x1 && y >= HQ_LAND.y0 && y <= HQ_LAND.y1;
      const strip = x >= STRIP.x0 && x <= stripEnd && y >= STRIP.y0 && y <= STRIP.y1;
      if (hq || strip) typeIds[y * MAP_W + x] = GRASS;
    }
  }
  return { resolution: 'half-cell', width: MAP_W, height: MAP_H, typeIds };
}

function island(
  stripEnd: number,
  sides: EconomicSide[] = ['noRoom'],
  trees: readonly { x: number; y: number }[] = [],
): Simulation {
  const sim = new Simulation({ seed: 1, content, map: islandMap(stripEnd) });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HQ, tribe: VIKING, owner: SEAT });
  placeResources(
    sim,
    trees.map((tree) => ({ ...RESOURCE_SPOTS.wood, ...tree })),
  );
  makeAiSeat(sim, SEAT, { houseBuild: false });
  seatEconomy(sim, 'islands', sides);
  sim.step();
  return sim;
}

const contextOf = (sim: Simulation): SystemContext => ({ ...ctxOf(sim, GROUND_PLAN_FROM_TICKS), content });

function decide(sim: Simulation, steps: readonly BuildOrderEntry[]): readonly PlayerCommand[] {
  return buildOrderModule(oneLine(steps)).run(sim.world, contextOf(sim), SEAT);
}

/** Runs decisions, each finished site opening the next, until the order places nothing more. */
function settle(sim: Simulation, steps: readonly BuildOrderEntry[]): void {
  for (let command = decide(sim, steps)[0]; command !== undefined; command = decide(sim, steps)[0]) {
    sim.enqueueSetup(command);
    sim.step();
    completeSites(sim);
  }
}

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

  it('cuts the homes to what fits beside the plots, within the floor and the seat cap', () => {
    // With nothing to keep the plan cuts nothing, however little fits.
    const unplotted = island(TINY_END);
    decide(unplotted, [HOMES]);
    expect(seatHomesCap(unplotted.world, SEAT, NO_ROOM_HOMES + 1)).toBe(NO_ROOM_HOMES);

    // Short of room only while a plot waits, and lifted at the review once it is gone.
    const plotted = island(BARRACKS_AND_HOME_END);
    decide(plotted, [HELD_BARRACKS]);
    expect(seatHomesCap(plotted.world, SEAT, NO_ROOM_HOMES + 1)).toBe(PLANNED_HOMES_FLOOR);
    settle(plotted, [BARRACKS]);
    reviewed(plotted, [BARRACKS]);
    expect(seatHomesCap(plotted.world, SEAT, NO_ROOM_HOMES + 1)).toBe(NO_ROOM_HOMES);
  });

  it('plots ground to clear where no free fit is left, and aims the clearing there', () => {
    const TREE_APART = 6;
    const trees: { x: number; y: number }[] = [];
    for (let x = STRIP.x0 + 2; x <= LONG_END; x += TREE_APART) trees.push({ x, y: HQ.y });
    const sim = island(LONG_END, ['noRoom'], trees);
    decide(sim, [HELD_BARRACKS]);
    const [plot] = planOf(sim).plots;
    expect(plot).toMatchObject({ building: 'barracks', clearing: true });

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
