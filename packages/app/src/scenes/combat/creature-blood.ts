import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  MONSTER_TRIBE_DRAGON,
  MONSTER_TRIBE_WERESNAKE,
  MONSTER_TRIBE_WEREWOLF,
} from '../../catalog/creatures.js';
import { JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../../catalog/jobs.js';
import { spawnSettlerAtNode } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const ENDURANCE = 1_000_000;
const SUBJECTS = [
  { tribe: 1, jobType: JOB_SOLDIER_UNARMED },
  { tribe: MONSTER_TRIBE_WEREWOLF, jobType: JOB_SOLDIER_UNARMED },
  { tribe: MONSTER_TRIBE_WERESNAKE, jobType: JOB_SOLDIER_UNARMED },
  { tribe: MONSTER_TRIBE_DRAGON, jobType: JOB_SOLDIER_UNARMED },
];

function build(sim: Simulation): void {
  for (const [column, subject] of SUBJECTS.entries()) {
    const node = cellAnchorNode(4 + column * 5, 9);
    const target = systems.createSettler(
      sim.world,
      sim.content,
      sim.rng,
      { ...subject, owner: 2, x: node.hx + 1, y: node.hy },
      sim.names,
    );
    if (target === null) throw new Error('Missing creature blood subject');
    const attacker = spawnSettlerAtNode(sim, JOB_SOLDIER_SWORD, node, 0);
    for (const entity of [attacker, target]) {
      // Keep the comparison running without inflating the HP reference used by visible wounds.
      sim.world.mut(entity, components.Health).hitpoints = ENDURANCE;
      sim.world.mut(entity, components.Stance).mode = systems.MILITARY_MODE.IGNORE;
    }
    components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

export const creatureBloodScene: SceneDefinition = {
  id: 'creature-blood',
  seed: 84,
  terrain: grassTerrain(25, 19),
  graphicTribes: [1, MONSTER_TRIBE_WEREWOLF, MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_DRAGON],
  initialZoom: 1.25,
  build,
  runTicks: 240,
  checks: [
    {
      label: 'all four subjects take wounds while keeping their maximum health',
      predicate: (sim) => {
        const subjects = [...sim.world.query(components.Settler, components.Owner, components.Health)].filter(
          (e) => sim.world.get(e, components.Owner).player === 2,
        );
        return (
          subjects.length === 4 &&
          subjects.every((e) => {
            const hp = sim.world.get(e, components.Health);
            const pool = sim.content.tribes.find(
              (t) => t.typeId === sim.world.get(e, components.Settler).tribe,
            )?.monster?.hitpoints;
            return hp.hitpoints > 0 && hp.hitpoints < ENDURANCE && (pool === undefined || hp.max === pool);
          })
        );
      },
    },
  ],
};
