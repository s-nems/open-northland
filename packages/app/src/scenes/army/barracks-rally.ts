import {
  components,
  type Entity,
  hexDistanceBetween,
  MILITARY_ROW_SPACING,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CIVILIST } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Equipment, MoveGoal, PathFollow, Position, Settler, Stance, setStockAmount } = components;

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 12, y: 5 } as const;
/** The flag on open grass below the barracks, a half-cell node, in the view the recruits' row opens on. */
const FLAG = { hx: 26, hy: 20 } as const;
const DRILLED = 5;
/** Recruits the assistant books for a sword, fetched from the headquarters before the walk to the flag. */
const ARMED = 3;
const FIRST_RECRUIT_X = 7;
const RECRUIT_ROW_Y = 9;
/** No soldier stands farther from the flag than the second ring of the formation, in hex nodes. */
const FORMATION_REACH_NODES = 2 * MILITARY_ROW_SPACING;

const SWORD_SHORT = 'sword_shord'; // the content's own spelling

/** The drills (~400 ticks each, shared seats), the armed recruits' outing and the walks to the flag. */
const RUN_TICKS = 2400;

function build(sim: Simulation): void {
  const headquarters = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  setStockAmount(sim.world, headquarters, goodBySlug(sim, SWORD_SHORT), ARMED);
  const barracks = placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  sim.enqueueSetup({ kind: 'setRallyPoint', building: barracks, x: FLAG.hx, y: FLAG.hy });
  for (let i = 0; i < DRILLED + ARMED; i++) {
    const recruit = spawnSettlerDirect(sim, JOB_CIVILIST, FIRST_RECRUIT_X + 2 * i, RECRUIT_ROW_Y);
    if (i < DRILLED) sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house: barracks });
  }
  sim.enqueueSetup({
    kind: 'setAssistantCounter',
    player: HUMAN_PLAYER,
    counter: 'trainSword',
    value: ARMED,
    infinite: false,
  });
}

function recruits(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)];
}

/** The half-cell node `e` stands on. */
function standingAt(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const p = sim.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

export const barracksRallyScene: SceneDefinition = {
  id: 'barracks-rally',
  seed: 29,
  terrain: grassTerrain(24, 16),
  initialZoom: 1.5,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'five recruits drilled by hand and three the assistant armed with swords walk out soldiers',
      predicate: (sim) => {
        const units = recruits(sim);
        return (
          units.length === DRILLED + ARMED &&
          units.every((e) => systems.isFighterJob(sim.content, sim.world.get(e, Settler).jobType)) &&
          units.filter((e) => (sim.world.tryGet(e, Equipment)?.weapon ?? null) !== null).length === ARMED
        );
      },
    },
    {
      label: 'and stand in ranks a cell apart around the flag, one to a place, instead of crowding onto it',
      predicate: (sim) => {
        const places = recruits(sim).map((e) => standingAt(sim, e));
        return (
          new Set(places.map(({ hx, hy }) => `${hx},${hy}`)).size === places.length &&
          places.every(
            ({ hx, hy }) =>
              Math.abs(hy - FLAG.hy) % MILITARY_ROW_SPACING === 0 &&
              hexDistanceBetween(hx, hy, FLAG.hx, FLAG.hy) <= FORMATION_REACH_NODES,
          )
        );
      },
    },
    {
      label: 'each a DEFEND guard settled on his own place, which is his anchor',
      predicate: (sim) =>
        recruits(sim).every((e) => {
          const terrain = sim.terrain;
          if (terrain === undefined || sim.world.has(e, MoveGoal) || sim.world.has(e, PathFollow))
            return false;
          const stance = sim.world.get(e, Stance);
          const { hx, hy } = standingAt(sim, e);
          return stance.mode === systems.MILITARY_MODE.DEFEND && stance.anchorCell === terrain.nodeAt(hx, hy);
        }),
    },
  ],
};
