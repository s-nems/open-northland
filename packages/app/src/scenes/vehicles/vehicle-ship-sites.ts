import type { Simulation } from '@open-northland/sim';
import { type CellTerrainMap, components, fx } from '@open-northland/sim';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_SHIP_BIG_YARD,
  BUILDING_SHIP_SMALL_YARD,
  placeSandboxSite,
  spawnVehicleDirect,
  VEHICLE_SHIP_BIG,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import { CIVILIZATIONS } from '../civilizations.js';
import type { SceneDefinition } from '../types.js';

const { Building, Stockpile, UnderConstruction, Vehicle } = components;

const COLUMN_STEP = 11;
const FIRST_COLUMN = 6;
const MAP_W = FIRST_COLUMN * 2 + COLUMN_STEP * (CIVILIZATIONS.length - 1);
/** Build progress of the two sites in each yard's band, in tenths. */
const SITE_TENTHS = [3, 9] as const;
const TENTHS = 10;
/** The columns' owners in turn, so a site's ship shows its owner's colour, not the first player's. */
const OWNERS = [HUMAN_PLAYER, ENEMY_PLAYER] as const;
/** Cell rows between the band's rows: a hull stands about six tall. */
const ROW_STEP = 8;
/** The shore a band's launched ship moors to, cell rows below it: inside the ship's door ring. */
const SHORE_BELOW = 2;
const SHORE_ROWS = 2;
const BANDS = [
  { yard: BUILDING_SHIP_SMALL_YARD, ship: VEHICLE_SHIP_SMALL, top: 5 },
  { yard: BUILDING_SHIP_BIG_YARD, ship: VEHICLE_SHIP_BIG, top: 36 },
] as const;
const shipRow = (top: number): number => top + ROW_STEP * SITE_TENTHS.length;
const lastBand = BANDS[BANDS.length - 1];
const MAP_H = (lastBand === undefined ? 0 : shipRow(lastBand.top)) + SHORE_BELOW + SHORE_ROWS + FIRST_COLUMN;

function isShore(y: number): boolean {
  return BANDS.some(
    ({ top }) => y >= shipRow(top) + SHORE_BELOW && y < shipRow(top) + SHORE_BELOW + SHORE_ROWS,
  );
}

function shipyardTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) typeIds[y * MAP_W + x] = isShore(y) ? TERRAIN_OPEN : TERRAIN_IMPASSABLE;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

/** A yard site at `tenths` of its build with its whole bill delivered, so the construction pass keeps
 *  the progress. */
function placeYardSite(
  sim: Simulation,
  yard: number,
  x: number,
  y: number,
  tribe: number,
  owner: number,
  tenths: number,
) {
  const site = placeSandboxSite(sim, yard, x, y, owner, { tribe });
  const built = fx.div(fx.fromInt(tenths), fx.fromInt(TENTHS));
  sim.world.mut(site, Building).built = built;
  sim.world.mut(site, UnderConstruction).labor = built;
  const delivered = sim.world.mut(site, Stockpile).amounts;
  for (const { goodType, amount } of sim.content.buildings.find((b) => b.typeId === yard)?.construction ?? [])
    delivered.set(goodType, amount);
}

function build(sim: Simulation): void {
  CIVILIZATIONS.forEach((tribe, column) => {
    const x = FIRST_COLUMN + column * COLUMN_STEP;
    const owner = OWNERS[column % OWNERS.length] ?? HUMAN_PLAYER;
    for (const band of BANDS) {
      SITE_TENTHS.forEach((tenths, i) => {
        placeYardSite(sim, band.yard, x, band.top + ROW_STEP * i, tribe, owner, tenths);
      });
      spawnVehicleDirect(sim, band.ship, x, shipRow(band.top), { tribe, owner });
    }
  });
}

/**
 * Each civilization's ship yards, one column per tribe in `CIVILIZATIONS` order: the small ship's band
 * above the big ship's, each two sites at 30% and 90% over the ship such a site launches, moored at a
 * shore, the columns owned by two players in turn. The browser view is the check that a site rises as the very ship it launches.
 */
export const vehicleShipSitesScene: SceneDefinition = {
  id: 'vehicle-ship-sites',
  seed: 1,
  terrain: shipyardTerrain(),
  build,
  graphicTribes: CIVILIZATIONS,
  runTicks: 1,
  progression: false,
  initialZoom: 0.6,
  checks: [
    {
      label: 'every ship yard site still stands under construction',
      predicate: (sim) =>
        [...sim.world.query(Building, UnderConstruction)].length ===
        CIVILIZATIONS.length * BANDS.length * SITE_TENTHS.length,
    },
    {
      label: 'every ship lies moored at its shore',
      predicate: (sim) => {
        const ships = [...sim.world.query(Vehicle)];
        return (
          ships.length === CIVILIZATIONS.length * BANDS.length &&
          ships.every((e) => sim.world.get(e, Vehicle).moored)
        );
      },
    },
  ],
};
