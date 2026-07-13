import type { CellTerrainMap, Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, nodeOfPosition } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { TERRAIN_BARREN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_FARM,
  BUILDING_WAREHOUSE_00,
  GOOD_WHEAT,
  JOB_FARMER_SLOT,
  placeSandboxBuilding,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The FARM scene: prove the original's field-farming loop end-to-end. A built grain farm — standing on
 * a BARREN sand patch — employs two FARMERS who — with no per-scene code — walk OFF the sand to the
 * surrounding grass SOWING wheat fields (slightly scattered, the jittered lattice; never on the sand —
 * the `biocanplanton` gate), WATER each field with the can (the growth GATE: an unwatered field stands
 * bare), REAP each ripe field with the scythe (the cut wheat drops as a sheaf where the field stood)
 * and CARRY every sheaf home into the farm's own wheat-only store (`logicstock 4 25 0`), stepping
 * INSIDE the farm for the deposit. A WAREHOUSE stands beside the farm on the same sand: once the
 * farm's 25-slot fills, the delivery rung overflows further sheaves there instead of leaving a
 * farmer frozen mid-carry at the door (the user-reported stuck carrier). The headless half asserts
 * the loop closes (fields exist, on grass alone, the farmers are bound, wheat lands in the farm
 * store); the browser half is where a human judges the animations (sowing / watering / scythe / the
 * grain carry / the store visit) and the farm's panel (the "Farma" title, the fields Produkcja
 * section, the compact tab-less Magazyn with the amount/capacity row).
 */

const MAP_W = 40;
const MAP_H = 24;
const FARM_X = 20;
const FARM_Y = 12;
/** The overflow WAREHOUSE beside the farm (same sand patch, two cells of yard between the walls):
 *  where the farmers carry the wheat once the farm's own 25-slot store is full. */
const WAREHOUSE_X = 25;
const WAREHOUSE_Y = 12;
/** Two farmers read clearly (the original farm employs up to four — `logicworker 18 4`). */
const FARMERS = 2;
/**
 * Long enough for the full loop to close: a field needs a sowing plus ONE WATERING PER STAGE (growth
 * is farmer-fueled — 4 stage steps × 500 ticks plus the can's round trips), then reap + carry, with
 * margin for the sand walk-out and the crew splitting its time across the 10-field roster.
 */
const RUN_TICKS = 3600;
/** Frames the farm + its whole field ring (`FARM_FIELD_RADIUS` ≈ 8 tiles each way). Also deliberately
 *  ≠ 1: `cameraFor` only centres on the scene's settlers at a non-1 zoom (zoom 1 keeps the fixed
 *  origin offset), and this scene's action is at the map's centre. */
const INITIAL_ZOOM = 0.8;
/** A BARREN (sand) patch the farm AND the warehouse STAND ON — the user-requested proof of the
 *  grass-only sowing gate: the farmers must walk OFF the sand to the surrounding grass to sow, so the
 *  fields ring the tan patch and never dot it (the original's `biocanplanton` belongs to `land` alone). */
const BARREN = { x0: 17, x1: 27, y0: 9, y1: 15 } as const;

const { Building, Crop, JobAssignment, Position, Settler, Stockpile } = components;

/** The scene's ground: grass everywhere except the {@link BARREN} sand patch under the farm. */
function farmTerrain(): CellTerrainMap {
  const base = grassTerrain(MAP_W, MAP_H);
  const typeIds = [...base.typeIds];
  for (let y = BARREN.y0; y <= BARREN.y1; y++) {
    for (let x = BARREN.x0; x <= BARREN.x1; x++) typeIds[y * MAP_W + x] = TERRAIN_BARREN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

/**
 * The farm's DOOR node — its anchor plus the content footprint's door offset (the sim's
 * `interactionNode`). The farmers spawn HERE so the JobSystem's adopt pass binds them to the farm on
 * tick 1 (a pre-employed settler standing at a workplace it staffs is bound to it); resolved from the
 * loaded content so the headless (approximate footprint) and browser (real extracted footprint) doors
 * both work without scene-side guessing.
 */
function farmDoorNode(sim: Simulation): { hx: number; hy: number } {
  const anchor = cellAnchorNode(FARM_X, FARM_Y);
  const door = sim.content.buildings.find((b) => b.typeId === BUILDING_FARM)?.footprint?.door;
  return { hx: anchor.hx + (door?.dx ?? 0), hy: anchor.hy + (door?.dy ?? 0) };
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_FARM, FARM_X, FARM_Y);
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_X, WAREHOUSE_Y);
  // The farmers spawn at the door (node coords — the raw command, not the tile helper, so the door
  // offset lands exactly); the adopt pass staffs them, then the field loop takes over.
  const door = farmDoorNode(sim);
  for (let i = 0; i < FARMERS; i++) {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: JOB_FARMER_SLOT,
      x: door.hx,
      y: door.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
  }
}

/** The scene's one farm entity, or null before the placement command ran. */
function farmEntity(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_FARM) return e;
  }
  return null;
}

export const farmScene: SceneDefinition = {
  id: 'farm',
  seed: 11,
  terrain: farmTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'both farmers are employed BY THE FARM (adopted + bound on tick 1)',
      predicate: (sim) => {
        const farm = farmEntity(sim);
        if (farm === null) return false;
        let bound = 0;
        for (const e of sim.world.query(Settler, JobAssignment)) {
          if (sim.world.get(e, JobAssignment).workplace === farm) bound++;
        }
        return bound === FARMERS;
      },
    },
    {
      label: 'wheat fields stand around the farm (the loop keeps sowing)',
      predicate: (sim) => {
        let fields = 0;
        for (const _e of sim.world.query(Crop)) fields++;
        return fields > 0;
      },
    },
    {
      label: 'reaped wheat reached the farm’s own store (the loop closed: sow→grow→reap→carry)',
      predicate: (sim) => {
        const farm = farmEntity(sim);
        if (farm === null) return false;
        return (sim.world.get(farm, Stockpile).amounts.get(GOOD_WHEAT) ?? 0) > 0;
      },
    },
    {
      label: 'no field stands on the barren sand strip (grain is sown on grass alone)',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        for (const e of sim.world.query(Crop, Position)) {
          const p = sim.world.get(e, Position);
          const n = nodeOfPosition(p.x, p.y);
          if (!terrain.isPlantable(terrain.nodeAtClamped(n.hx, n.hy))) return false;
        }
        return true;
      },
    },
  ],
};
