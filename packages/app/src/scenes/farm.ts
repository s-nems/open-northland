import type { CellTerrainMap, Entity, Simulation } from '@vinland/sim';
import { cellAnchorNode, components, nodeOfPosition } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { TERRAIN_BARREN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { BUILDING_FARM, GOOD_WHEAT, JOB_FARMER_SLOT, placeSandboxBuilding } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The FARM scene: prove the original's field-farming loop end-to-end. A built grain farm employs two
 * FARMERS who — with no per-scene code — walk its surroundings SOWING wheat fields (slightly scattered,
 * the jittered lattice), WATER the growing fields with the can, REAP each ripe field with the scythe
 * (the cut wheat drops as a sheaf where the field stood) and CARRY every sheaf home into the farm's own
 * wheat-only store (`logicstock 4 25 0`). The headless half asserts the loop closes (fields exist, the
 * farmers are bound, wheat lands in the farm store); the browser half is where a human judges the
 * animations (sowing / watering / scythe / the grain carry) and the farm's panel (the "Farma" title,
 * the fields Produkcja section, the compact tab-less Magazyn).
 */

const MAP_W = 40;
const MAP_H = 24;
const FARM_X = 20;
const FARM_Y = 12;
/** Two farmers read clearly (the original farm employs up to four — `logicworker 18 4`). */
const FARMERS = 2;
/**
 * Long enough for the full loop to close several times over: first fields are sown within ~50 ticks,
 * a watered field ripens in ~250–500 (5 stages × 100 ticks, halved once watered), then reap + carry.
 */
const RUN_TICKS = 1200;
/** Frames the farm + its whole field ring (`FARM_FIELD_RADIUS` ≈ 8 tiles each way). Also deliberately
 *  ≠ 1: `cameraFor` only centres on the scene's settlers at a non-1 zoom (zoom 1 keeps the fixed
 *  origin offset), and this scene's action is at the map's centre. */
const INITIAL_ZOOM = 0.8;
/** A BARREN (sand) strip east of the farm, inside its field ring — proves the grass-only sowing gate
 *  visually (fields ring the farm but skip the tan band; the original's `biocanplanton` is `land`-only). */
const BARREN = { x0: 23, x1: 25, y0: 9, y1: 15 } as const;

const { Building, Crop, JobAssignment, Position, Settler, Stockpile } = components;

/** The scene's ground: all grass with the {@link BARREN} sand strip stamped inside the field ring. */
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
  title: 'Farma — uprawa zboża',
  summary:
    'Farmerzy chodzą wokół farmy: sieją zboże (lekko rozrzucone pola), podlewają je konewką, dojrzałe ' +
    'łany ścinają kosą i znoszą snopki do magazynu farmy. Dzielą się pracą (każdy inne pole), a na ' +
    'piaskowym pasie przy farmie nic nie rośnie (zboże tylko na trawie).',
  seed: 11,
  terrain: farmTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Farmerzy wychodzą z farmy i SIEJĄ zboże wokół niej (animacja rozsiewania); pola są minimalnie rozrzucone, nie sklejone heks przy heksie.',
    'Farmerzy DZIELĄ SIĘ pracą: każdy idzie do INNEGO pola/snopka, nie chodzą jeden przy drugim do tego samego celu.',
    'Na PIASKOWYM pasie na wschód od farmy NIE powstaje żadne pole (zboże rośnie tylko na trawie).',
    'Świeżo posiane pole jest niewidoczne/gołe (oryginał nie rysuje stanu 1) — ŻADNEGO zielonego kwadratu; kiełki widać od 2. stadium.',
    'Zboże ROŚNIE przez 5 stadiów — od świeżo posianej kępki do dojrzałego łanu.',
    'Farmer PODLEWA rosnące pole konewką (animacja podlewania); podlane pole rośnie szybciej.',
    'Dojrzałe pole farmer ŚCINA KOSĄ (animacja koszenia); po ścięciu na ziemi zostaje snopek, a pole znika (można siać ponownie).',
    'Farmer PODNOSI snopek i NIESIE go do farmy (chód z załadowanym zbożem); licznik magazynu farmy rośnie.',
    'Panel farmy (kliknij budynek): tytuł „Farma", sekcja Produkcja z ikoną zboża i licznikami Posiane/Rosnące/Dojrzałe, mały Magazyn BEZ zakładek z jednym wierszem zboża w formacie „ilość / pojemność" (x.0 / 25.0).',
  ],
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
