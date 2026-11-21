import { type Command, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain, resolveVikingBuilding } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { VEHICLE_CATAPULT } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import {
  type ArmourSlug,
  anchorNear,
  type Formation,
  headcount,
  type Squad,
  spawnSquads,
  squad,
} from './arenas.js';

/**
 * Bow trials: arenas of small fights the viewer starts with blue's own orders, while red holds in its
 * default stance. Every bow duel comes twice, blue on the short bow and blue on the long one, in every
 * armour, as veterans and behind a sword line; then bows against chain-mailed swords, sword duels that
 * weigh leather, red towers manned at every post and red catapults for either bow to attack.
 */

type Arena =
  | { readonly kind: 'field'; readonly blue: readonly Squad[]; readonly red: readonly Squad[] }
  /** Blue's squad against red's tower, every post of it manned. */
  | { readonly kind: 'tower'; readonly tower: string; readonly blue: readonly Squad[] }
  /** Blue's squad against red's commanded catapult. */
  | { readonly kind: 'catapult'; readonly blue: readonly Squad[] };

/** Half-cell nodes from one front file to the other: past every bow's reach and a soldier's sight, so
 *  nobody fights before blue is sent. */
const FRONT_GAP = 60;
/** Room behind a front for its columns. */
const REAR_DEPTH = 16;
const ARENA_W = 2 * REAR_DEPTH + FRONT_GAP;
const ARENA_H = 24;
/** Open ground between arenas, wider than a posted long bow's reach from a tower wall, so no fight
 *  draws in a neighbouring arena. */
const ARENA_GAP = 40;
const MARGIN = 20;
/** Each row pairs an arena with its twin where blue holds the other bow. */
const COLUMNS = 4;
const PITCH_X = ARENA_W + ARENA_GAP;
const PITCH_Y = ARENA_H + ARENA_GAP;
const FORMATION: Formation = { fileSize: 5, fileStep: 4, columnStep: 3 };
/** East of the tower, clear of its footprint: where the garrison stands before it takes its posts. */
const GARRISON_OFFSET = 12;
/** East of the catapult, beside it. */
const COMMANDER_OFFSET = 4;

const BOWS = 10;
const SWORD_LINE = 5;
const CHARGE = 5;
const SWORDS = 10;
/** The Knowledge accuracy table's middle row: 61% of shots land. */
const VETERAN_POINTS = 50;
/** Landed stones a commander starts with: steady, not flawless. */
const CATAPULT_SKILL = 50;
/** Every tower post: `logicworker 40` short bows and `41` long ones. */
const TOWER_POSTS: Readonly<Record<string, number>> = { tower_00: 3, tower_01: 4 };
const BOW_JOBS = [JOB_ARCHER, JOB_ARCHER_LONG] as const;

const otherBow = (bow: number): number => (bow === JOB_ARCHER ? JOB_ARCHER_LONG : JOB_ARCHER);

/** Ten bows against ten of the other kind, both sides in one armour, then the same with the bows swapped. */
const bowDuels = (armour: ArmourSlug | null, points = 0): Arena[] =>
  BOW_JOBS.map((bow) => ({
    kind: 'field',
    blue: [squad(bow, BOWS, armour, points)],
    red: [squad(otherBow(bow), BOWS, armour, points)],
  }));

/** Ten bows in five armours, two to each, against the other kind; then swapped. */
const mixedDuels = (): Arena[] => {
  const armours = [null, 'armor_wool', 'armor_leather', 'armor_chain', 'armor_plate'] as const;
  const side = (bow: number) => armours.map((armour) => squad(bow, BOWS / armours.length, armour));
  return BOW_JOBS.map((bow) => ({ kind: 'field', blue: side(bow), red: side(otherBow(bow)) }));
};

/** Five swords in front of ten bows a side, the bows against the other kind; then swapped. */
const swordLines = (armour: ArmourSlug): Arena[] =>
  BOW_JOBS.map((bow) => ({
    kind: 'field',
    blue: [squad(JOB_SOLDIER_SWORD, SWORD_LINE, armour), squad(bow, BOWS, armour)],
    red: [squad(JOB_SOLDIER_SWORD, SWORD_LINE, armour), squad(otherBow(bow), BOWS, armour)],
  }));

/** Leather bows against chain-mailed swords. */
const charge = (bow: number): Arena => ({
  kind: 'field',
  blue: [squad(bow, BOWS, 'armor_leather')],
  red: [squad(JOB_SOLDIER_SWORD, CHARGE, 'armor_chain')],
});

const swordDuel = (red: ArmourSlug | null): Arena => ({
  kind: 'field',
  blue: [squad(JOB_SOLDIER_SWORD, SWORDS, 'armor_leather')],
  red: [squad(JOB_SOLDIER_SWORD, SWORDS, red)],
});

const towerSiege = (tower: string, bow: number): Arena => ({
  kind: 'tower',
  tower,
  blue: [squad(bow, BOWS, 'armor_leather')],
});

const catapultHunt = (bow: number): Arena => ({
  kind: 'catapult',
  blue: [squad(bow, BOWS, 'armor_leather')],
});

/** Four a row, west to east, then north to south; the scene summary names them in this order. */
const ARENAS: readonly Arena[] = [
  ...bowDuels(null),
  ...bowDuels('armor_wool'),
  ...bowDuels('armor_leather'),
  ...bowDuels('armor_chain'),
  ...bowDuels('armor_plate'),
  ...mixedDuels(),
  ...bowDuels('armor_wool', VETERAN_POINTS),
  ...bowDuels('armor_leather', VETERAN_POINTS),
  ...bowDuels('armor_chain', VETERAN_POINTS),
  ...swordLines('armor_wool'),
  ...swordLines('armor_leather'),
  ...swordLines('armor_chain'),
  charge(JOB_ARCHER),
  charge(JOB_ARCHER_LONG),
  swordDuel('armor_wool'),
  swordDuel(null),
  towerSiege('tower_00', JOB_ARCHER),
  towerSiege('tower_00', JOB_ARCHER_LONG),
  towerSiege('tower_01', JOB_ARCHER),
  towerSiege('tower_01', JOB_ARCHER_LONG),
  catapultHunt(JOB_ARCHER),
  catapultHunt(JOB_ARCHER_LONG),
];

