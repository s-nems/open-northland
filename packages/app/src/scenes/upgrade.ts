import type { Entity, Simulation } from '@open-northland/sim';
import { components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  buildingDef,
  JOB_BUILDER,
  JOB_COLLECTOR,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import { buildingOfType } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The building-upgrade scene: the `upgradeBuilding` command re-opens a built level-1 home as a
 * construction site (its old body keeps standing, the plot washes grey, housing suspends), a builder
 * fetches the level DIFFERENCE — the next tier's own bill, not the cumulative from-scratch cost —
 * from the pre-stocked headquarters and hammers the site out, and the home finishes as the level-2
 * tier with its inventory intact.
 *
 * Headless proves the mechanic (tier adopted, markers gone, exactly the difference bill drawn from the
 * HQ); the browser is where a human selects the OTHER, untouched home, clicks its Upgrade button above
 * Demolish, and watches the new tier's body materialise over the standing old one.
 */

const MAP_W = 26;
const MAP_H = 18;
const HQ = { x: 9, y: 6 } as const;
/** The scene-driven home — upgraded by a build-time command. */
const UPGRADED_HOME = { x: 14, y: 6 } as const;
/** A second home left untouched, so the human exercises the Upgrade button on it in the browser. */
const BUTTON_HOME = { x: 20, y: 11 } as const;
const BUILDER = { x: 12, y: 7 } as const;
/** An idle collector (no resources on the grass to gather): the real viking tech graph gates the home
 *  tiers on the collector's presence (`jobEnablesHouse 8`), so without one the browser run — which
 *  plays this scene on real content — would skip the `upgradeBuilding` command at the tech gate. */
const COLLECTOR = { x: 7, y: 9 } as const;
/** The L0→L1 difference is the sandbox L1 parcel (4 wood + 3 stone = 7 units): the lone builder
 *  alternates one HQ fetch trip and ~26 hammer strikes per unit (~1k ticks a unit observed), so the
 *  budget leaves slack past the measured full run. */
const RUN_TICKS = 10_000;

const { Building, Stockpile, UnderConstruction, Upgrading } = components;

const NEXT_TIER = BUILDING_HOME_00 + 1;

function build(sim: Simulation): void {
  // The material source: a pre-stocked HQ (every slot at capacity) the builder self-supplies from.
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  // The upgrading home is placed directly (scene setup) so its entity id can seed the build-time
  // upgrade command; the second home goes through the normal command seam and stays level 1.
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, UPGRADED_HOME.x, UPGRADED_HOME.y);
  placeSandboxBuilding(sim, BUILDING_HOME_00, BUTTON_HOME.x, BUTTON_HOME.y, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_BUILDER, BUILDER.x, BUILDER.y, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y, HUMAN_PLAYER);
  sim.enqueue({ kind: 'upgradeBuilding', building: home });
}

/** The upgraded home once the mechanic lands — the scene's single next-tier building — or null. */
function upgradedHome(sim: Simulation): Entity | null {
  return buildingOfType(sim, NEXT_TIER);
}

/** What the HQ is missing versus its filled capacity — the materials the upgrade drew out of it. */
function hqDrawnGoods(sim: Simulation): Map<number, number> {
  const drawn = new Map<number, number>();
  const def = buildingDef(sim, BUILDING_HEADQUARTERS);
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== BUILDING_HEADQUARTERS) continue;
    const amounts = sim.world.get(e, Stockpile).amounts;
    for (const slot of def?.stock ?? []) {
      const missing = slot.capacity - (amounts.get(slot.goodType) ?? 0);
      if (missing > 0) drawn.set(slot.goodType, missing);
    }
  }
  return drawn;
}

export const upgradeScene: SceneDefinition = {
  id: 'upgrade',
  seed: 4,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the commanded home adopted the next tier (level 2) and finished building',
      predicate: (sim) => {
        const e = upgradedHome(sim);
        if (e === null) return false;
        const b = sim.world.get(e, Building);
        return b.level === 1 && b.built >= ONE;
      },
    },
    {
      label: 'the upgrade markers are gone — a finished building is a plain Building again',
      predicate: (sim) => {
        const e = upgradedHome(sim);
        return e !== null && !sim.world.has(e, UnderConstruction) && !sim.world.has(e, Upgrading);
      },
    },
    {
      label: 'the HQ paid exactly the level DIFFERENCE — the next tier own bill, no cumulative surcharge',
      predicate: (sim) => {
        const bill = buildingDef(sim, NEXT_TIER)?.construction ?? [];
        const drawn = hqDrawnGoods(sim);
        if (bill.length === 0 || drawn.size !== bill.length) return false;
        return bill.every((line) => drawn.get(line.goodType) === line.amount);
      },
    },
    {
      label: 'the second home is untouched (still level 1) — the browser Upgrade-button target',
      predicate: (sim) => {
        const e = buildingOfType(sim, BUILDING_HOME_00);
        if (e === null) return false;
        const b = sim.world.get(e, Building);
        return b.built >= ONE && b.level === 0;
      },
    },
  ],
};
