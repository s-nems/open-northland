import {
  cellAnchorNode,
  components,
  type Entity,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_TEMPLE,
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSandboxSettlerDirect,
  spawnSettlerDirect,
  WEAPON_SWORD,
} from '../../game/sandbox/index.js';
import { buildingTypeOf, ownerPlayerOf } from '../../game/snapshot/base.js';
import { holdsSometimeDuring } from '../runtime.js';
import { buildingOfType, membersOf } from '../sandbox-queries.js';
import type { SceneDefinition, StageOrder } from '../types.js';

/**
 * A player's attack order is a focus: blue archers sent at a red temple shoot the temple and nothing else,
 * though red swordsmen stand in their path and a manned tower shoots at them. The stage buttons repeat the
 * focus, send the same archers as an attack-move onto the temple, so they fight the defenders first, and
 * pull them back out, which they obey at once.
 */

const MAP_W = 36;
const MAP_H = 16;

/** Far out of the tower's and the picket's reach, so a pull-back here ends the fight. */
const ARCHER_X = 3;
const ARCHER_ROWS: readonly number[] = [5, 6, 7, 8, 9, 10];
const TEMPLE = { x: 25, y: 8 } as const;
const TOWER = { x: 22, y: 4 } as const;
const TOWER_ARCHERS: readonly (readonly [number, number])[] = [
  [24, 3],
  [24, 5],
];
/** Beside the archers' way to the temple, inside their bow's reach of it. */
const PICKET_X = 20;
const PICKET_ROWS: readonly number[] = [7, 9, 11];
/** Tough enough that nobody falls inside the run, so the end state shows who was struck. */
const ENDURANCE = 1_000_000;

const RUN_TICKS = 500;

const { AttackOrder, Engagement, Health, Owner, Settler, Stance } = components;

function endure(sim: Simulation, e: Entity): void {
  const health = sim.world.mut(e, Health);
  health.hitpoints = ENDURANCE;
  health.max = ENDURANCE;
}

function build(sim: Simulation): void {
  const temple = placeBuiltSandboxBuilding(sim, BUILDING_TEMPLE, TEMPLE.x, TEMPLE.y, ENEMY_PLAYER);
  endure(sim, temple);
  const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y, ENEMY_PLAYER);
  endure(sim, tower);
  for (const [x, y] of TOWER_ARCHERS) {
    const guard = spawnSettlerDirect(sim, JOB_ARCHER, x, y, ENEMY_PLAYER);
    endure(sim, guard);
    sim.enqueueSetup({ kind: 'assignWorker', entity: guard, building: tower, jobPriority: [JOB_ARCHER] });
  }
  for (const y of PICKET_ROWS) {
    const swordsman = spawnSandboxSettlerDirect(sim, JOB_SOLDIER_SWORD, PICKET_X, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
    });
    endure(sim, swordsman);
    // IGNORE holds them where they stand, so only an archer that turns on them ever fights them.
    sim.world.mut(swordsman, Stance).mode = systems.MILITARY_MODE.IGNORE;
  }
  for (const y of ARCHER_ROWS) {
    const archer = spawnSettlerDirect(sim, JOB_ARCHER, ARCHER_X, y, HUMAN_PLAYER);
    endure(sim, archer);
    sim.enqueueSetup({ kind: 'attackUnit', entity: archer, target: temple });
  }
}

function templeOf(snapshot: WorldSnapshot): Entity | undefined {
  const found = snapshot.entities.find(
    (e) => buildingTypeOf(e) === BUILDING_TEMPLE && ownerPlayerOf(e) === ENEMY_PLAYER,
  );
  return found?.id as Entity | undefined;
}

function focus(snapshot: WorldSnapshot): StageOrder[] {
  const temple = templeOf(snapshot);
  const members = membersOf(snapshot, HUMAN_PLAYER, JOB_ARCHER).map((m) => ({ entity: m.id as Entity }));
  if (temple === undefined || members.length === 0) return [];
  return [{ by: 'viewer', command: { kind: 'attackUnitGroup', members, target: temple } }];
}

function assault(snapshot: WorldSnapshot): StageOrder[] {
  const goal = cellAnchorNode(TEMPLE.x, TEMPLE.y);
  const members = membersOf(snapshot, HUMAN_PLAYER, JOB_ARCHER).map((m, i) => ({
    entity: m.id as Entity,
    x: goal.hx,
    y: goal.hy + i - Math.floor(ARCHER_ROWS.length / 2),
  }));
  if (members.length === 0) return [];
  return [{ by: 'viewer', command: { kind: 'attackMoveUnitGroup', members } }];
}

function retreat(snapshot: WorldSnapshot): StageOrder[] {
  const home = cellAnchorNode(ARCHER_X, TEMPLE.y);
  const members = membersOf(snapshot, HUMAN_PLAYER, JOB_ARCHER).map((m) => ({
    entity: m.id as Entity,
    x: home.hx,
    y: m.hy,
  }));
  if (members.length === 0) return [];
  return [{ by: 'viewer', command: { kind: 'moveUnitGroup', members } }];
}

function blueArchers(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) =>
      sim.world.get(e, Owner).player === HUMAN_PLAYER && sim.world.get(e, Settler).jobType === JOB_ARCHER,
  );
}

/** Read off buildings and blue settlers only: the temple's blessing lifts a red person past its maximum. */
const struck = (sim: Simulation, e: Entity): boolean => sim.world.get(e, Health).hitpoints < ENDURANCE;

/** Whether an archer holds anything but the temple: the swordsmen in its way or the tower shooting it. */
function turnedAside(sim: Simulation): boolean {
  const temple = buildingOfType(sim, BUILDING_TEMPLE);
  return blueArchers(sim).some((e) => {
    const held = sim.world.tryGet(e, Engagement)?.target;
    return held !== undefined && held !== temple;
  });
}

export const focusFireScene: SceneDefinition = {
  id: 'focus-fire',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  stages: [
    {
      id: 'field',
      // The picket stands between the archers' firing line and the temple, so the view holds all three.
      focus: { x: PICKET_X, y: TEMPLE.y },
      zoom: 0.8,
      actions: [
        { label: 'focus', kind: 'orders', orders: focus },
        { label: 'assault', kind: 'orders', orders: assault },
        { label: 'retreat', kind: 'orders', orders: retreat },
      ],
    },
  ],
  checks: [
    {
      label: 'the archers shoot the temple they were sent at',
      predicate: (sim) => {
        const temple = buildingOfType(sim, BUILDING_TEMPLE);
        return temple !== null && struck(sim, temple);
      },
    },
    {
      label: 'no archer ever turns on the swordsmen in its way or on the tower shooting it',
      predicate: () => !holdsSometimeDuring(focusFireScene, RUN_TICKS, turnedAside),
    },
    {
      label: 'the tower shoots at them, and every archer still holds the temple as its order',
      predicate: (sim) => {
        const temple = buildingOfType(sim, BUILDING_TEMPLE);
        const archers = blueArchers(sim);
        return (
          archers.some((e) => struck(sim, e)) &&
          archers.every((e) => sim.world.tryGet(e, AttackOrder)?.target === temple)
        );
      },
    },
  ],
};
