import { components, type MissionScript, type Simulation, SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_COIN,
  GOOD_STONE,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The tributes a map script demands and the diplomacy window's pay button: the neighbour asks for
 * timber and stone, which one warehouse holds, for a purse of coins, which nobody does, and for stone
 * that lies split between the two warehouses. The timber tribute lists as payable and paying it turns
 * the neighbour friendly; the coins stay listed and dead; the split stone stays dead with its note.
 * The browser view pairs this with the diplomacy window on the tool panel.
 */

const MAP_W = 24;
const MAP_H = 12;

/** The neighbour the tributes go to, standing in plain sight so the window lists it. */
const NEIGHBOUR_PLAYER = 1;

const HUMAN_AT = { x: 6, y: 6 } as const;
const NEIGHBOUR_AT = { x: 16, y: 6 } as const;
const WAREHOUSE_AT = { x: 9, y: 4 } as const;
const SECOND_WAREHOUSE_AT = { x: 13, y: 4 } as const;

/** The two tribute slots the script opens, and their descriptions in the scene's own string table. */
export const TIMBER_TRIBUTE = 0;
const COINS_TRIBUTE = 1;
const ROAD_TRIBUTE = 2;
const TIMBER_TEXT = 1;
const COINS_TEXT = 2;
const ROAD_TEXT = 3;

/** The demands, and what the warehouses hold against them: enough timber and stone in the first,
 *  too few coins anywhere, and the road's stone only between the two. */
const TIMBER_DEMAND = 6;
const STONE_DEMAND = 2;
const COINS_DEMAND = 20;
const ROAD_STONE_DEMAND = 5;
const WOOD_STOCKED = 8;
const STONE_STOCKED = 3;
const COINS_STOCKED = 5;
const SECOND_STONE_STOCKED = 3;

/** Past the first pass, which opens the tributes, with one more pass to spare. */
const RUN_TICKS = 2 * systems.MISSION_EVALUATION_TICKS;

const { setStockAmount } = components;

/** Mission 0 opens both tributes at once; mission 1 turns the neighbour friendly once the timber is paid. */
const missions: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [],
      results: [
        {
          opcode: 'CreateTribute',
          slot: TIMBER_TRIBUTE,
          player: HUMAN_PLAYER,
          otherPlayer: NEIGHBOUR_PLAYER,
          stringId: TIMBER_TEXT,
        },
        { opcode: 'AddTributeGoods', slot: TIMBER_TRIBUTE, good: GOOD_WOOD, amount: TIMBER_DEMAND },
        { opcode: 'AddTributeGoods', slot: TIMBER_TRIBUTE, good: GOOD_STONE, amount: STONE_DEMAND },
        {
          opcode: 'CreateTribute',
          slot: COINS_TRIBUTE,
          player: HUMAN_PLAYER,
          otherPlayer: NEIGHBOUR_PLAYER,
          stringId: COINS_TEXT,
        },
        { opcode: 'AddTributeGoods', slot: COINS_TRIBUTE, good: GOOD_COIN, amount: COINS_DEMAND },
        {
          opcode: 'CreateTribute',
          slot: ROAD_TRIBUTE,
          player: HUMAN_PLAYER,
          otherPlayer: NEIGHBOUR_PLAYER,
          stringId: ROAD_TEXT,
        },
        { opcode: 'AddTributeGoods', slot: ROAD_TRIBUTE, good: GOOD_STONE, amount: ROAD_STONE_DEMAND },
      ],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [{ opcode: 'PayTribute', slot: TIMBER_TRIBUTE }],
      results: [
        { opcode: 'SetDiplomacy', player: NEIGHBOUR_PLAYER, otherPlayer: HUMAN_PLAYER, state: 'friend' },
        { opcode: 'SetDiplomacy', player: HUMAN_PLAYER, otherPlayer: NEIGHBOUR_PLAYER, state: 'friend' },
      ],
    },
  ],
};

function build(sim: Simulation): void {
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, HUMAN_AT.x, HUMAN_AT.y, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, NEIGHBOUR_AT.x, NEIGHBOUR_AT.y, NEIGHBOUR_PLAYER);
  const store = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    WAREHOUSE_AT.x,
    WAREHOUSE_AT.y,
    HUMAN_PLAYER,
  );
  setStockAmount(sim.world, store, GOOD_WOOD, WOOD_STOCKED);
  setStockAmount(sim.world, store, GOOD_STONE, STONE_STOCKED);
  setStockAmount(sim.world, store, GOOD_COIN, COINS_STOCKED);
  const second = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    SECOND_WAREHOUSE_AT.x,
    SECOND_WAREHOUSE_AT.y,
    HUMAN_PLAYER,
  );
  setStockAmount(sim.world, second, GOOD_STONE, SECOND_STONE_STOCKED);
  // Neutral both ways, so the friendship the paid tribute buys is a visible change.
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: NEIGHBOUR_PLAYER, state: 'neutral' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR_PLAYER, to: HUMAN_PLAYER, state: 'neutral' });
}

export const tributeScene: SceneDefinition = {
  id: 'tribute',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the script opened both tributes to the neighbour, the timber one payable out of the warehouse',
      predicate: (sim) => {
        const owed = sim.openTributes(HUMAN_PLAYER);
        const timber = owed.find((t) => t.slot === TIMBER_TRIBUTE);
        return (
          owed.length === 3 &&
          owed.every((t) => t.receiver === NEIGHBOUR_PLAYER) &&
          timber?.payable === true &&
          timber.demands.every((d) => d.onHand >= d.amount)
        );
      },
    },
    {
      label: 'the purse of coins is listed but short, so it cannot be paid',
      predicate: (sim) => {
        const coins = sim.openTributes(HUMAN_PLAYER).find((t) => t.slot === COINS_TRIBUTE);
        return coins?.payable === false && coins.demands.some((d) => d.onHand < d.amount);
      },
    },
    {
      label:
        'the stone for the road lies split between the two warehouses, held in sum and payable by neither',
      predicate: (sim) => {
        const road = sim.openTributes(HUMAN_PLAYER).find((t) => t.slot === ROAD_TRIBUTE);
        return road?.payable === false && road.demands.every((d) => d.onHand >= d.amount);
      },
    },
    {
      label: 'nothing is paid until the player pays: the neighbour stays neutral',
      predicate: (sim) => sim.diplomacyStance(NEIGHBOUR_PLAYER, HUMAN_PLAYER) === 'neutral',
    },
  ],
};
