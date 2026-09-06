import type { CellTerrainMap, Simulation } from '@open-northland/sim';
import { components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import { placeSandboxBerryBush, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 30;
const MAP_H = 12;
/** Mid-map, so the settler-centroid framing centres on the stations. */
const ROW_Y = 6;
/** Tile gap between the paired bush+forager stations, so each settler's nearest ripe bush is its own. */
const STATION_GAP = 6;
const STATIONS = 4;
const FIRST_STATION_X = 5;
/** Starts bare rather than ripe, so no station forager ever targets it, and blooms at this absolute tick. */
const LONE_BARE_BUSH = { x: 14, y: 9, bloomAtTick: 300 } as const;
/** Clears the forage plus one `BERRY_REGROW_TICKS` (1200), so every bush is ripe again at the end. */
const RUN_TICKS = 1500;
/** Not 1, so `cameraFor` centres on the settlers instead of keeping the fixed origin offset. */
const INITIAL_ZOOM = 1.2;
/** Clearly over the drive threshold - these settlers seek food before anything else. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));

const { BerryBush, Settler } = components;

/** With no gatherable resource on the map, an authored-hungry collector forages and then idles. */
function spawnHungryForager(sim: Simulation, x: number, y: number): void {
  const e = spawnSettlerDirect(sim, JOB_COLLECTOR, x, y);
  sim.world.mut(e, Settler).hunger = HUNGRY;
}

function build(sim: Simulation): void {
  for (let i = 0; i < STATIONS; i++) {
    const bx = FIRST_STATION_X + i * STATION_GAP;
    placeSandboxBerryBush(sim, bx, ROW_Y);
    spawnHungryForager(sim, bx, ROW_Y - 1);
  }
  const bare = placeSandboxBerryBush(sim, LONE_BARE_BUSH.x, LONE_BARE_BUSH.y);
  const b = sim.world.mut(bare, BerryBush);
  b.stage = 'bare';
  b.nextStageAtTick = LONE_BARE_BUSH.bloomAtTick;
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
          if (sim.world.get(e, Settler).hunger < systems.NEED_DRIVE_THRESHOLD) fed++;
        }
        return total === STATIONS && fed === STATIONS;
      },
    },
    {
      label: 'every bush ended RIPE - foraged bushes and the lone bare bush all regrew',
      predicate: (sim) => {
        for (const e of sim.world.query(BerryBush)) {
          if (sim.world.get(e, BerryBush).stage !== 'ripe') return false;
        }
        return true;
      },
    },
  ],
};

/** Bushes are walkable, so plain grass is enough. */
function berriesTerrain(): CellTerrainMap {
  return grassTerrain(MAP_W, MAP_H);
}
