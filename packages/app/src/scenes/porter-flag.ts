import {
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  dropSandboxGood,
  GATHERERS,
  GOOD_STONE,
  placeBuiltSandboxBuilding,
  placeFlag,
  placeResourceNode,
  spawnBoundGatherer,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 40;
const HEIGHT = 20;
const HQ_AT = { x: 6, y: 10 } as const;
/** The quarry far east of the settlement: the deposit and the miner's yard beside it. */
const QUARRY_AT = { x: 32, y: 9 } as const;
const MINER_FLAG_AT = { x: 30, y: 11 } as const;
/** Where the player planted the first porter's pickup flag, beside the miner's yard. */
const PORTER_FLAG_AT = { x: 29, y: 12 } as const;
/** A heap beside the headquarters, outside the porter's flag area, which it must leave lying. */
const NEAR_PILE_AT = { x: 9, y: 13 } as const;
const NEAR_PILE_STONE = 2;
/** Half-cell nodes around the near heap's tile its units may land on. */
const NEAR_PILE_REACH = 4;
/** Long enough for the miner to stack stone at his yard and the flagged porter to bring some home. */
const RUN_TICKS = 6000;

const STONE = GATHERERS.find((g) => g.good === GOOD_STONE);

function headquarters(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(components.Building)) {
    if (sim.world.get(e, components.Building).buildingType === BUILDING_HEADQUARTERS) return e;
  }
  return undefined;
}

function bankedStone(sim: Simulation): number {
  const hq = headquarters(sim);
  if (hq === undefined) return 0;
  return sim.world.tryGet(hq, components.Stockpile)?.amounts.get(GOOD_STONE) ?? 0;
}

/** Loose stone lying within a few nodes of tile `at`. */
function looseStoneNear(sim: Simulation, at: { x: number; y: number }): number {
  const anchor = cellAnchorNode(at.x, at.y);
  let stone = 0;
  for (const e of sim.world.query(components.Stockpile, components.Position)) {
    if (sim.world.has(e, components.Building)) continue;
    const p = nodeOfPosition(
      sim.world.get(e, components.Position).x,
      sim.world.get(e, components.Position).y,
    );
    if (Math.abs(p.hx - anchor.hx) + Math.abs(p.hy - anchor.hy) > NEAR_PILE_REACH) continue;
    stone += sim.world.get(e, components.Stockpile).amounts.get(GOOD_STONE) ?? 0;
  }
  return stone;
}

/**
 * A stone miner works a quarry far east of the headquarters and stacks his stone at his yard. The
 * headquarters porter holds a pickup flag beside that yard: he carries the quarry's stone home, leaves the
 * heap beside the headquarters alone, and waits at the flag once nothing lies there.
 */
export const porterFlagScene: SceneDefinition = {
  id: 'porter-flag',
  seed: 72,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    if (STONE === undefined) throw new Error('porter-flag: no stone gatherer spec');
    placeResourceNode(sim, STONE, QUARRY_AT.x, QUARRY_AT.y);
    const minerFlag = placeFlag(sim, MINER_FLAG_AT.x, MINER_FLAG_AT.y);
    spawnBoundGatherer(sim, STONE.job, MINER_FLAG_AT.x, MINER_FLAG_AT.y + 1, minerFlag, {
      goodType: GOOD_STONE,
    });
    const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y, HUMAN_PLAYER);
    spawnWorkersAtDoor(sim, hq, 1, { jobType: JOB_CARRIER });
    dropSandboxGood(sim, GOOD_STONE, NEAR_PILE_AT.x, NEAR_PILE_AT.y, NEAR_PILE_STONE);
    const [porter] = sim.world.query(components.JobAssignment);
    if (porter === undefined) throw new Error('porter-flag: no porter');
    const flag = cellAnchorNode(PORTER_FLAG_AT.x, PORTER_FLAG_AT.y);
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: porter, x: flag.hx, y: flag.hy });
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the porter holds a pickup flag',
      predicate: (sim) => [...sim.world.query(components.HaulFlag)].length === 1,
    },
    {
      label: 'the heap beside the headquarters stays where it lies',
      predicate: (sim) => looseStoneNear(sim, NEAR_PILE_AT) === NEAR_PILE_STONE,
    },
    {
      label: 'stone from the quarry reaches the headquarters',
      predicate: (sim) => bankedStone(sim) > 0,
    },
  ],
};
