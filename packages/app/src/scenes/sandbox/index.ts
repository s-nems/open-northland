import type { Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain, placedBuildingTypes, VIKING_BUILDINGS } from '../../catalog/buildings.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  placeFlag,
  placeResourceNode,
  placeSandboxBerryBush,
  spawnBoundGatherer,
  staffBuildingFully,
} from '../../game/sandbox/index.js';
import { createSceneSim, holdsSometimeDuring } from '../runtime.js';
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

const { Chat, Owner, Settler } = components;

const MAP_W = 96;
const MAP_H = 96;
/** The pitch between tiled settlement copies, on both axes: the scene map's extent, not the smaller
 *  extent of the authored content. */
export const SANDBOX_SETTLEMENT_PITCH = Math.max(MAP_W, MAP_H);
const INITIAL_ZOOM = 0.5;
/** Every persistent headless check passes by tick 825. Sample later while the idle crew has a live chat
 *  under the wider no-field zone around completed buildings. */
const RUN_TICKS = 1400;

function buildVillage(sim: Simulation, ox: number, oy: number): void {
  for (const b of VILLAGE) {
    const e = placeBuiltSandboxBuilding(sim, b.id, ox + b.x, oy + b.y, HUMAN_PLAYER, {
      fillStock: WAREHOUSE_IDS.has(b.id),
    });
    staffBuildingFully(sim, e);
  }
}

function buildResourceBase(sim: Simulation, ox: number, oy: number): void {
  for (const camp of CAMPS) {
    const g = GATHERER_BY_GOOD.get(camp.good);
    if (g === undefined) throw new Error(`sandbox camp: no gatherer trade for good ${camp.good}`);
    for (const { dx, dy } of camp.nodes) {
      placeResourceNode(sim, g, ox + camp.center.x + dx, oy + camp.center.y + dy, {
        unitsScale: g.mode === 'mine' ? MINE_DEPOSIT_SCALE : 1,
      });
    }
    // One flag per gatherer, so a flag click resolves to exactly one gatherer.
    for (let i = 0; i < camp.gatherers; i++) {
      const flag = placeFlag(sim, ox + camp.flag.x + i, oy + camp.flag.y);
      spawnBoundGatherer(sim, g.job, ox + camp.flag.x + i, oy + camp.flag.y + 1, flag, {
        goodType: camp.good,
      });
    }
  }
  for (let i = 0; i < BERRY_BUSHES; i++) {
    placeSandboxBerryBush(sim, ox + BERRY_PATCH.x + i * 2, oy + BERRY_PATCH.y + (i % 2), BUSH_FRUITS_GFX);
  }
}

/** `ox`/`oy` place the settlement's top-left tile; tiled copies must sit
 *  {@link SANDBOX_SETTLEMENT_PITCH} apart. */
export function buildSandboxSettlement(sim: Simulation, ox = 0, oy = 0): void {
  buildVillage(sim, ox, oy);
  buildResourceBase(sim, ox, oy);
}

function build(sim: Simulation): void {
  buildSandboxSettlement(sim);
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
        // The end-of-run world is the wrong witness, because production legitimately consumes the stores.
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
      // Banked heaps are the wrong witness, because carriers legitimately haul them off to the stores.
      predicate: (sim) => CAMPS.every((camp) => remainingUnits(sim, camp.good) < initialUnits(camp)),
    },
    {
      label: 'some harvest reached the ground heaps or moved on into the stores',
      predicate: (sim) => CAMPS.some((camp) => yardGood(sim, camp.good) > 0),
    },
    {
      label: 'bored crews chatter during the scene (gossip runs needs-off)',
      predicate: (sim) => {
        const chatting = (sample: Simulation): boolean => sample.world.query(Chat).next().done === false;
        return chatting(sim) || holdsSometimeDuring(sandboxScene, RUN_TICKS, chatting);
      },
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
