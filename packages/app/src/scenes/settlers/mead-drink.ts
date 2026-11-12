import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSandboxSettlerDirect, weaponEquipmentFor } from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * Mead is drunk on the way. Three settlers walk east and turn hungry a few steps out: a civilian and a
 * soldier stop on the road, drink their mead on the eat clip and walk on. The third, a soldier whose
 * regeneration is prohibited, keeps his mead corked and drinks his nourishing potion on the spot instead,
 * without stopping.
 */

const MAP_W = 24;
const MAP_H = 10;
const ROWS = { civilian: 2, allowed: 5, prohibited: 8 } as const;
const FROM_X = 3;
const TO_X = 20;
/** Need reserve units short of the drive level, drained at one a tick: a few steps of walking first. */
const UNITS_TO_DRIVE = 60;
const RUN_TICKS = 1200;
const INITIAL_ZOOM = 1.1;

const { Equipment, Position, Settler, SettlerNeeds } = components;

function build(sim: Simulation): void {
  const mead = { goodType: goodBySlug(sim, 'mead') };
  const potion = { goodType: goodBySlug(sim, 'potion_food_small') };
  const walker = (job: number, y: number, misc: readonly ({ goodType: number } | null)[]): Entity => {
    const e = spawnSandboxSettlerDirect(sim, job, FROM_X, y, HUMAN_PLAYER, {
      equipment: { ...weaponEquipmentFor(job, sim.content.goods), misc },
    });
    const offset = fx.div(fx.fromInt(UNITS_TO_DRIVE), fx.fromInt(systems.NEED_RESERVE_UNITS));
    systems.mutNeeds(sim.world, e, sim.tick).hunger = fx.sub(systems.NEED_DRIVE_THRESHOLD, offset);
    const goal = cellAnchorNode(TO_X, y);
    sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: goal.hx, y: goal.hy });
    return e;
  };

  walker(JOB_COLLECTOR, ROWS.civilian, [mead, null, null, null]);
  walker(JOB_SOLDIER_SWORD, ROWS.allowed, [mead, null, null, null]);
  const prohibited = walker(JOB_SOLDIER_SWORD, ROWS.prohibited, [mead, potion, null, null]);
  sim.enqueueSetup({ kind: 'setRegeneration', entity: prohibited, enabled: false });
}

function settlerOnRow(sim: Simulation, y: number): Entity | undefined {
  for (const e of sim.world.query(Settler, Position)) {
    if (fx.toInt(sim.world.get(e, Position).y) === y) return e;
  }
  return undefined;
}

/** The row's settler stands at the walk's end, fed, its misc slot `slot` down to `sips` sips. */
function arrivedWith(sim: Simulation, y: number, slot: number, sips: number): boolean {
  const e = settlerOnRow(sim, y);
  if (e === undefined || fx.toInt(sim.world.get(e, Position).x) !== TO_X) return false;
  const hunger = systems.needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick);
  const held = sim.world.get(e, Equipment).misc[slot] ?? null;
  const left = held === null ? 0 : held.degreeOfUse === fx.fromInt(0) ? 2 : 1;
  return hunger < systems.NEED_DRIVE_THRESHOLD && left === sips;
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
      predicate: (sim) => arrivedWith(sim, ROWS.civilian, 0, 1),
    },
    {
      label: 'the soldier allowed to regenerate drank one sip of his mead and still reached his goal',
      predicate: (sim) => arrivedWith(sim, ROWS.allowed, 0, 1),
    },
    {
      label: 'the soldier with regeneration prohibited kept his mead corked and drank his potion',
      predicate: (sim) => arrivedWith(sim, ROWS.prohibited, 0, 2) && arrivedWith(sim, ROWS.prohibited, 1, 1),
    },
  ],
};
