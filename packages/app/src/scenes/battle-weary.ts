import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { SLEEP_ATOMIC } from '../catalog/atomics.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import { enemyLivingSettlers, goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The weary warband: soldiers too tired and too hungry to go on keep fighting anyway. The front rank closes
 * on a red picket while the reserve behind it, out of the enemy's sight and a few paces from a full larder,
 * stands to instead of lying down or going to eat; a sentry asleep out on the flank gets up when a raider
 * marches on it. Only once each fight is won does the warband eat and bed down.
 */

const MAP_W = 34;
const MAP_H = 16;

const RANK_ROWS: readonly number[] = [5, 6, 7, 8, 9];
const FRONT_X = 8;
/** Four cells, eight nodes, behind the front rank and ten from the picket: past a soldier's sight, so the
 *  reserve never joins the fight, but well inside the rest clearance of it. */
const RESERVE_X = 4;
const PICKET_X = 14;
const PICKET_ROWS: readonly number[] = [6, 7, 8];
/** Behind the reserve, so the walk the reserve does not take is a short and obvious one, and north of the
 *  flank's rows, so a soldier eating at it still counts with the warband. */
const LARDER = { x: 2, y: 10 } as const;
/** More meals than the warband can eat, so nothing it does is for want of food. */
const LARDER_RATIONS = 40;

/** The flank, clear of the warband's battle: over forty nodes from the picket, so its fighting neither
 *  holds the sentry awake nor wakes it. The raider marches at it from ten cells off - past the sentry's
 *  own eight-cell sight, so the wake is the march's doing and not the starting position's, and far enough
 *  that the sleep is on screen for a while first. */
const SENTRY = { x: 30, y: 14 } as const;
const RAIDER = { x: 17, y: 14 } as const;
/** The flank's rows. Keyed on the row, not the column, so the marching raider stays the flank's business
 *  all the way across. */
const FLANK_ROW = 12;
/** A night's sleep far longer than the run, so only the raider can end it. */
const SENTRY_NIGHT_TICKS = 10_000;
/** A lighter raider, so the sentry who gets up to meet it wins. */
const RAIDER_HITPOINT_SHARE = 2;

/** Over the drive level a soldier leaves for its bed, and over the level it leaves for food, but short of
 *  the critical hunger that would send it to the larder even on alert. */
const WEARY = fx.div(fx.fromInt(9), fx.fromInt(10));
const HUNGRY = fx.div(fx.fromInt(85), fx.fromInt(100));

/** The picket falls around here; the check for what nobody did reruns only this much of the scene. */
const FIGHT_WINDOW_TICKS = 220;

const { CurrentAtomic, Health, Owner, Position, Settler, Stance, Stockpile } = components;

function build(sim: Simulation): void {
  const larder = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, LARDER.x, LARDER.y, HUMAN_PLAYER);
  // By slug: the sandbox catalog carries the food goods at +100, so naming an id would stock a shelf real
  // content's store does not have.
  sim.world.mut(larder, Stockpile).amounts.set(goodBySlug(sim, 'food_simple'), LARDER_RATIONS);

  for (const y of RANK_ROWS) {
    weary(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, FRONT_X, y, HUMAN_PLAYER));
    // DEFEND on the spot: the reserve holds where it stands unless the enemy comes to it. It is the rank
    // that carries the hunger, since it is the one with a larder behind it and nothing else to do.
    const reserve = weary(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SPEAR, RESERVE_X, y, HUMAN_PLAYER));
    sim.world.mut(reserve, Stance).mode = systems.MILITARY_MODE.DEFEND;
    sim.world.mut(reserve, Settler).hunger = HUNGRY;
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
  sim.world.mut(e, Settler).fatigue = WEARY;
  return e;
}

/** Every living settler of `player` on the warband's rows, or on the flank's. */
function living(sim: Simulation, player: number, onFlank: boolean): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Position, Health)) {
    if (sim.world.get(e, Owner).player !== player || sim.world.get(e, Health).hitpoints <= 0) continue;
    if (sim.world.get(e, Position).y >= fx.fromInt(FLANK_ROW) === onFlank) out.push(e);
  }
  return out;
}

/** The blue soldiers on the battle's rows: the front rank and the reserve. */
function warband(sim: Simulation): Entity[] {
  return living(sim, HUMAN_PLAYER, false);
}

/** The hungry rank: the only blues whose hunger bar the scene authored. */
function reserve(sim: Simulation): Entity[] {
  return warband(sim).filter((e) => sim.world.get(e, Position).x < fx.fromInt(FRONT_X));
}

function sentryAwake(sim: Simulation): boolean {
  const flank = living(sim, HUMAN_PLAYER, true);
  return flank.length > 0 && flank.every((e) => !sleeping(sim, e));
}

function sleeping(sim: Simulation, e: Entity): boolean {
  return sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep';
}

/** Whether any red on the battle's rows is still on its feet: the warband's own fight. */
function picketAlive(sim: Simulation): boolean {
  return living(sim, ENEMY_PLAYER, false).length > 0;
}

/** Whether anyone in the warband broke off while the picket was still up: lay down, or ate, which only a
 *  walk to the larder allows. Hunger only climbs, so a bar below the authored level means a meal. */
function brokeOffMidFight(sim: Simulation): boolean {
  if (!picketAlive(sim)) return false;
  if (warband(sim).some((e) => sleeping(sim, e))) return true;
  return reserve(sim).some((e) => sim.world.get(e, Settler).hunger < HUNGRY);
}

export const battleWearyScene: SceneDefinition = {
  id: 'battle-weary',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  needs: true,
  // The picket falls near tick 150 and the raider soon after; the warband eats, sleeps and is up again
  // well inside the tail.
  runTicks: 900,
  initialZoom: 0.55,
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
      label: 'nobody lay down or left for the larder while the picket was still up',
      predicate: () => !holdsSometimeDuring(battleWearyScene, FIGHT_WINDOW_TICKS, brokeOffMidFight),
    },
    {
      label: 'with the fight won, the warband ate and slept off its fatigue',
      predicate: (sim) =>
        warband(sim).every((e) => sim.world.get(e, Settler).fatigue < systems.NEED_DRIVE_THRESHOLD) &&
        reserve(sim).every((e) => sim.world.get(e, Settler).hunger < HUNGRY),
    },
  ],
};
