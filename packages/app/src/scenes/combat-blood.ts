import { cellAnchorNode, components, positionOfNode, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_02,
  GATHERERS,
  GOOD_STONE,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  placeResourceNode,
  placeSandboxBerryBush,
  spawnSettlerAtNode,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Health, Owner, Stance } = components;
const DUEL_JOBS = [JOB_SOLDIER_SWORD, JOB_SOLDIER_SPEAR, JOB_SOLDIER_UNARMED, JOB_ARCHER];
const ENDURANCE = 1_000_000;

function build(sim: Simulation): void {
  for (const [good, y] of [
    [GOOD_STONE, 5],
    [GOOD_WOOD, 9],
  ] as const) {
    const resource = GATHERERS.find((g) => g.good === good);
    if (resource !== undefined) placeResourceNode(sim, resource, 7, y);
  }
  sim.enqueueSetup({ kind: 'dropGood', good: GOOD_WOOD, x: 14, y: 26, amount: 5 });
  placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_02, 13, 10, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_02, 13, 18, HUMAN_PLAYER);
  placeSandboxBerryBush(sim, 15, 5);
  const bones = sim.world.create();
  sim.world.add(bones, components.Position, positionOfNode(14, 18));
  sim.world.add(bones, components.BonePile, { hx: 14, hy: 18, tick: 0 });
  for (const [i, job] of [...DUEL_JOBS, JOB_SOLDIER_SWORD, JOB_SOLDIER_SWORD, JOB_SOLDIER_SWORD].entries()) {
    const from =
      i === 6 ? { hx: 26, hy: 40 } : cellAnchorNode(i < 3 ? 6 : 11, i < 3 ? 5 + i * 4 : 5 + (i - 3) * 4);
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
      // Extra endurance keeps the comparison running; the normal max still sizes visible wounds.
      health.hitpoints = ENDURANCE;
      sim.world.mut(unit, Stance).mode = systems.MILITARY_MODE.IGNORE;
    }
    components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    if (i === DUEL_JOBS.length + 1) sim.world.mut(target, Health).hitpoints = 1;
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

export const combatBloodScene: SceneDefinition = {
  id: 'combat-blood',
  seed: 83,
  terrain: grassTerrain(21, 25),
  build,
  initialZoom: 1.5,
  runTicks: 240,
  stages: [
    { id: 'objects', focus: { x: 9, y: 9 }, zoom: 1.5, actions: [] },
    { id: 'behind', focus: { x: 13, y: 9 }, zoom: 2, actions: [] },
    { id: 'front', focus: { x: 13, y: 19 }, zoom: 2, actions: [] },
  ],
  checks: [
    {
      label: 'loose wood remains beside the fist trial',
      predicate: (sim) =>
        [...sim.world.query(components.Stockpile, components.Position)].some(
          (entity) =>
            !sim.world.has(entity, components.Building) &&
            (sim.world.get(entity, components.Stockpile).amounts.get(GOOD_WOOD) ?? 0) > 0,
        ),
    },
    {
      label: 'six weapon trials keep landing hits while the fatal trial leaves one casualty',
      predicate: (sim) => {
        let wounded = 0;
        let survivors = 0;
        for (const e of sim.world.query(Health, Owner)) {
          if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
          survivors++;
          const hp = sim.world.get(e, Health).hitpoints;
          if (hp > 0 && hp < ENDURANCE) wounded++;
        }
        return survivors === DUEL_JOBS.length + 2 && wounded === DUEL_JOBS.length + 2;
      },
    },
  ],
};
