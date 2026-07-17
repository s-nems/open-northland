import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import {
  grassTerrain,
  placedBuildingTypes,
  resolveVikingBuilding,
  VIKING_BUILDINGS,
} from '../../catalog/buildings.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  placeFlag,
  placeResourceNode,
  placeSandboxBerryBush,
  placeSandboxBuilding,
  spawnBoundGatherer,
  staffBuildingFully,
} from '../../game/sandbox/index.js';
import { createSceneSim } from '../runtime.js';
import { yardGood } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';
import {
  initialUnits,
  producingCrewsComplete,
  remainingUnits,
  settlementFullyStaffed,
  warehousesFull,
} from './checks.js';
import {
  BERRY_BUSHES,
  BERRY_PATCH,
  BUSH_FRUITS_GFX,
  CAMPS,
  GATHERER_BY_GOOD,
  MINE_DEPOSIT_SCALE,
  VILLAGE,
  VILLAGE_TYPE_IDS,
  WAREHOUSE_IDS,
} from './placements.js';

const { Owner, Settler } = components;

/**
 * The main sandbox scene: a compact, fully staffed viking settlement over a resource-gathering base — the
 * production inspection world. The village carries the FULL viking catalog (all 41 building types, every
 * level of every chain) packed to the placement rule's limits, every building staffed to its worker
 * capacity, and all three warehouse tiers pre-filled to their limits; gathering camps hug the village
 * (a forest, a quarry, a clay pit, iron and gold outcrops, a mushroom grove), each with per-gatherer
 * delivery flags and good-pinned bindings. The scene defines only placement — content, rules, and
 * controls stay in `game/sandbox/`, `entries/scene.ts`, and `entries/map.ts`.
 */

const MAP_W = 96;
const MAP_H = 96;
const INITIAL_ZOOM = 0.5;
/** Enough for the slowest first delivery — a mined unit (clay: 6 strikes × 23-tick digs + rests) dug,
 *  carried to its flag, and banked — with headroom for the walk from every camp's spawn. */
const RUN_TICKS = 2400;

function buildVillage(sim: Simulation): void {
  for (const b of VILLAGE) {
    placeSandboxBuilding(sim, b.id, b.x, b.y, HUMAN_PLAYER, {
      fillStock: WAREHOUSE_IDS.has(b.id),
    });
    staffBuildingFully(sim, resolveVikingBuilding(b.id).typeId, b.x, b.y);
  }
}

function buildResourceBase(sim: Simulation): void {
  for (const camp of CAMPS) {
    const g = GATHERER_BY_GOOD.get(camp.good);
    if (g === undefined) throw new Error(`sandbox camp: no gatherer trade for good ${camp.good}`);
    for (const { dx, dy } of camp.nodes) {
      placeResourceNode(sim, g, camp.center.x + dx, camp.center.y + dy, {
        unitsScale: g.mode === 'mine' ? MINE_DEPOSIT_SCALE : 1,
      });
    }
    // One flag per gatherer (the flag-click selection inverse is 1:1 — a flag resolves to its one
    // gatherer), planted in a short row on the camp's village side; each gatherer works only this camp
    // (radius + good filter) and banks its harvest at its own flag (see spawnBoundGatherer).
    for (let i = 0; i < camp.gatherers; i++) {
      const flag = placeFlag(sim, camp.flag.x + i, camp.flag.y);
      spawnBoundGatherer(sim, g.job, camp.flag.x + i, camp.flag.y + 1, flag, { goodType: camp.good });
    }
  }
  for (let i = 0; i < BERRY_BUSHES; i++) {
    placeSandboxBerryBush(sim, BERRY_PATCH.x + i * 2, BERRY_PATCH.y + (i % 2), BUSH_FRUITS_GFX);
  }
}

function build(sim: Simulation): void {
  buildVillage(sim);
  buildResourceBase(sim);
}

export const sandboxScene: SceneDefinition = {
  id: 'sandbox',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the full viking building catalog is placed (every type, every level)',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return (
          [...VILLAGE_TYPE_IDS].every((t) => placed.has(t)) &&
          placed.size === VILLAGE_TYPE_IDS.size &&
          placed.size === VIKING_BUILDINGS.length
        );
      },
    },
    {
      label: 'every warehouse tier is seeded full at placement (fresh 2-tick run of the same build)',
      predicate: () => {
        // The end-of-run world is the wrong witness (production legitimately consumes the stores), so the
        // full-at-start claim is proven on a fresh sim of the same scene advanced just past its placement
        // commands. Deterministic and sandbox-content only, like the whole headless twin.
        const fresh = createSceneSim(sandboxScene);
        fresh.run(2);
        return warehousesFull(fresh);
      },
    },
    {
      label: 'every staffable worker slot in the settlement is filled',
      predicate: settlementFullyStaffed,
    },
    {
      label: 'every producing workshop holds its full non-carrier crew',
      predicate: producingCrewsComplete,
    },
    {
      label: 'every gathering camp is being worked (its nodes are partly consumed)',
      // Node depletion is the harvest witness — the banked heaps are the wrong one, because the village
      // carriers legitimately haul them off to the stores as part of the living economy.
      predicate: (sim) => CAMPS.every((camp) => remainingUnits(sim, camp.good) < initialUnits(camp)),
    },
    {
      label: 'some harvest reached the ground heaps or moved on into the stores',
      predicate: (sim) => CAMPS.some((camp) => yardGood(sim, camp.good) > 0),
    },
    {
      label: 'every settler belongs to the blue human player (no hostiles on the map)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Owner)) {
          if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) return false;
        }
        return true;
      },
    },
  ],
};
