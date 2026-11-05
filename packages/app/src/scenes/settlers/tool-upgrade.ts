import { components, type Entity, type Fixed, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Equipment, MISC_EQUIP_SLOTS, Settler, Stockpile, setStockAmount } = components;

const WIDTH = 26;
const HEIGHT = 16;
const HQ_AT = { x: 18, y: 8 } as const;
const WOODEN_TOOL = 'tool_wooden';
const IRON_TOOL = 'tool_iron';
/** One iron tool per wooden one held: every worker ends with iron. */
const IRON_IN_STORE = 3;
/** The workers' tools: two part-used wooden ones, one fresh, and one already iron. */
const WORKERS = [
  { x: 4, y: 5, tool: WOODEN_TOOL, worn: true },
  { x: 4, y: 8, tool: WOODEN_TOOL, worn: true },
  { x: 4, y: 11, tool: WOODEN_TOOL, worn: false },
  { x: 7, y: 8, tool: IRON_TOOL, worn: false },
] as const;
/** A quarter of the rated uses spent. */
const PART_USED = fx.div(fx.fromInt(1), fx.fromInt(4));
/** The fresh wooden tool, stowed back into the store by the take-off rule. */
const WOODEN_STOWED = 1;
/** Long enough for the slowest upgrade beat, the walk to the store and the walk back. */
const RUN_TICKS = 900;

function wearTool(sim: Simulation, e: Entity, slug: string, degreeOfUse: Fixed): void {
  sim.world.add(e, Equipment, {
    boots: null,
    tool: { goodType: goodBySlug(sim, slug), degreeOfUse },
    weapon: null,
    armor: null,
    misc: new Array(MISC_EQUIP_SLOTS).fill(null),
  });
}

function collectors(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === JOB_COLLECTOR);
}

function storeHeld(sim: Simulation, slug: string): number {
  let held = 0;
  for (const e of sim.world.query(Stockpile))
    held += sim.world.get(e, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
  return held;
}

/**
 * The assistant's "replace wooden ones" switch with both tools handed out: three collectors holding
 * wooden tools walk to the headquarters for its three iron ones. The part-used wooden tools are lost in the
 * swap, the fresh one goes back into the store, and the collector already holding iron stays put.
 */
export const toolUpgradeScene: SceneDefinition = {
  id: 'tool-upgrade',
  seed: 73,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y);
    setStockAmount(sim.world, hq, goodBySlug(sim, IRON_TOOL), IRON_IN_STORE);
    for (const { x, y, tool, worn } of WORKERS) {
      const worker = spawnSettlerDirect(sim, JOB_COLLECTOR, x, y, HUMAN_PLAYER);
      wearTool(sim, worker, tool, worn ? PART_USED : fx.fromInt(0));
    }
    for (const slug of [WOODEN_TOOL, IRON_TOOL]) {
      sim.enqueueSetup({
        kind: 'setAssistantGrant',
        player: HUMAN_PLAYER,
        goodType: goodBySlug(sim, slug),
        enabled: true,
      });
    }
    sim.enqueueSetup({ kind: 'setAssistantUpgradeTools', player: HUMAN_PLAYER, enabled: true });
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'every collector holds an iron tool',
      predicate: (sim) =>
        collectors(sim).every(
          (e) => sim.world.tryGet(e, Equipment)?.tool?.goodType === goodBySlug(sim, IRON_TOOL),
        ),
    },
    {
      label: 'the fresh wooden tool is back in the store and the part-used ones are gone',
      predicate: (sim) => storeHeld(sim, WOODEN_TOOL) === WOODEN_STOWED && storeHeld(sim, IRON_TOOL) === 0,
    },
  ],
};
