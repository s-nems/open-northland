import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { EAT_ATOMIC, SLEEP_ATOMIC } from '../catalog/atomics.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_CIVILIST, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerAtNode, spawnSettlerDirect } from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Health, Owner, Settler, Stance, addCurrentAtomic } = components;
const HITPOINTS = 1_000_000;
const DUEL_JOBS = [JOB_CIVILIST, JOB_SOLDIER_UNARMED, JOB_ARCHER, JOB_ARCHER_LONG];

function sturdy(sim: Simulation, e: Entity): Entity {
  const health = sim.world.mut(e, Health);
  health.hitpoints = HITPOINTS;
  health.max = HITPOINTS;
  return e;
}

function build(sim: Simulation): void {
  for (const [i, job] of DUEL_JOBS.entries()) {
    const from = cellAnchorNode(5, 4 + i * 5);
    const target = sturdy(
      sim,
      spawnSettlerAtNode(
        sim,
        JOB_SOLDIER_UNARMED,
        { hx: from.hx + (i < 2 ? 1 : 9), hy: from.hy },
        ENEMY_PLAYER,
      ),
    );
    sim.world.mut(target, Stance).mode = systems.MILITARY_MODE.IGNORE;
    // The slower civilian swing needs a passive target; repeated soldier blows otherwise interrupt it.
    if (job === JOB_CIVILIST) {
      components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    }
    const attacker = sturdy(sim, spawnSettlerAtNode(sim, job, from, HUMAN_PLAYER));
    if (job === JOB_CIVILIST) {
      // A civilian has no ordinary combat weapon; this demonstration explicitly gives him fists.
      const fists = sim.content.weapons.find(
        (weapon) => weapon.tribeType === 1 && weapon.jobType === JOB_SOLDIER_UNARMED,
      );
      if (fists === undefined) throw new Error('Missing unarmed soldier weapon');
      sim.world.add(attacker, components.Weapon, { weaponTypeId: fists.typeId });
    }
    sim.world.mut(attacker, Stance).mode = systems.MILITARY_MODE.ATTACK;
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
  // Resting archers stay beyond the duels' threat radius so their idle gestures remain visible.
  for (const [i, job] of [JOB_ARCHER, JOB_ARCHER_LONG].entries()) {
    const archer = spawnSettlerDirect(sim, job, 23 + i * 3, 7, HUMAN_PLAYER);
    sim.world.mut(archer, Stance).mode = systems.MILITARY_MODE.IGNORE;
  }
  for (const [i, atomicId] of [EAT_ATOMIC, SLEEP_ATOMIC].entries()) {
    const archer = spawnSettlerDirect(sim, JOB_ARCHER, 23 + i * 3, 13, HUMAN_PLAYER);
    sim.world.mut(archer, Stance).mode = systems.MILITARY_MODE.IGNORE;
    addCurrentAtomic(sim.world, archer, {
      atomicId,
      duration: atomicId === EAT_ATOMIC ? 120 : 300,
      effect:
        atomicId === EAT_ATOMIC
          ? { kind: 'eat', goodType: goodBySlug(sim, 'food_simple'), from: null }
          : { kind: 'sleep' },
      targetEntity: archer,
      targetTile: null,
    });
  }
}

export const combatGesturesScene: SceneDefinition = {
  id: 'combat-gestures',
  seed: 71,
  terrain: grassTerrain(32, 24),
  build,
  initialZoom: 0.75,
  runTicks: 720,
  checks: [
    {
      label: 'all four duels land blows while every participant survives',
      predicate: (sim) => {
        let woundedTargets = 0;
        for (const e of sim.world.query(Settler, Health, Owner)) {
          const health = sim.world.get(e, Health);
          if (health.hitpoints <= 0) return false;
          if (sim.world.get(e, Owner).player === ENEMY_PLAYER && health.hitpoints < HITPOINTS)
            woundedTargets++;
        }
        return woundedTargets === DUEL_JOBS.length;
      },
    },
  ],
};
