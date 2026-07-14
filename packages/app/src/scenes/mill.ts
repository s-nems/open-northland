import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  dropSandboxGood,
  GOOD_FLOUR,
  GOOD_WHEAT,
  JOB_MILLER_SLOT,
  placeSandboxBuilding,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The mill scene: prove the original's wheat→flour workshop end-to-end. A built mill employs two
 * millers who — through the generic producer drive, no mill-specific code — fetch wheat from the ground
 * piles beside the mill, grind each sheaf into flour, and haul the flour to the warehouse once the
 * mill's flour store fills. The store shape (wheat 10 in, flour 20 out) and the 200-tick grind are
 * extracted (`DataCnmd/types/houses.ini` "work mill 00"; `viking_miller_produce_flour` length 200);
 * the 1:1 amounts are a named approximation (no readable amount field). The headless half asserts the
 * loop closes (millers bound, wheat consumed, flour ground); the browser half is where a human judges
 * the rotor — a separate overlay sprite that stands still while the mill idles and spins while it
 * grinds — plus the panel (title „Młyn", the Produkcja recipe with a progress bar, the two-row
 * Magazyn: Pszenica x/10, Mąka x/20).
 */

const MAP_W = 32;
const MAP_H = 20;
const MILL_X = 14;
const MILL_Y = 10;
/** The flour sink beside the mill — where the millers haul finished flour once the mill's flour store
 *  fills. */
const WAREHOUSE_X = 21;
const WAREHOUSE_Y = 10;
/** Both extracted miller slots filled (`logicworker 19 2`) so the fetch/grind work parallelises. */
const MILLERS = 2;
/** The wheat resting on the ground beside the mill: three sheaf piles a short walk away, enough for
 *  many grind cycles (each cycle consumes 1 wheat). */
const WHEAT_PILES = [
  { x: 10, y: 8, amount: 5 },
  { x: 10, y: 12, amount: 5 },
  { x: 9, y: 10, amount: 5 },
] as const;
/** Long enough for several full cycles to close (fetch walks + store exchanges + the 200-tick grind
 *  per flour, two millers sharing the work), with margin. */
const RUN_TICKS = 2400;
/** Frames the mill + wheat piles + warehouse cluster. Deliberately ≠ 1: `cameraFor` only centres on
 *  the scene's settlers at a non-1 zoom, and this scene's action is at the map's centre. */
const INITIAL_ZOOM = 0.9;

const { Building, JobAssignment, Settler, Stockpile } = components;

/**
 * The mill's DOOR node — its anchor plus the content footprint's door offset. The millers spawn HERE
 * so the JobSystem's adopt pass binds them to the mill on tick 1 (a pre-employed settler standing at
 * a workplace it staffs is bound to it); resolved from the loaded content so the headless
 * (approximate footprint) and browser (real extracted footprint) doors both work.
 */
function millDoorNode(sim: Simulation): { hx: number; hy: number } {
  const anchor = cellAnchorNode(MILL_X, MILL_Y);
  const door = sim.content.buildings.find((b) => b.typeId === BUILDING_MILL)?.footprint?.door;
  return { hx: anchor.hx + (door?.dx ?? 0), hy: anchor.hy + (door?.dy ?? 0) };
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_MILL, MILL_X, MILL_Y);
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_X, WAREHOUSE_Y);
  for (const pile of WHEAT_PILES) dropSandboxGood(sim, GOOD_WHEAT, pile.x, pile.y, pile.amount);
  const door = millDoorNode(sim);
  for (let i = 0; i < MILLERS; i++) {
    sim.enqueue({
      kind: 'spawnSettler',
      jobType: JOB_MILLER_SLOT,
      x: door.hx,
      y: door.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
  }
}

/** The scene's one mill entity, or null before the placement command ran. */
function millEntity(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_MILL) return e;
  }
  return null;
}

/** Total units of one good across every stockpile in the world (building stores + ground piles). */
function totalOf(sim: Simulation, goodType: number): number {
  let total = 0;
  for (const e of sim.world.query(Stockpile)) {
    total += sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0;
  }
  return total;
}

/** All wheat the scene starts with (the dropped sheaf piles). */
const WHEAT_DROPPED = WHEAT_PILES.reduce((sum, p) => sum + p.amount, 0);

export const millScene: SceneDefinition = {
  id: 'mill',
  seed: 13,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'both millers are employed BY THE MILL (adopted + bound on tick 1)',
      predicate: (sim) => {
        const mill = millEntity(sim);
        if (mill === null) return false;
        let bound = 0;
        for (const e of sim.world.query(Settler, JobAssignment)) {
          if (sim.world.get(e, JobAssignment).workplace === mill) bound++;
        }
        return bound === MILLERS;
      },
    },
    {
      label: 'flour was ground (full cycles completed — fetch → grind → deposit)',
      predicate: (sim) => totalOf(sim, GOOD_FLOUR) > 0,
    },
    {
      label: 'wheat was consumed and never duplicated (each flour ate a sheaf)',
      predicate: (sim) => {
        // At the cutoff tick a sheaf may be IN FLIGHT (on a miller's back, or consumed at cycle
        // start with its flour not yet deposited), so stockpile totals alone can dip below the
        // dropped amount — assert consumption and the conservation CEILING, not exact equality.
        const wheat = totalOf(sim, GOOD_WHEAT);
        const flour = totalOf(sim, GOOD_FLOUR);
        return wheat < WHEAT_DROPPED && wheat + flour <= WHEAT_DROPPED;
      },
    },
    {
      label: 'no loose ground pile ever exceeds the per-tile engine cap (flour never dumps on a field)',
      predicate: (sim) => {
        // The engine's global per-tile limit (MAX_GROUND_STACK, 5): a loose heap — any positioned
        // stockpile that is not a building store — holds at most that many of any one good.
        for (const e of sim.world.query(Stockpile)) {
          if (sim.world.has(e, Building)) continue;
          for (const amount of sim.world.get(e, Stockpile).amounts.values()) {
            if (amount > systems.MAX_GROUND_STACK) return false;
          }
        }
        return true;
      },
    },
    {
      label: 'the mill stores ONLY wheat and flour (capacity 0 refuses everything else)',
      predicate: (sim) => {
        const mill = millEntity(sim);
        if (mill === null) return false;
        // The RUNTIME stockpile, not the content shape (that pin lives in sandbox-workers.test.ts):
        // after the whole run, nothing but wheat/flour may have been deposited into the mill — the
        // capacity gate (`stockCapacity` = 0 for an undeclared good) actually held.
        for (const [goodType, amount] of sim.world.get(mill, Stockpile).amounts) {
          if (amount > 0 && goodType !== GOOD_WHEAT && goodType !== GOOD_FLOUR) return false;
        }
        return true;
      },
    },
  ],
};
