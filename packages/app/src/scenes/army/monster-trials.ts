import { type Command, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  MONSTER_TRIBE_DRAGON,
  MONSTER_TRIBE_WERESNAKE,
  MONSTER_TRIBE_WEREWOLF,
} from '../../catalog/creatures.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import type { SceneDefinition } from '../types.js';
import { type Formation, headcount, type Squad, spawnSquads, squad } from './arenas.js';

/**
 * Monster trials: one red monster per arena, each facing a small blue squad of one weapon, that the viewer
 * sends in with blue's own orders. The weresnakes stand in the west column, the werewolves beside them in
 * the middle, each column one arena per weapon from north to south, and one dragon east of them faces a
 * squad of every weapon.
 */

const WEAPONS = [
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_BROADSWORD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
] as const;
const MEN = 3;
const DRAGON_MEN_PER_WEAPON = 2;
const ARMOUR = 'armor_leather';

/** A file of three, four nodes apart, centred on its monster's row. */
const FORMATION: Formation = { fileSize: MEN, fileStep: 4, columnStep: 3 };
/** Map points from a squad's front to its monster, past a long bow's reach and a monster's sight, so
 *  nobody fights before blue is sent. */
const FRONT_GAP = 28;
/** Between the weresnake and the werewolf lines: the two are on one side. */
const MONSTER_GAP = 6;
/** Between the werewolf squads and the dragon's: past a monster's sight, so a werewolf fighting its own
 *  squad does not see the dragon's. */
const SQUAD_GAP = 20;
/** Rows from one arena to the next, so a monster at its squad's file stands past the sight of the next
 *  arena's file. */
const ROW_PITCH = 23;
const MARGIN = 16;
const RUN_TICKS = 240;

interface Arena {
  readonly monster: number;
  readonly monsterHx: number;
  readonly blue: readonly Squad[];
  readonly place: { readonly frontHx: number; readonly away: -1 | 1 };
  readonly centreHy: number;
}

const rowHy = (row: number): number => MARGIN + row * ROW_PITCH;

const SNAKE_BLUE_HX = MARGIN;
const SNAKE_HX = SNAKE_BLUE_HX + FRONT_GAP;
const WOLF_HX = SNAKE_HX + MONSTER_GAP;
const WOLF_BLUE_HX = WOLF_HX + FRONT_GAP;
const DRAGON_BLUE_HX = WOLF_BLUE_HX + SQUAD_GAP;
const DRAGON_HX = DRAGON_BLUE_HX + FRONT_GAP;

const ARENAS: readonly Arena[] = [
  ...WEAPONS.map((job, row) => ({
    monster: MONSTER_TRIBE_WERESNAKE,
    monsterHx: SNAKE_HX,
    blue: [squad(job, MEN, ARMOUR)],
    place: { frontHx: SNAKE_BLUE_HX, away: -1 as const },
    centreHy: rowHy(row),
  })),
  ...WEAPONS.map((job, row) => ({
    monster: MONSTER_TRIBE_WEREWOLF,
    monsterHx: WOLF_HX,
    blue: [squad(job, MEN, ARMOUR)],
    place: { frontHx: WOLF_BLUE_HX, away: 1 as const },
    centreHy: rowHy(row),
  })),
  {
    monster: MONSTER_TRIBE_DRAGON,
    monsterHx: DRAGON_HX,
    blue: WEAPONS.map((job) => squad(job, DRAGON_MEN_PER_WEAPON, ARMOUR)),
    // Deepening west, into the open ground between the werewolves' squads and the dragon's.
    place: { frontHx: DRAGON_BLUE_HX, away: -1 },
    centreHy: Math.floor(rowHy((WEAPONS.length - 1) / 2)),
  },
];

const MAP_W = Math.ceil((DRAGON_HX + MARGIN) / 2);
const MAP_H = Math.ceil((rowHy(WEAPONS.length - 1) + MARGIN) / 2);

function arenaSpawns(sim: Simulation, arena: Arena): Command[] {
  return [
    ...spawnSquads(sim, arena.blue, { ...arena.place, centreHy: arena.centreHy }, HUMAN_PLAYER, FORMATION),
    {
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_UNARMED,
      x: arena.monsterHx,
      y: arena.centreHy,
      tribe: arena.monster,
      owner: ENEMY_PLAYER,
    },
  ];
}

function build(sim: Simulation): void {
  for (const arena of ARENAS) for (const command of arenaSpawns(sim, arena)) sim.enqueueSetup(command);
}

const BLUE_MEN = ARENAS.reduce((n, arena) => n + headcount(arena.blue), 0);

const { Health, Owner, Settler, Stance } = components;

const settlersOf = (sim: Simulation, player: number): Entity[] =>
  [...sim.world.query(Settler, Owner, Health)].filter((e) => sim.world.get(e, Owner).player === player);

const unhurt = (sim: Simulation, e: Entity): boolean => {
  const health = sim.world.get(e, Health);
  return health.hitpoints >= health.max;
};

export const monsterTrialsScene: SceneDefinition = {
  id: 'monster-trials',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  graphicTribes: [PRIMARY_TRIBE, MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_WEREWOLF, MONSTER_TRIBE_DRAGON],
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.45,
  checks: [
    {
      label: 'every arena fields its squad and its monster, and nobody is hurt before blue is sent',
      predicate: (sim) => {
        const blue = settlersOf(sim, HUMAN_PLAYER);
        const red = settlersOf(sim, ENEMY_PLAYER);
        return (
          blue.length === BLUE_MEN &&
          red.length === ARENAS.length &&
          [...blue, ...red].every((e) => unhurt(sim, e))
        );
      },
    },
    {
      label: 'the were-creatures wait in ATTACK, the dragon in DEFEND, each on its own tribe',
      predicate: (sim) => {
        const red = settlersOf(sim, ENEMY_PLAYER);
        const modeOf = (tribe: number) =>
          red
            .filter((e) => sim.world.get(e, Settler).tribe === tribe)
            .map((e) => sim.world.get(e, Stance).mode);
        const were = [...modeOf(MONSTER_TRIBE_WERESNAKE), ...modeOf(MONSTER_TRIBE_WEREWOLF)];
        const dragon = modeOf(MONSTER_TRIBE_DRAGON);
        return (
          were.length === 2 * WEAPONS.length &&
          were.every((mode) => mode === systems.MILITARY_MODE.ATTACK) &&
          dragon.length === 1 &&
          dragon.every((mode) => mode === systems.MILITARY_MODE.DEFEND)
        );
      },
    },
  ],
};
