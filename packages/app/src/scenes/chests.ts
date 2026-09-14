import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, ONE, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { BUILDING_WELL, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Chests and papers: three collectors are each sent to a chest at tick 0 - a wooden food chest, a wooden
 * chest holding three civilists, and a magical shoes chest that only a druid or hero may open, so its
 * collector refuses - while the seat spends a paper it already holds on a well that stands finished at
 * once. Watch two settlers walk to their chests, bend over the lid, and the chests vanish; the magical
 * chest stays closed with nobody at it, and the well never shows a foundation.
 */

const MAP_W = 24;
const MAP_H = 12;
const ROW_Y = 6;
/** Tile gap between the chest stations, so each opener's stance cell is its own. */
const STATION_GAP = 6;
const FIRST_STATION_X = 4;
/** The chest types of the three stations (`chesttypes` rows 20, 92 and 26). */
const FOOD_CHEST = 20;
const CIVILISTS_CHEST = 92;
const SHOES_CHEST = 26;
const CIVILISTS_PER_CHEST = 3;
/** Where the paper-bought well stands, clear of the stations. */
const WELL = { x: 4, y: 2 } as const;
const WELL_PAPER = { kind: 'placeHouse', param: BUILDING_WELL } as const;
/** Long enough for the far walk plus the open-chest clip. */
const RUN_TICKS = 400;
const INITIAL_ZOOM = 1.2;

const { Building, Chest, Settler, Stockpile } = components;

function stationX(i: number): number {
  return FIRST_STATION_X + i * STATION_GAP;
}

function chestAt(sim: Simulation, kind: 'wooden' | 'magical', contents: number, x: number, y: number) {
  const node = cellAnchorNode(x, y);
  return systems.createChest(sim.world, sim.content, { kind, contents, x: node.hx, y: node.hy });
}

function build(sim: Simulation): void {
  const stations = [
    { kind: 'wooden', contents: FOOD_CHEST },
    { kind: 'wooden', contents: CIVILISTS_CHEST },
    { kind: 'magical', contents: SHOES_CHEST },
  ] as const;
  stations.forEach((station, i) => {
    const chest = chestAt(sim, station.kind, station.contents, stationX(i), ROW_Y);
    const opener = spawnSettlerDirect(sim, JOB_COLLECTOR, stationX(i), ROW_Y - 3);
    sim.enqueueSetup({ kind: 'openChest', entity: opener, chest });
  });
  sim.enqueueSetup({ kind: 'grantPaper', player: HUMAN_PLAYER, paper: { ...WELL_PAPER } });
  const well = cellAnchorNode(WELL.x, WELL.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WELL,
    x: well.hx,
    y: well.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    paper: { ...WELL_PAPER },
  });
}

function looseGoodsHeld(sim: Simulation): number {
  let units = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, Building)) continue;
    for (const amount of sim.world.get(e, Stockpile).amounts.values()) units += amount;
  }
  return units;
}

export const chestsScene: SceneDefinition = {
  id: 'chests',
  seed: 11,
  // Chests block their own cell only, so plain grass is enough.
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the two wooden chests were opened; the magical one refused its collector and stands',
      predicate: (sim) => {
        const left = [...sim.world.query(Chest)];
        return left.length === 1 && left.every((e) => sim.world.get(e, Chest).kind === 'magical');
      },
    },
    {
      label: 'the food chest heaped its food on the ground',
      predicate: (sim) => looseGoodsHeld(sim) > 0,
    },
    {
      label: 'the civilists chest stood up three settlers beside the three openers',
      predicate: (sim) => [...sim.world.query(Settler)].length === 3 + CIVILISTS_PER_CHEST,
    },
    {
      label: 'the well paper was spent on a well that stands finished, never a foundation',
      predicate: (sim) => {
        const wells = [...sim.world.query(Building)].filter(
          (e) => sim.world.get(e, Building).buildingType === BUILDING_WELL,
        );
        const well = wells[0];
        return (
          well !== undefined &&
          sim.world.get(well, Building).built === ONE &&
          sim.papers(HUMAN_PLAYER).length === 0
        );
      },
    },
  ],
};
