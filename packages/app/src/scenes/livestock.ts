import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_HUNTER, JOB_SCOUT } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { ANIMAL_TRIBE_CATTLE, ANIMAL_TRIBE_SHEEP } from '../game/sandbox/content/catalog/animals.js';
import {
  BUILDING_ANIMAL_FARM,
  buildingDoorNode,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import { computeLivestockHearts } from '../view/projections/livestock-hearts.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The husbandry sign-off scene: wild sheep and cattle herds, two scouts standing among them, and a
 * staffed animal farm with the tribe's hunter beside it (the tech unlock for leather and meat). The
 * scouts claim the animals by contact (the faction heart appears over each), the claimed stock
 * marches to the farm door and grazes around it, and the two breeders run the feed
 * cycles - water + wheat + a visit's worth of animal life → the fed-animal token, then wool (sheep) or
 * leather (cattle), plus the meat byproduct. Headless proves the chain end to end; in the browser a
 * human judges the hearts, the march, the grazing ring around the farm, and the animals never reading
 * as butchered (the life floor keeps every claimed animal above half its pool).
 */

const MAP_W = 40;
const MAP_H = 28;
const INITIAL_ZOOM = 0.8;
/** Claim (contact) + the ~50-node march + two 180-tick cycle stages per species, with margin. */
const RUN_TICKS = 1500;

const FARM = { x: 26, y: 8 } as const;
const BREEDERS = 2;
/** The tribe's hunter, beside the farm: leather and meat are `jobEnablesGood` hunter unlocks (the
 *  extracted tech graph), so without one alive the feed chain converts only wool. Out of hunt sight
 *  (16 nodes) of both wild herds, and claimed stock is property, never prey - he only stands. */
const HUNTER = { x: 24, y: 6 } as const;
/** Herd birth points, far enough from the farm that the march to the door is visible. */
const SHEEP_BIRTH = { x: 8, y: 20 } as const;
const CATTLE_BIRTH = { x: 30, y: 21 } as const;

/** The farm's starter larder, deliberately stuffed past the 10-unit slot caps (the Magazyn row clamps
 *  its DISPLAY at capacity) so ~40 feed batches run without a supply chain. */
const STARTER_WATER = 40;
const STARTER_WHEAT = 80;

const { Building, Health, LivestockVisit, Owner, Position, Resting, Settler, StayPoint, Stockpile } =
  components;

function build(sim: Simulation): void {
  const farm = placeBuiltSandboxBuilding(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y, HUMAN_PLAYER);
  sim.world.write(farm, Stockpile, (s) => {
    s.amounts.set(goodBySlug(sim, 'water'), STARTER_WATER);
    s.amounts.set(goodBySlug(sim, 'wheat'), STARTER_WHEAT);
  });
  spawnWorkersAtDoor(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y, BREEDERS);
  spawnSandboxSettler(sim, JOB_HUNTER, HUNTER.x, HUNTER.y, HUMAN_PLAYER);

  for (const herd of [
    { tribe: ANIMAL_TRIBE_SHEEP, at: SHEEP_BIRTH },
    { tribe: ANIMAL_TRIBE_CATTLE, at: CATTLE_BIRTH },
  ]) {
    const node = cellAnchorNode(herd.at.x, herd.at.y);
    sim.enqueue({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
    // A scout standing amid the herd - the claim is contact, so the wandering herd walks into him.
    spawnSandboxSettler(sim, JOB_SCOUT, herd.at.x, herd.at.y, HUMAN_PLAYER);
  }
}

function ownedOf(sim: Simulation, tribe: number): Entity[] {
  const owned: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Settler).tribe === tribe && sim.world.get(e, Owner).player === HUMAN_PLAYER) {
      owned.push(e);
    }
  }
  return owned;
}

function farmStock(sim: Simulation, slug: string): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== BUILDING_ANIMAL_FARM) continue;
    return sim.world.get(e, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
  }
  return 0;
}

