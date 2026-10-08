import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerAtNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Health, Owner, Stance } = components;
const DUEL_JOBS = [JOB_SOLDIER_SWORD, JOB_SOLDIER_SPEAR, JOB_SOLDIER_UNARMED, JOB_ARCHER];
const ENDURANCE = 1_000_000;

function build(sim: Simulation): void {
  for (const [i, job] of [...DUEL_JOBS, JOB_SOLDIER_SWORD].entries()) {
    const from = cellAnchorNode(i < 3 ? 6 : 11, i < 3 ? 5 + i * 4 : 5 + (i - 3) * 8);
    const target = spawnSettlerAtNode(
      sim,
      JOB_SOLDIER_UNARMED,
      {
        hx: from.hx + (job === JOB_ARCHER ? 7 : 1),
        hy: from.hy,
      },
      ENEMY_PLAYER,
    );
    const attacker = spawnSettlerAtNode(sim, job, from, HUMAN_PLAYER);
    for (const unit of [attacker, target]) {
      const health = sim.world.mut(unit, Health);
      health.hitpoints = health.max = ENDURANCE;
      sim.world.mut(unit, Stance).mode = systems.MILITARY_MODE.IGNORE;
    }
    components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    if (i === DUEL_JOBS.length) sim.world.mut(target, Health).hitpoints = 1;
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

export const combatBloodScene: SceneDefinition = {
  id: 'combat-blood',
  seed: 83,
  terrain: grassTerrain(21, 20),
  build,
  initialZoom: 1.5,
  runTicks: 240,
  checks: [
    {
      label: 'four weapon trials keep landing hits while the fatal trial leaves one casualty',
      predicate: (sim) => {
        let wounded = 0;
        let survivors = 0;
        for (const e of sim.world.query(Health, Owner)) {
          if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
          survivors++;
          const hp = sim.world.get(e, Health).hitpoints;
          if (hp > 0 && hp < ENDURANCE) wounded++;
        }
        return survivors === DUEL_JOBS.length && wounded === DUEL_JOBS.length;
      },
    },
  ],
};
