import { type FootprintCell, parseContentSet } from '@open-northland/data';
import type { EconomicSide } from '../../src/components/index.js';
import type { PlayerCommand } from '../../src/core/commands/index.js';
import { Simulation, type TerrainMap } from '../../src/index.js';
import { GROUND_PLAN_FROM_TICKS } from '../../src/systems/computer-player/build-order/ground-plan.js';
import { type BuildOrderEntry, buildOrderModule } from '../../src/systems/computer-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import {
  completeSites,
  ctxOf,
  HQ_TYPE,
  makeAiSeat,
  oneLine,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  seatEconomy,
  VIKING,
} from '../systems/computer-player/support.js';
import { aiContent } from './ai-content.js';

const GRASS = 0;
const WATER = 1;
const MAP_W = 64;
const MAP_H = 32;
export const HQ = { x: 12, y: 15 };
/** The land under the headquarters' whole zone, and the strip running east of it. */
export const HQ_LAND = { x0: 9, x1: 16, y0: 12, y1: 18 };
export const STRIP = { x0: 16, y0: 13, y1: 17 };
/** A strip east end that fits one barracks and one home side by side, not the barracks beside two homes. */
export const BARRACKS_AND_HOME_END = 36;
/** A strip east end with room for more homes than a seat with no room ever raises. */
export const LONG_END = 60;

/** A filled block of half-widths `dx` and `dy`. */
function block(dx: number, dy: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let y = -dy; y <= dy; y++) for (let x = -dx; x <= dx; x++) cells.push({ dx: x, dy: y });
  return cells;
}

export const HOME_ZONE = block(3, 1);
export const BARRACKS_ZONE = block(6, 2);
export const MILL_ZONE = block(4, 1);
export const WELL_ZONE = block(1, 1);

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
export const content = parseContentSet({
  ...base,
  buildings: base.buildings.map((b) => {
    const zone = ZONES[b.id];
    return zone === undefined ? b : { ...b, footprint: footprintOf(zone) };
  }),
  // A tree's walk body blocks its own node, as a real tree's does.
  landscapeGfx: base.landscapeGfx.map((gfx) => ({ ...gfx, walkBlockAreas: [[0, 0, 0, 1]] })),
});

export function islandMap(stripEnd: number): TerrainMap {
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

/** An island seat on a grass block round its headquarters with a strip of land running east, its end
 *  setting how much room the seat has. */
export function island(
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

export const contextOf = (sim: Simulation): SystemContext => ({
  ...ctxOf(sim, GROUND_PLAN_FROM_TICKS),
  content,
});

export function decide(sim: Simulation, steps: readonly BuildOrderEntry[]): readonly PlayerCommand[] {
  return buildOrderModule(oneLine(steps)).run(sim.world, contextOf(sim), SEAT);
}

/** Runs decisions, each finished site opening the next, until the order places nothing more. */
export function settle(sim: Simulation, steps: readonly BuildOrderEntry[]): void {
  for (let command = decide(sim, steps)[0]; command !== undefined; command = decide(sim, steps)[0]) {
    sim.enqueueSetup(command);
    sim.step();
    completeSites(sim);
  }
}
