import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSandboxSettlerDirect, weaponEquipmentFor } from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * Mead is drunk on the way. Four settlers walk east and turn hungry a few steps out: a civilian, a soldier
 * and a soldier whose regeneration is prohibited stop on the road, drink their mead on the eat clip and
 * walk on. A second soldier with regeneration prohibited walks past an enemy soldier, keeps his mead
 * corked and marches on hungry. The enemy's seat holds no grudge, and the soldier ignores combat, so
 * nobody fights; the bottom row sits beyond the battle alert's reach of the others.
 */

const MAP_W = 24;
const MAP_H = 29;
const ROWS = { civilian: 2, allowed: 4, prohibited: 6, guarded: 24 } as const;
const ENEMY = { x: 12, y: 27 } as const;
const ENEMY_SEAT = 1;
const FROM_X = 3;
const TO_X = 20;
/** Need reserve units short of the drive level, drained at one a tick: a few steps of walking first. */
const UNITS_TO_DRIVE = 60;
const RUN_TICKS = 1200;
const INITIAL_ZOOM = 0.6;

const { Equipment, Position, Settler, SettlerNeeds } = components;

function build(sim: Simulation): void {
  const mead = { goodType: goodBySlug(sim, 'mead') };
  const walker = (job: number, y: number): Entity => {
    const e = spawnSandboxSettlerDirect(sim, job, FROM_X, y, HUMAN_PLAYER, {
      equipment: { ...weaponEquipmentFor(job, sim.content.goods), misc: [mead, null, null, null] },
    });
    const offset = fx.div(fx.fromInt(UNITS_TO_DRIVE), fx.fromInt(systems.NEED_RESERVE_UNITS));
    systems.mutNeeds(sim.world, e, sim.tick).hunger = fx.sub(systems.NEED_DRIVE_THRESHOLD, offset);
    const goal = cellAnchorNode(TO_X, y);
    sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: goal.hx, y: goal.hy });
    return e;
  };

  walker(JOB_COLLECTOR, ROWS.civilian);
  walker(JOB_SOLDIER_SWORD, ROWS.allowed);
  const prohibited = walker(JOB_SOLDIER_SWORD, ROWS.prohibited);
  sim.enqueueSetup({ kind: 'setRegeneration', entity: prohibited, enabled: false });

  const guarded = walker(JOB_SOLDIER_SWORD, ROWS.guarded);
  sim.enqueueSetup({ kind: 'setRegeneration', entity: guarded, enabled: false });
  sim.enqueueSetup({ kind: 'setStance', entity: guarded, mode: systems.MILITARY_MODE.IGNORE });
  spawnSandboxSettlerDirect(sim, JOB_SOLDIER_SWORD, ENEMY.x, ENEMY.y, ENEMY_SEAT, {
    equipment: { ...weaponEquipmentFor(JOB_SOLDIER_SWORD, sim.content.goods) },
  });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: ENEMY_SEAT, to: HUMAN_PLAYER, state: 'neutral' });
}

function settlerOnRow(sim: Simulation, y: number): Entity | undefined {
  for (const e of sim.world.query(Settler, Position)) {
    if (fx.toInt(sim.world.get(e, Position).y) === y) return e;
  }
  return undefined;
}

/** The row's settler stands at the walk's end with `sips` sips of mead left, fed unless it kept both. */
function arrivedWith(sim: Simulation, y: number, sips: number): boolean {
  const e = settlerOnRow(sim, y);
  if (e === undefined || fx.toInt(sim.world.get(e, Position).x) !== TO_X) return false;
  const hunger = systems.needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick);
  const held = sim.world.get(e, Equipment).misc[0] ?? null;
  const left = held === null ? 0 : held.degreeOfUse === fx.fromInt(0) ? 2 : 1;
  const fed = hunger < systems.NEED_DRIVE_THRESHOLD;
  return left === sips && fed === sips < 2;
}

export const meadDrinkScene: SceneDefinition = {
  id: 'mead-drink',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  needs: true,
  checks: [
    {
      label: 'the civilian drank one sip of his mead and still reached his goal',
      predicate: (sim) => arrivedWith(sim, ROWS.civilian, 1),
    },
    {
      label: 'the soldier allowed to regenerate drank one sip of his mead and still reached his goal',
      predicate: (sim) => arrivedWith(sim, ROWS.allowed, 1),
    },
    {
      label: 'the soldier with regeneration prohibited, no enemy near, drank one sip of his mead',
      predicate: (sim) => arrivedWith(sim, ROWS.prohibited, 1),
    },
    {
      label: 'the soldier with regeneration prohibited kept his mead corked beside an enemy',
      predicate: (sim) => arrivedWith(sim, ROWS.guarded, 2),
    },
  ],
};
