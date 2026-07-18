import type { CellTerrainMap, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, fx, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { JOB_COLLECTOR, placeSandboxBerryBush } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The berries scene: prove wild berry bushes are forageable natural food. Hungry settlers each forage the
 * nearest ripe bush — hunger resets, the bush goes bare, blooms flowering at the regrow midpoint, then holds
 * fruit again after {@link systems.BERRY_REGROW_TICKS}. A separate bush placed already-bare regrows on its
 * own, proving the growth loop independent of foraging. There is deliberately no food store, so the only way
 * a settler's hunger can reset is by foraging a bush — the headless half asserts exactly that (every hungry
 * settler ends fed, every bush ends ripe again). The browser half is where a human judges the pixels: the
 * red-berry bush, the eat animation, the bush going bare the instant it's foraged, the white bloom at the
 * midpoint, and the berries growing back.
 *
 * The bushes draw the shared fruited-bush art (`placeSandboxBerryBush`'s default `BUSH_FRUITS_GFX`
 * variant) through the berry-bush binding; inert headlessly.
 */

const MAP_W = 30;
const MAP_H = 12;
/** The row the bushes + their foragers sit on (mid-map, so the settler-centroid framing centres on them). */
const ROW_Y = 6;
/** Tile gap between the paired bush+forager stations, so each settler's nearest ripe bush is its own. */
const STATION_GAP = 6;
const STATIONS = 4;
const FIRST_STATION_X = 5;
/** A bush placed already bare (regrowing) to prove the growth loop runs without being foraged first. It
 *  blooms flowering at this absolute tick, then ripens one {@link systems.BERRY_STAGE_TICKS} later — both
 *  well inside the run. Sits between the middle stations (in the settler-centroid framing) and three rows
 *  below the bush row, so a human watches its full bare → white-bloom → red-berry cycle unoccluded by any
 *  forager; it starts bare (not ripe), so no station forager ever targets it. */
const LONE_BARE_BUSH = { x: 14, y: 9, bloomAtTick: 300 } as const;
/**
 * Long enough for the whole cycle to close: the foragers walk one tile + eat (~tens of ticks), then every
 * foraged bush regrows one {@link systems.BERRY_REGROW_TICKS} (1200) later — so the run must clear
 * ~forage + 1200 with margin for every bush (foraged and lone-bare) to be ripe again at the end.
 */
const RUN_TICKS = 1500;
/** Frames the whole bush row; ≠ 1 so `cameraFor` centres on the scene's settlers (zoom 1 keeps the fixed
 *  origin offset). */
const INITIAL_ZOOM = 1.2;
/** Clearly over the ¾·ONE eat threshold — these settlers seek food before anything else. */
const HUNGRY = fx.div(fx.fromInt(9), fx.fromInt(10));

const { BerryBush, Settler } = components;

/** Spawn a hungry woodcutter directly (pre-tick-0) so its `hunger` can be authored — a command-spawned
 *  settler's id isn't known until tick 0. With no trees to fell it forages, then idles. */
function spawnHungryForager(sim: Simulation, x: number, y: number): void {
  const node = cellAnchorNode(x, y); // whole-tile → half-cell node anchor
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType: JOB_COLLECTOR,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (e === null) throw new Error('berries scene: unknown forager job');
  sim.world.get(e, Settler).hunger = HUNGRY;
}

function build(sim: Simulation): void {
  // Paired stations: a ripe bush with a hungry forager one tile away, so each settler's nearest ripe bush
  // is its own (the forage pick is nearest-food) and every station forages exactly once.
  for (let i = 0; i < STATIONS; i++) {
    const bx = FIRST_STATION_X + i * STATION_GAP;
    placeSandboxBerryBush(sim, bx, ROW_Y);
    spawnHungryForager(sim, bx, ROW_Y - 1);
  }
  // A lone bush that starts bare and regrows on its own (no forager), proving the growth loop.
  const bare = placeSandboxBerryBush(sim, LONE_BARE_BUSH.x, LONE_BARE_BUSH.y);
  const b = sim.world.get(bare, BerryBush);
  b.stage = 'bare';
  b.nextStageAtTick = LONE_BARE_BUSH.bloomAtTick;
}

export const berriesScene: SceneDefinition = {
  id: 'berries',
  seed: 7,
  terrain: berriesTerrain(),
  build,
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
      label: 'every hungry forager ended FED — the only food was bushes, so each one foraged',
      predicate: (sim) => {
        let fed = 0;
        let total = 0;
        for (const e of sim.world.query(Settler)) {
          total++;
          if (sim.world.get(e, Settler).hunger === fx.fromInt(0)) fed++;
        }
        return total === STATIONS && fed === STATIONS;
      },
    },
    {
      label: 'every bush ended RIPE — foraged bushes and the lone bare bush all regrew',
      predicate: (sim) => {
        for (const e of sim.world.query(BerryBush)) {
          if (sim.world.get(e, BerryBush).stage !== 'ripe') return false;
        }
        return true;
      },
    },
  ],
};

/** The scene's ground: grass everywhere (bushes are walkable, so no special terrain is needed). */
function berriesTerrain(): CellTerrainMap {
  return grassTerrain(MAP_W, MAP_H);
}
