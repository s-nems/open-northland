import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { SLEEP_ATOMIC } from '../catalog/atomics.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The weary warband: soldiers too tired and hungry to go on keep fighting anyway. The front rank closes on
 * a red picket while the reserve behind it, out of the enemy's sight, stands to instead of lying down; a
 * sentry asleep far out on the flank gets up when a raider marches on it. Only once the fight is won does
 * the warband bed down.
 */

const MAP_W = 56;
const MAP_H = 16;

const RANK_ROWS: readonly number[] = [5, 6, 7, 8, 9];
const FRONT_X = 8;
/** Ten cells, twenty nodes, from the picket: past a soldier's sight, so the reserve never joins in, but
 *  well inside the rest clearance of both the picket and the front rank's fight. */
const RESERVE_X = 4;
const PICKET_X = 14;
const PICKET_ROWS: readonly number[] = [6, 7, 8];

/** The flank, far from the picket fight. The raider starts past a sleeper's stand-to radius of the
 *  sentry and of the warband alike, so it is its march that wakes the sentry. */
const SENTRY = { x: 52, y: 13 } as const;
const RAIDER = { x: 31, y: 13 } as const;
/** Everything east of here is the flank. */
const FLANK_X = 30;
/** A night's sleep far longer than the run, so only the raider can end it. */
const SENTRY_NIGHT_TICKS = 10_000;
/** A lighter raider, so the sentry who gets up to meet it wins. */
const RAIDER_HITPOINT_SHARE = 2;

/** Over the drive level a soldier leaves for its bed and its food, and short of the critical hunger that
 *  would send it for food even on alert. */
const WEARY = fx.div(fx.fromInt(9), fx.fromInt(10));
const HUNGRY = fx.div(fx.fromInt(85), fx.fromInt(100));

const { CurrentAtomic, Health, Owner, Position, Settler, Stance } = components;

function build(sim: Simulation): void {
  for (const y of RANK_ROWS) {
    weary(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, FRONT_X, y, HUMAN_PLAYER));
    // DEFEND on the spot: the reserve holds where it stands unless the enemy comes to it.
    const reserve = weary(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SPEAR, RESERVE_X, y, HUMAN_PLAYER));
    sim.world.mut(reserve, Stance).mode = systems.MILITARY_MODE.DEFEND;
  }
  for (const y of PICKET_ROWS) spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, PICKET_X, y, ENEMY_PLAYER);

  const sentry = weary(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SENTRY.x, SENTRY.y, HUMAN_PLAYER));
  sim.world.add(sentry, CurrentAtomic, {
    atomicId: SLEEP_ATOMIC,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: SENTRY_NIGHT_TICKS,
    effect: { kind: 'sleep' },
    targetEntity: sentry,
    targetTile: null,
  });
  const raider = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, RAIDER.x, RAIDER.y, ENEMY_PLAYER);
  const health = sim.world.mut(raider, Health);
  health.hitpoints = Math.trunc(health.max / RAIDER_HITPOINT_SHARE);
  const goal = cellAnchorNode(SENTRY.x - 1, SENTRY.y);
  sim.enqueueSetup({ kind: 'attackMoveUnit', entity: raider, x: goal.hx, y: goal.hy });
}

function weary(sim: Simulation, e: Entity): Entity {
  const settler = sim.world.mut(e, Settler);
  settler.fatigue = WEARY;
  settler.hunger = HUNGRY;
  return e;
}

/** The blue soldiers west of the flank: the front rank and the reserve. */
function warband(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Position, Health)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER || sim.world.get(e, Health).hitpoints <= 0) continue;
    if (sim.world.get(e, Position).x < fx.fromInt(FLANK_X)) out.push(e);
  }
  return out;
}

function sentryAwake(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Owner, Position, Health)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER || sim.world.get(e, Health).hitpoints <= 0) continue;
    if (sim.world.get(e, Position).x < fx.fromInt(FLANK_X)) continue;
    return sim.world.tryGet(e, CurrentAtomic)?.effect.kind !== 'sleep';
  }
  return false;
}

export const battleWearyScene: SceneDefinition = {
  id: 'battle-weary',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  needs: true,
  // The picket falls near tick 140 and the raider near 340; the warband wakes rested near 375.
  runTicks: 600,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the picket and the raider are cut down',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
    {
      label: 'the sentry got up for the raider and lived',
      predicate: sentryAwake,
    },
    {
      label: 'with the fight won, the warband has slept off its fatigue',
      predicate: (sim) =>
        warband(sim).every((e) => sim.world.get(e, Settler).fatigue < systems.NEED_DRIVE_THRESHOLD),
    },
  ],
};
