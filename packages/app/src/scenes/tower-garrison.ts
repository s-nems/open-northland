import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnSettlerDirect,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The tower garrison: two bow soldiers right-clicked onto a watchtower take its `logicworker 40/41` posts,
 * walk in, and hold the wall. From up there each shoots at its own bow's reach plus the tower's bonus and
 * never steps out after anything, while the enemy warband that marches on them can only batter the tower -
 * a manned post is out of reach until the structure falls.
 *
 * Layout: the tower on the left with its two archers starting beside it, and an enemy sword party that
 * marches on it from 8 cells out - past the short bow's plain `maximumrange 15`, so the volley that opens
 * on them as they set off is the tower's bonus at work (the reach itself is pinned by the sim's
 * `tower-garrison.test.ts`; here it is what a watcher sees). They are deliberately over-tough, because
 * the point of the scene is what happens when they DO arrive: they hammer the wall and cannot touch the
 * men behind it.
 */

const { Garrison, Health, Position, Resting, Settler } = components;

const MAP_W = 28;
const MAP_H = 14;
const TOWER = { x: 8, y: 7 } as const;
/** The archers' start tiles - beside the tower, clear of its footprint. */
const SHORT_BOW_START = { x: 4, y: 6 } as const;
const LONG_BOW_START = { x: 4, y: 8 } as const;
/**
 * The assault's start column: 8 cells (16 half-cell nodes) east of the tower - the far edge of a soldier's
 * sight, so it advances, and past the short bow's plain `maximumrange 15`, so the arrows that meet it on
 * the way can only be the manned 23.
 */
const ASSAULT_X = 16;
const ASSAULT_ROWS: readonly number[] = [6, 8];
/** Over-tough on purpose: the party has to SURVIVE its walk under fire and reach the wall, which is what
 *  makes the untouchable garrison observable. */
const ENEMY_HITPOINTS = 200_000;

/** The tower's larder - enough meals that neither archer ever has to come down for one. */
const TOWER_RATIONS = 25;
/** The eat-slot good every tower larder slots (`goodtypes.ini` 16 `food_simple`). */
const FOOD_GOOD = 'food_simple';

/** The window after the assault has closed and started on the wall, but before it can raze a 60k-HP tower
 *  out from under the garrison (measured: the pair takes it down around tick 500). */
const RUN_TICKS = 380;

function build(sim: Simulation): void {
  const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y);
  // Fill the larder the tower type already declares (`logicstock 16 25`), so a fed garrison holds its
  // wall instead of climbing down to find one. By slug: the sandbox catalog carries the food goods at
  // +100, so naming an id would stock a shelf real content's tower does not have.
  sim.world.get(tower, components.Stockpile).amounts.set(goodBySlug(sim, FOOD_GOOD), TOWER_RATIONS);
  // A settler of a bow class resolves that bow by (tribe, job), so the trade alone arms him.
  const shortBow = spawnSettlerDirect(sim, JOB_ARCHER, SHORT_BOW_START.x, SHORT_BOW_START.y);
  const longBow = spawnSettlerDirect(sim, JOB_ARCHER_LONG, LONG_BOW_START.x, LONG_BOW_START.y);
  // The player's gesture: each archer is offered only his own class at a tower, never its hauler slot.
  sim.enqueue({ kind: 'assignWorker', entity: shortBow, building: tower, jobPriority: [JOB_ARCHER] });
  sim.enqueue({ kind: 'assignWorker', entity: longBow, building: tower, jobPriority: [JOB_ARCHER_LONG] });
  for (const y of ASSAULT_ROWS) enemySwordsman(sim, ASSAULT_X, y);
}

function enemySwordsman(sim: Simulation, x: number, y: number): void {
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, {
    weaponTypeId: WEAPON_SWORD,
    hitpoints: ENEMY_HITPOINTS,
  });
}

/** The two garrison archers, in spawn order ({@link build} fixes it). */
function archers(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, components.Owner)].filter(
    (e) => sim.world.get(e, components.Owner).player === HUMAN_PLAYER,
  );
}

function enemies(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, components.Owner, Health)].filter(
    (e) => sim.world.get(e, components.Owner).player === ENEMY_PLAYER,
  );
}

/** The tower entity - the scene places exactly one building. */
function tower(sim: Simulation): Entity | undefined {
  return [...sim.world.query(components.Building)][0];
}

function samePlace(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

export const towerGarrisonScene: SceneDefinition = {
  id: 'tower-garrison',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'both archers hold the tower - inside it, hidden, on its own tile',
      predicate: (sim) => {
        const post = tower(sim);
        const manning = archers(sim);
        if (post === undefined || manning.length !== 2) return false;
        const at = sim.world.get(post, Position);
        return manning.every((e) => {
          const held = sim.world.tryGet(e, Garrison);
          const pos = sim.world.get(e, Position);
          return (
            held?.post === post &&
            sim.world.tryGet(e, Resting)?.at === post &&
            pos.x === at.x &&
            pos.y === at.y
          );
        });
      },
    },
    {
      label: 'each kept his own bow class - a tower post never re-trades him into a hauler',
      predicate: (sim) => {
        const jobs = archers(sim).map((e) => sim.world.get(e, Settler).jobType);
        return jobs.includes(JOB_ARCHER) && jobs.includes(JOB_ARCHER_LONG);
      },
    },
    {
      label: 'the assault is shot at on its way in',
      predicate: (sim) => {
        const rank = enemies(sim);
        return (
          rank.length === ASSAULT_ROWS.length &&
          rank.some((e) => sim.world.get(e, Health).hitpoints < ENEMY_HITPOINTS)
        );
      },
    },
    {
      label: 'it reaches the wall and batters the tower instead of the men inside',
      predicate: (sim) => {
        const post = tower(sim);
        if (post === undefined) return false;
        const unhurt = archers(sim).every((e) => {
          const h = sim.world.get(e, Health);
          return h.hitpoints === h.max;
        });
        const struck = sim.world.get(post, Health);
        return unhurt && struck.hitpoints < struck.max;
      },
    },
    {
      label: 'neither archer ever left the wall to chase',
      predicate: (sim) => {
        const post = tower(sim);
        if (post === undefined) return false;
        const at = sim.world.get(post, Position);
        return archers(sim).every((e) => samePlace(sim.world.get(e, Position), at));
      },
    },
  ],
};