const ROWS = Math.ceil(ARENAS.length / COLUMNS);
const MAP_W = (2 * MARGIN + COLUMNS * PITCH_X - ARENA_GAP) / 2;
const MAP_H = (2 * MARGIN + ROWS * PITCH_Y - ARENA_GAP) / 2;
/** Nobody stands within reach of an enemy, so this only proves the arenas stay apart. */
const RUN_TICKS = 240;

interface Frame {
  /** Blue's front file, red's front file, and the row both are centred on. */
  readonly blueHx: number;
  readonly redHx: number;
  readonly centreHy: number;
}

function frameOf(index: number): Frame {
  const blueHx = MARGIN + (index % COLUMNS) * PITCH_X + REAR_DEPTH;
  return {
    blueHx,
    redHx: blueHx + FRONT_GAP,
    centreHy: MARGIN + Math.floor(index / COLUMNS) * PITCH_Y + ARENA_H / 2,
  };
}

/** `squads` of `owner` with their front file at `frontHx`; columns deepen west for blue, east for red. */
function squadsAt(
  sim: Simulation,
  squads: readonly Squad[],
  frontHx: number,
  frame: Frame,
  owner: number,
): Command[] {
  const away = owner === HUMAN_PLAYER ? -1 : 1;
  return spawnSquads(sim, squads, { frontHx, centreHy: frame.centreHy, away }, owner, FORMATION);
}

const postsOf = (arena: Arena): number => (arena.kind === 'tower' ? (TOWER_POSTS[arena.tower] ?? 0) : 0);

function arenaSpawns(sim: Simulation, arena: Arena, frame: Frame): Command[] {
  const blue = squadsAt(sim, arena.blue, frame.blueHx, frame, HUMAN_PLAYER);
  const at = anchorNear(frame.redHx, frame.centreHy);
  switch (arena.kind) {
    case 'field':
      return [...blue, ...squadsAt(sim, arena.red, frame.redHx, frame, ENEMY_PLAYER)];
    case 'tower': {
      const posts = postsOf(arena);
      const garrison = [squad(JOB_ARCHER, posts, null), squad(JOB_ARCHER_LONG, posts, null)];
      return [
        ...blue,
        {
          kind: 'placeBuilding',
          buildingType: resolveVikingBuilding(arena.tower).typeId,
          x: at.hx,
          y: at.hy,
          tribe: PRIMARY_TRIBE,
          owner: ENEMY_PLAYER,
          // Served content gates the tower behind progression; the sandbox catalog does not.
          ignoreTechnology: true,
        },
        ...squadsAt(sim, garrison, at.hx + GARRISON_OFFSET, frame, ENEMY_PLAYER).map((c) =>
          c.kind === 'spawnSettler' ? { ...c, workplace: { x: at.hx, y: at.hy } } : c,
        ),
      ];
    }
    case 'catapult':
      return [
        ...blue,
        {
          kind: 'createVehicle',
          vehicleType: VEHICLE_CATAPULT,
          x: at.hx,
          y: at.hy,
          tribe: PRIMARY_TRIBE,
          owner: ENEMY_PLAYER,
        },
        {
          kind: 'spawnSettler',
          jobType: JOB_SOLDIER_SWORD,
          x: at.hx + COMMANDER_OFFSET,
          y: at.hy,
          tribe: PRIMARY_TRIBE,
          owner: ENEMY_PLAYER,
          vehicle: { x: at.hx, y: at.hy, inside: false },
          experience: [[systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, CATAPULT_SKILL]],
        },
      ];
  }
}

function build(sim: Simulation): void {
  ARENAS.forEach((arena, index) => {
    for (const command of arenaSpawns(sim, arena, frameOf(index))) sim.enqueueSetup(command);
  });
}

function settlersOf(arena: Arena): number {
  switch (arena.kind) {
    case 'field':
      return headcount(arena.blue) + headcount(arena.red);
    case 'tower':
      return headcount(arena.blue) + 2 * postsOf(arena);
    case 'catapult':
      // The catapult's commander.
      return headcount(arena.blue) + 1;
  }
}

const SETTLERS = ARENAS.reduce((n, arena) => n + settlersOf(arena), 0);
const POSTS = ARENAS.reduce((n, arena) => n + 2 * postsOf(arena), 0);

const { Building, Garrison, Health, Settler, Vehicle } = components;

const unhurt = (sim: Simulation, e: Entity): boolean => {
  const health = sim.world.tryGet(e, Health);
  return health === undefined || health.hitpoints >= health.max;
};

export const bowTrialsScene: SceneDefinition = {
  id: 'bow-trials',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.5,
  checks: [
    {
      label: 'every arena fields its fighters, and nobody is hurt before blue is sent',
      predicate: (sim) => {
        const settlers = [...sim.world.query(Settler, Health)];
        const things = [
          ...settlers,
          ...sim.world.query(Building, Health),
          ...sim.world.query(Vehicle, Health),
        ];
        return settlers.length === SETTLERS && things.every((e) => unhurt(sim, e));
      },
    },
    {
      label: 'every tower post is manned',
      predicate: (sim) => [...sim.world.query(Garrison)].length === POSTS,
    },
  ],
};
