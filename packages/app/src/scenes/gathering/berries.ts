import type { CellTerrainMap, Simulation } from '@open-northland/sim';
import { components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR } from '../../catalog/jobs.js';
import { placeSandboxBerryBush, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 30;
const MAP_H = 12;
/**
 * Near the top of the map: the growth trigger takes the map's sections in row order, every 24 ticks, so
 * this row's bushes bloom at ticks 1992 to 2280, within the run. A bush mid-map would bloom only near tick 4800.
 */
const BUSH_ROW_Y = 2;
/** Mid-map, so the settler-centroid framing centres on the map; each forager walks up to its own bush. */
const FORAGER_ROW_Y = 6;
/** Tile gap between the paired bush+forager stations, so each settler's nearest ripe bush is its own. */
const STATION_GAP = 6;
const STATIONS = 4;
const FIRST_STATION_X = 5;
/** Starts flowering, so no forager targets it, and ripens on its section's growth run at tick 1176. */
const LONE_FLOWERING_BUSH = { x: 14, y: 1 } as const;
/** Past the last station bush's bloom; a fruit needs a whole growth period more, 9600 ticks. */
const RUN_TICKS = 2400;
/** Not 1, so `cameraFor` centres on the settlers instead of keeping the fixed origin offset. */
const INITIAL_ZOOM = 1.2;
/** Clearly over the drive threshold - these settlers seek food before anything else. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));

const { SettlerNeeds, BerryBush, Settler } = components;

/** With no gatherable resource on the map, an authored-hungry collector forages and then idles. */
function spawnHungryForager(sim: Simulation, x: number, y: number): void {
  const e = spawnSettlerDirect(sim, JOB_COLLECTOR, x, y);
  systems.mutNeeds(sim.world, e, sim.tick).hunger = HUNGRY;
}

function build(sim: Simulation): void {
  for (let i = 0; i < STATIONS; i++) {
    const bx = FIRST_STATION_X + i * STATION_GAP;
    placeSandboxBerryBush(sim, bx, BUSH_ROW_Y);
    spawnHungryForager(sim, bx, FORAGER_ROW_Y);
  }
  const lone = placeSandboxBerryBush(sim, LONE_FLOWERING_BUSH.x, LONE_FLOWERING_BUSH.y);
  sim.world.mut(lone, BerryBush).stage = 'flowering';
}

export const berriesScene: SceneDefinition = {
  id: 'berries',
  seed: 7,
  terrain: berriesTerrain(),
  build,
  // The foragers have to actually get hungry and actually be fed by the berry, so this scene runs the
  // needs mechanic rather than the frozen-bar default.
  needs: true,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'berry bushes spawned (the map placed forageable wild food)',
      predicate: (sim) => {
        let bushes = 0;
        for (const _e of sim.world.query(BerryBush)) bushes++;
        return bushes === STATIONS + 1;
      },
    },
    {
      label: 'every hungry forager ended FED - the only food was bushes, so each one foraged',
      predicate: (sim) => {
        let fed = 0;
        let total = 0;
        // A berry is a partial meal, not a reset: each forager started past the drive threshold and only
        // the berry's own event could have brought it back under.
        for (const e of sim.world.query(Settler)) {
          total++;
          if (
            systems.needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick) <
            systems.NEED_DRIVE_THRESHOLD
          )
            fed++;
        }
        return total === STATIONS && fed === STATIONS;
      },
    },
    {
      label: 'each bush grew one stage on its growth run: the foraged ones FLOWERING, the lone one RIPE',
      predicate: (sim) => {
        let flowering = 0;
        let ripe = 0;
        for (const e of sim.world.query(BerryBush)) {
          const stage = sim.world.get(e, BerryBush).stage;
          if (stage === 'flowering') flowering++;
          else if (stage === 'ripe') ripe++;
        }
        return flowering === STATIONS && ripe === 1;
      },
    },
  ],
};

/** Bushes are walkable, so plain grass is enough. */
function berriesTerrain(): CellTerrainMap {
  return grassTerrain(MAP_W, MAP_H);
}