export const livestockScene: SceneDefinition = {
  id: 'livestock',
  seed: 17,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the scouts claimed sheep and cattle by contact',
      predicate: (sim) =>
        ownedOf(sim, ANIMAL_TRIBE_SHEEP).length >= 1 && ownedOf(sim, ANIMAL_TRIBE_CATTLE).length >= 1,
    },
    {
      label: 'claimed stock re-anchored its leash onto the grazing ring around the farm',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        const door = buildingDoorNode(sim, BUILDING_ANIMAL_FARM, FARM.x, FARM.y);
        const doorNode = terrain.nodeAtClamped(door.hx, door.hy);
        const at = terrain.coordsOf(doorNode);
        // An animal on a processing visit is skipped by the herding sweep - its leash is paused, so
        // only the grazing herd is held to the ring.
        const claimed = [...ownedOf(sim, ANIMAL_TRIBE_SHEEP), ...ownedOf(sim, ANIMAL_TRIBE_CATTLE)].filter(
          (e) => !sim.world.has(e, LivestockVisit),
        );
        return (
          claimed.length > 0 &&
          claimed.every((e) => {
            const cell = sim.world.tryGet(e, StayPoint)?.cell;
            if (cell === undefined) return false;
            const spot = terrain.coordsOf(cell);
            const distance = Math.abs(spot.x - at.x) + Math.abs(spot.y - at.y);
            // Beside the door, never IN the doorway - the spread that keeps the entrance clickable.
            return distance > 0 && distance <= systems.LIVESTOCK_GRAZE_RANGE_NODES;
          })
        );
      },
    },
    {
      label: 'the feed cycles produced wool, leather, and the meat byproduct',
      predicate: (sim) =>
        farmStock(sim, 'wool') >= 1 && farmStock(sim, 'leather') >= 1 && farmStock(sim, 'meat') >= 1,
    },
    {
      label: 'no claimed animal was drained under half its life pool',
      predicate: (sim) => {
        const claimed = [...ownedOf(sim, ANIMAL_TRIBE_SHEEP), ...ownedOf(sim, ANIMAL_TRIBE_CATTLE)];
        return claimed.every((e) => {
          const h = sim.world.tryGet(e, Health);
          return h !== undefined && h.hitpoints >= Math.floor(h.max / 2);
        });
      },
    },
    {
      label: 'the heart projection marks exactly the claimed animals and mirrors their life',
      predicate: (sim) => {
        // An animal inside the farm (a processing visit's Resting) is not drawn, so no heart either.
        const claimed = [...ownedOf(sim, ANIMAL_TRIBE_SHEEP), ...ownedOf(sim, ANIMAL_TRIBE_CATTLE)].filter(
          (e) => !sim.world.has(e, Resting),
        );
        const poolOf = new Map<number, { hitpoints: number; max: number }>();
        for (const e of claimed) {
          const h = sim.world.tryGet(e, Health);
          if (h === undefined) return false;
          poolOf.set(e, h);
        }
        const hearts = computeLivestockHearts(
          sim.snapshot(),
          (tribe) => systems.isCatchableAnimal(sim.content, tribe),
          undefined,
        );
        return (
          claimed.length > 0 &&
          hearts.length === claimed.length &&
          hearts.every((heart) => {
            const pool = poolOf.get(heart.id);
            return pool !== undefined && heart.life === pool.hitpoints / pool.max;
          })
        );
      },
    },
    {
      label: 'animals still wild at run end are unhurt (no drain without a claim)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Position)) {
          const tribe = sim.world.get(e, Settler).tribe;
          if (tribe !== ANIMAL_TRIBE_SHEEP && tribe !== ANIMAL_TRIBE_CATTLE) continue;
          if (sim.world.has(e, Owner)) continue;
          const h = sim.world.tryGet(e, Health);
          if (h === undefined || h.hitpoints < h.max) return false; // a wild animal was drained
        }
        return true;
      },
    },
  ],
};
