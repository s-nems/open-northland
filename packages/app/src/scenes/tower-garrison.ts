import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_CARRIER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
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

const { Garrison, Health, Position, Resting, Settler } = components;

const MAP_W = 28;
const MAP_H = 14;
const TOWER = { x: 8, y: 7 } as const;
interface Tile {
  readonly x: number;
  readonly y: number;
}

/** Clear of the tower's footprint. A full small-tower garrison is `logicworker 40 3` short bows and
 *  `41 3` long ones. */
const SHORT_BOW_STARTS: readonly Tile[] = [
  { x: 4, y: 5 },
  { x: 4, y: 7 },
  { x: 4, y: 9 },
];
const LONG_BOW_STARTS: readonly Tile[] = [
  { x: 2, y: 5 },
  { x: 2, y: 7 },
  { x: 2, y: 9 },
];
const GARRISON_SIZE = SHORT_BOW_STARTS.length + LONG_BOW_STARTS.length;
const BOW_CLASSES: ReadonlySet<number> = new Set([JOB_ARCHER, JOB_ARCHER_LONG]);
/** 8 cells (16 half-cell nodes) east of the tower: at the edge of a soldier's sight, so it advances,
 *  and past the short bow's plain `maximumrange 15`, so arrows meeting it can only be the manned 23. */
const ASSAULT_X = 16;
const ASSAULT_ROWS: readonly number[] = [6, 8];
/** Over-tough on purpose, so the party survives its walk under fire and reaches the wall. */
const ENEMY_HITPOINTS = 200_000;

const CARRIER_START: Tile = { x: 6, y: 11 };

/** The tower larder's `logicstock 16 25` ceiling, enough that no archer comes down for a meal. */
const TOWER_RATIONS = 25;
/** The larder's eat slot (`goodtypes.ini` 16). */
const FOOD_GOOD = 'food_simple';

/** After the assault has started on the wall, but before it razes the tower (measured: around tick 500). */
const RUN_TICKS = 380;

function build(sim: Simulation): void {
  const tower = placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y);
  // By slug: the sandbox catalog carries the food goods at +100, so naming an id would stock a shelf
  // real content's tower does not have.
  sim.world.get(tower, components.Stockpile).amounts.set(goodBySlug(sim, FOOD_GOOD), TOWER_RATIONS);
  // A settler of a bow class resolves that bow by (tribe, job), so the trade alone arms him.
  for (const start of SHORT_BOW_STARTS) man(sim, tower, JOB_ARCHER, start);
  for (const start of LONG_BOW_STARTS) man(sim, tower, JOB_ARCHER_LONG, start);
  // The tower's third slot is a plain hauler (`logicworker 24`), not garrison.
  const carrier = spawnSettlerDirect(sim, JOB_CARRIER, CARRIER_START.x, CARRIER_START.y);
  sim.enqueueSetup({ kind: 'assignWorker', entity: carrier, building: tower, jobPriority: [JOB_CARRIER] });
  for (const y of ASSAULT_ROWS) enemySwordsman(sim, ASSAULT_X, y);
}

/** The `jobPriority` offers him only his own class, never the tower's hauler slot. */
function man(sim: Simulation, tower: Entity, jobType: number, start: Tile): void {
  const archer = spawnSettlerDirect(sim, jobType, start.x, start.y);
  sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [jobType] });
}

function enemySwordsman(sim: Simulation, x: number, y: number): void {
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, {
    weaponTypeId: WEAPON_SWORD,
    hitpoints: ENEMY_HITPOINTS,
  });
}

/** Filters by bow class, so the tower's own hauler is not counted as one of the men on the wall. */
function archers(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, components.Owner)].filter((e) => {
    const jobType = sim.world.get(e, Settler).jobType;
    return (
      sim.world.get(e, components.Owner).player === HUMAN_PLAYER &&
      jobType !== null &&
      BOW_CLASSES.has(jobType)
    );
  });
}

function enemies(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, components.Owner, Health)].filter(
    (e) => sim.world.get(e, components.Owner).player === ENEMY_PLAYER,
  );
}

/** The scene places exactly one building. */
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
      label: 'every archer holds the tower - inside it, hidden, on its own tile',
      predicate: (sim) => {
        const post = tower(sim);
        const manning = archers(sim);
        if (post === undefined || manning.length !== GARRISON_SIZE) return false;
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
      label: 'no archer ever left the wall - not to chase, not for a meal',
      predicate: (sim) => {
        const post = tower(sim);
        if (post === undefined) return false;
        const at = sim.world.get(post, Position);
        return archers(sim).every((e) => samePlace(sim.world.get(e, Position), at));
      },
    },
  ],
};
