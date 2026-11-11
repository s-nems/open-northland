import type { HalfCellNode, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { spawnSettlerAtNode } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Health, Owner, Settler, Stance } = components;

/** A long sword strikes two nodes out, a short one the next node. */
const LONG_REACH_NODES = 2;
const SHORT_REACH_NODES = 1;
/** Duels to compare by ear: both Byzantine maces above, the Viking long sword's cut below. */
const DUELS = [
  { tribe: BYZANTINE, job: JOB_SOLDIER_BROADSWORD, reach: LONG_REACH_NODES, column: 4, row: 3 },
  { tribe: BYZANTINE, job: JOB_SOLDIER_SWORD, reach: SHORT_REACH_NODES, column: 4, row: 7 },
  { tribe: PRIMARY_TRIBE, job: JOB_SOLDIER_BROADSWORD, reach: LONG_REACH_NODES, column: 4, row: 11 },
] as const;
/** Both sides outlast the run, so the blows keep coming while the player listens. */
const HITPOINTS = 100_000;

function spawnSturdy(sim: Simulation, job: number, node: HalfCellNode, owner: number, tribe: number) {
  const e = spawnSettlerAtNode(sim, job, node, owner, tribe);
  const health = sim.world.mut(e, Health);
  health.hitpoints = HITPOINTS;
  health.max = HITPOINTS;
  return e;
}

function build(sim: Simulation): void {
  for (const { tribe, job, reach, column, row } of DUELS) {
    const at = cellAnchorNode(column, row);
    const target = spawnSturdy(
      sim,
      JOB_SOLDIER_SWORD,
      { hx: at.hx + reach, hy: at.hy },
      ENEMY_PLAYER,
      PRIMARY_TRIBE,
    );
    const stance = sim.world.mut(target, Stance);
    stance.mode = systems.MILITARY_MODE.IGNORE;
    stance.anchorCell = null;
    const attacker = spawnSturdy(sim, job, at, HUMAN_PLAYER, tribe);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

/** Every duel whose tribe the content arms for its job has struck its target. The fallback catalog
 *  arms only the Vikings, so there the Byzantines stand idle. */
function everyArmedDuelStruck(sim: Simulation): boolean {
  const armed = DUELS.filter(({ tribe, job }) =>
    sim.content.weapons.some((w) => w.tribeType === tribe && w.jobType === job),
  ).length;
  let struck = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
    if (sim.world.get(e, Health).hitpoints < HITPOINTS) struck++;
  }
  return armed > 0 && struck === armed;
}

export const maceBlowsScene: SceneDefinition = {
  id: 'mace-blows',
  seed: 47,
  terrain: grassTerrain(14, 16),
  graphicTribes: [PRIMARY_TRIBE, BYZANTINE],
  initialZoom: 2,
  runTicks: 200,
  build,
  checks: [{ label: 'every sword its tribe is armed with lands blows', predicate: everyArmedDuelStruck }],
};
