import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { CHEER_ATOMIC } from '../catalog/atomics.js';
import { grassTerrain } from '../catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerAtNode, spawnSettlerDirect } from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Carrying, CurrentAtomic, Health, Owner, Settler, Stance } = components;
const HITPOINTS = 1_000_000;
const DUEL_JOBS = [JOB_BUILDER, JOB_SOLDIER_UNARMED, JOB_ARCHER, JOB_ARCHER_LONG];

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
    if (job === JOB_BUILDER) {
      components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    }
    const attacker = sturdy(sim, spawnSettlerAtNode(sim, job, from, HUMAN_PLAYER));
    sim.world.mut(attacker, Stance).mode = systems.MILITARY_MODE.ATTACK;
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
  // Resting archers stay beyond the duels' threat radius so their idle gestures remain visible.
  for (const [i, job] of [JOB_ARCHER, JOB_ARCHER_LONG].entries()) {
    const archer = spawnSettlerDirect(sim, job, 23 + i * 3, 7, HUMAN_PLAYER);
    sim.world.mut(archer, Stance).mode = systems.MILITARY_MODE.IGNORE;
  }
  for (const [i, need] of (['hunger', 'fatigue'] as const).entries()) {
    const archer = spawnSettlerDirect(sim, JOB_ARCHER, 23 + i * 3, 13, HUMAN_PLAYER);
    sim.world.mut(archer, Stance).mode = systems.MILITARY_MODE.IGNORE;
    if (need === 'hunger')
      sim.world.add(archer, Carrying, { goodType: goodBySlug(sim, 'food_simple'), amount: 1 });
    sim.enqueueSetup({ kind: 'orderNeed', entity: archer, need });
  }
  const bride = spawnSettlerDirect(sim, JOB_WOMAN, 23, 19, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_CIVILIST, 24, 19, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_CIVILIST, 26, 19, HUMAN_PLAYER);
  sim.enqueueSetup({ kind: 'marry', entity: bride });
}

export const combatGesturesScene: SceneDefinition = {
  id: 'combat-gestures',
  seed: 71,
  needs: true,
  terrain: grassTerrain(32, 24),
  build,
  initialZoom: 0.75,
  runTicks: 720,
  checks: [
    {
      label: 'a nearby civilian celebrates the completed wedding',
      predicate: (sim) =>
        holdsSometimeDuring(combatGesturesScene, sim.tick, (probe) =>
          [...probe.world.query(CurrentAtomic)].some(
            (e) => probe.world.get(e, CurrentAtomic).atomicId === CHEER_ATOMIC,
          ),
        ),
    },
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
