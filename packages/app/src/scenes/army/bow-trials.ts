import {
  type Command,
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type PlayerCommand,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { grassTerrain, resolveVikingBuilding } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { VEHICLE_CATAPULT } from '../../game/sandbox/index.js';
import {
  healthOf,
  isBuilding,
  isSettler,
  isVehicle,
  ownerPlayerOf,
  positionOf,
} from '../../game/snapshot/base.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition, SceneStage, StageAction, StageOrder } from '../types.js';

/**
 * Bow trials: arenas of small fights, short bows against long ones in every armour, as veterans, behind a
 * sword line, under a sword charge, against a manned tower and a catapult, and sword duels that weigh
 * leather. Nobody fights before an order: each arena is a stage whose buttons send one side or both.
 * Blue holds the short bows wherever both bows meet.
 */

type ArmourSlug = 'armor_wool' | 'armor_leather' | 'armor_chain' | 'armor_plate';

interface Squad {
  readonly job: number;
  readonly count: number;
  readonly armour: ArmourSlug | null;
  readonly points: number;
}

type Arena =
  | {
      readonly id: string;
      readonly kind: 'field';
      readonly blue: readonly Squad[];
      readonly red: readonly Squad[];
    }
  /** Blue's tower, every post of it manned, against red's squad. */
  | { readonly id: string; readonly kind: 'tower'; readonly tower: string; readonly red: readonly Squad[] }
  /** Blue's squad against red's commanded catapult. */
  | { readonly id: string; readonly kind: 'catapult'; readonly blue: readonly Squad[] };

/** Half-cell nodes from one front file to the other: past every bow's reach and a soldier's sight, so
 *  nobody fights before an order. */
const FRONT_GAP = 60;
/** Room behind a front for its columns. */
const REAR_DEPTH = 16;
const ARENA_W = 2 * REAR_DEPTH + FRONT_GAP;
const ARENA_H = 24;
/** Open ground between arenas, wider than a posted long bow's reach from a tower wall, so no fight
 *  draws in a neighbouring arena. */
const ARENA_GAP = 40;
const MARGIN = 20;
const COLUMNS = 3;
const PITCH_X = ARENA_W + ARENA_GAP;
const PITCH_Y = ARENA_H + ARENA_GAP;
/** A squad stands in columns of five, files four nodes apart, each column three nodes behind the last. */
const FILE_SIZE = 5;
const FILE_STEP = 4;
const COLUMN_STEP = 3;
/** West of the tower, clear of its footprint: where the garrison stands before it takes its posts. */
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

const squad = (job: number, count: number, armour: ArmourSlug | null, points = 0): Squad => ({
  job,
  count,
  armour,
  points,
});

/** Ten short bows against ten long ones, both sides in one armour. */
const bowDuel = (id: string, armour: ArmourSlug | null, points = 0): Arena => ({
  id,
  kind: 'field',
  blue: [squad(JOB_ARCHER, BOWS, armour, points)],
  red: [squad(JOB_ARCHER_LONG, BOWS, armour, points)],
});

/** Five swords in front of ten bows a side, short behind blue's line, long behind red's. */
const swordLine = (id: string, armour: ArmourSlug): Arena => ({
  id,
  kind: 'field',
  blue: [squad(JOB_SOLDIER_SWORD, SWORD_LINE, armour), squad(JOB_ARCHER, BOWS, armour)],
  red: [squad(JOB_SOLDIER_SWORD, SWORD_LINE, armour), squad(JOB_ARCHER_LONG, BOWS, armour)],
});

/** Leather bows meet a charge of chain-mailed swords. */
const charge = (id: string, bow: number): Arena => ({
  id,
  kind: 'field',
  blue: [squad(bow, BOWS, 'armor_leather')],
  red: [squad(JOB_SOLDIER_SWORD, CHARGE, 'armor_chain')],
});

const swordDuel = (id: string, red: ArmourSlug | null): Arena => ({
  id,
  kind: 'field',
  blue: [squad(JOB_SOLDIER_SWORD, SWORDS, 'armor_leather')],
  red: [squad(JOB_SOLDIER_SWORD, SWORDS, red)],
});

const MIXED: readonly (ArmourSlug | null)[] = [
  null,
  'armor_wool',
  'armor_leather',
  'armor_chain',
  'armor_plate',
];
const mixedSide = (job: number): Squad[] => MIXED.map((armour) => squad(job, BOWS / MIXED.length, armour));

/** Laid out three a row, west to east, then north to south. */
export const BOW_TRIAL_ARENAS: readonly Arena[] = [
  bowDuel('bare', null),
  bowDuel('wool', 'armor_wool'),
  bowDuel('leather', 'armor_leather'),
  bowDuel('chain', 'armor_chain'),
  bowDuel('plate', 'armor_plate'),
  { id: 'mixed', kind: 'field', blue: mixedSide(JOB_ARCHER), red: mixedSide(JOB_ARCHER_LONG) },
  bowDuel('veteranWool', 'armor_wool', VETERAN_POINTS),
  bowDuel('veteranLeather', 'armor_leather', VETERAN_POINTS),
  bowDuel('veteranChain', 'armor_chain', VETERAN_POINTS),
  swordLine('lineWool', 'armor_wool'),
  swordLine('lineLeather', 'armor_leather'),
  swordLine('lineChain', 'armor_chain'),
  charge('shortCharge', JOB_ARCHER),
  charge('longCharge', JOB_ARCHER_LONG),
  swordDuel('swordsLeatherWool', 'armor_wool'),
  { id: 'towerLong', kind: 'tower', tower: 'tower_00', red: [squad(JOB_ARCHER_LONG, BOWS, 'armor_leather')] },
  { id: 'towerShort', kind: 'tower', tower: 'tower_00', red: [squad(JOB_ARCHER, BOWS, 'armor_leather')] },
  {
    id: 'bigTowerLong',
    kind: 'tower',
    tower: 'tower_01',
    red: [squad(JOB_ARCHER_LONG, BOWS, 'armor_leather')],
  },
  { id: 'shortCatapult', kind: 'catapult', blue: [squad(JOB_ARCHER, BOWS, 'armor_leather')] },
  { id: 'longCatapult', kind: 'catapult', blue: [squad(JOB_ARCHER_LONG, BOWS, 'armor_leather')] },
  swordDuel('swordsLeatherBare', null),
];

const ROWS = Math.ceil(BOW_TRIAL_ARENAS.length / COLUMNS);
const MAP_W = (2 * MARGIN + COLUMNS * PITCH_X - ARENA_GAP) / 2;
const MAP_H = (2 * MARGIN + ROWS * PITCH_Y - ARENA_GAP) / 2;
/** Each arena's fight fills about this much of the screen: both fronts in view. */
const ARENA_ZOOM = 0.5;
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

/** The arena whose ground holds node (hx, hy), each owning half the open ground around it. */
export function bowTrialArenaAt(hx: number, hy: number): number | null {
  const column = Math.floor((hx - MARGIN + ARENA_GAP / 2) / PITCH_X);
  const row = Math.floor((hy - MARGIN + ARENA_GAP / 2) / PITCH_Y);
  if (column < 0 || column >= COLUMNS || row < 0) return null;
  const index = row * COLUMNS + column;
  return index < BOW_TRIAL_ARENAS.length ? index : null;
}

/** The node nearest (hx, hy) that anchors a cell, the only nodes a building or vehicle stands on. */
function anchorNear(hx: number, hy: number): { hx: number; hy: number } {
  return cellAnchorNode(Math.floor(hx / 2), Math.floor(hy / 2));
}

function spawnSquads(
  sim: Simulation,
  squads: readonly Squad[],
  frontHx: number,
  frame: Frame,
  owner: number,
): Command[] {
  // Columns deepen away from the enemy: west for blue, east for red.
  const away = owner === HUMAN_PLAYER ? -1 : 1;
  const commands: Command[] = [];
  let place = 0;
  for (const s of squads) {
    for (let i = 0; i < s.count; i++, place++) {
      const column = Math.floor(place / FILE_SIZE);
      const file = place % FILE_SIZE;
      // Every other column stands half a file over, so the ranks read as loose rather than a grid.
      const hy = frame.centreHy + (file - (FILE_SIZE - 1) / 2) * FILE_STEP + (column % 2) * (FILE_STEP / 2);
      commands.push(fighter(sim, s, frontHx + away * column * COLUMN_STEP, hy, owner));
    }
  }
  return commands;
}

function fighter(sim: Simulation, s: Squad, hx: number, hy: number, owner: number): Command {
  return {
    kind: 'spawnSettler',
    jobType: s.job,
    x: hx,
    y: hy,
    tribe: PRIMARY_TRIBE,
    owner,
    ...(s.armour === null ? {} : { equipment: { armor: { goodType: goodBySlug(sim, s.armour) } } }),
    ...(s.points > 0
      ? {
          experience: [
            [systems.FIGHT_EXPERIENCE_TYPE.PERSONAL, systems.fightUnitsOfPoints(s.points)] as const,
          ],
        }
      : {}),
  };
}

function arenaSpawns(sim: Simulation, arena: Arena, frame: Frame): Command[] {
  switch (arena.kind) {
    case 'field':
      return [
        ...spawnSquads(sim, arena.blue, frame.blueHx, frame, HUMAN_PLAYER),
        ...spawnSquads(sim, arena.red, frame.redHx, frame, ENEMY_PLAYER),
      ];
    case 'tower': {
      const at = anchorNear(frame.blueHx, frame.centreHy);
      const posts = garrisonOf(arena) / 2;
      const garrison = [squad(JOB_ARCHER, posts, null), squad(JOB_ARCHER_LONG, posts, null)];
      return [
        {
          kind: 'placeBuilding',
          buildingType: resolveVikingBuilding(arena.tower).typeId,
          x: at.hx,
          y: at.hy,
          tribe: PRIMARY_TRIBE,
          owner: HUMAN_PLAYER,
          // Served content gates the tower behind progression; the sandbox catalog does not.
          ignoreTechnology: true,
        },
        ...spawnSquads(sim, garrison, at.hx - GARRISON_OFFSET, frame, HUMAN_PLAYER).map((c) =>
          c.kind === 'spawnSettler' ? { ...c, workplace: { x: at.hx, y: at.hy } } : c,
        ),
        ...spawnSquads(sim, arena.red, frame.redHx, frame, ENEMY_PLAYER),
      ];
    }
    case 'catapult': {
      const at = anchorNear(frame.redHx, frame.centreHy);
      return [
        ...spawnSquads(sim, arena.blue, frame.blueHx, frame, HUMAN_PLAYER),
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
}

function build(sim: Simulation): void {
  BOW_TRIAL_ARENAS.forEach((arena, index) => {
    for (const command of arenaSpawns(sim, arena, frameOf(index))) sim.enqueueSetup(command);
  });
}

interface Standing {
  readonly id: Entity;
  readonly hx: number;
  readonly hy: number;
}

/** The living entities `owner` has on arena `index`'s ground that `kind` picks out. */
function standingIn(
  snapshot: WorldSnapshot,
  index: number,
  owner: number,
  kind: (e: WorldSnapshot['entities'][number]) => boolean,
): Standing[] {
  const out: Standing[] = [];
  for (const e of snapshot.entities) {
    if (!kind(e) || ownerPlayerOf(e) !== owner || (healthOf(e)?.hitpoints ?? 0) <= 0) continue;
    const p = positionOf(e);
    if (p === undefined) continue;
    const node = nodeOfPosition(p.x, p.y);
    if (bowTrialArenaAt(node.hx, node.hy) === index)
      out.push({ id: e.id as Entity, hx: node.hx, hy: node.hy });
  }
  return out;
}

/** A group order either side may take. */
type SideCommand = Extract<PlayerCommand, { kind: 'attackMoveUnitGroup' | 'attackUnitGroup' }>;

/** Blue's orders go through the viewer's own order path, red's in as trusted input. */
function sideOrder(owner: number, command: SideCommand): StageOrder {
  return owner === HUMAN_PLAYER ? { by: 'viewer', command } : { by: 'admin', command };
}

/** `owner`'s fighters march through to the far side of the arena, each on its own row, fighting on the way. */
function advance(snapshot: WorldSnapshot, index: number, owner: number): StageOrder[] {
  const frame = frameOf(index);
  const mirror = frame.blueHx + frame.redHx;
  const members = standingIn(snapshot, index, owner, isSettler).map((m) => ({
    entity: m.id,
    x: mirror - m.hx,
    y: m.hy,
  }));
  return members.length === 0 ? [] : [sideOrder(owner, { kind: 'attackMoveUnitGroup', members })];
}

/** `owner`'s fighters attack the one `targetKind` entity the other side has on the arena. */
function storm(
  snapshot: WorldSnapshot,
  index: number,
  owner: number,
  targetKind: (e: WorldSnapshot['entities'][number]) => boolean,
): StageOrder[] {
  const enemy = owner === HUMAN_PLAYER ? ENEMY_PLAYER : HUMAN_PLAYER;
  const target = standingIn(snapshot, index, enemy, targetKind)[0];
  const members = standingIn(snapshot, index, owner, isSettler).map((m) => ({ entity: m.id }));
  if (target === undefined || members.length === 0) return [];
  return [sideOrder(owner, { kind: 'attackUnitGroup', members, target: target.id })];
}

/** The catapult rolls through to blue's side, firing on the way. */
function catapultAdvance(snapshot: WorldSnapshot, index: number): StageOrder[] {
  const frame = frameOf(index);
  return standingIn(snapshot, index, ENEMY_PLAYER, isVehicle).map((v) => ({
    by: 'admin',
    command: {
      kind: 'moveVehicle',
      vehicle: v.id,
      x: frame.blueHx + frame.redHx - v.hx,
      y: v.hy,
      attackMove: true,
    },
  }));
}

/** Each arena's actions, its first the one the overview's start button issues. */
function arenaActions(arena: Arena, index: number): StageAction[] {
  switch (arena.kind) {
    case 'field':
      return [
        {
          label: 'meet',
          kind: 'orders',
          orders: (s) => [...advance(s, index, HUMAN_PLAYER), ...advance(s, index, ENEMY_PLAYER)],
        },
        { label: 'blueAdvances', kind: 'orders', orders: (s) => advance(s, index, HUMAN_PLAYER) },
        { label: 'redAdvances', kind: 'orders', orders: (s) => advance(s, index, ENEMY_PLAYER) },
      ];
    case 'tower':
      return [
        { label: 'stormTower', kind: 'orders', orders: (s) => storm(s, index, ENEMY_PLAYER, isBuilding) },
        { label: 'redAdvances', kind: 'orders', orders: (s) => advance(s, index, ENEMY_PLAYER) },
      ];
    case 'catapult':
      return [
        { label: 'stormCatapult', kind: 'orders', orders: (s) => storm(s, index, HUMAN_PLAYER, isVehicle) },
        {
          label: 'meet',
          kind: 'orders',
          orders: (s) => [...advance(s, index, HUMAN_PLAYER), ...catapultAdvance(s, index)],
        },
      ];
  }
}

const ARENA_ACTIONS = BOW_TRIAL_ARENAS.map(arenaActions);

/** Every arena's first action at once. */
export function startEveryArena(snapshot: WorldSnapshot): StageOrder[] {
  return ARENA_ACTIONS.flatMap((actions) => {
    const first = actions[0];
    return first?.kind === 'orders' ? first.orders(snapshot) : [];
  });
}

const STAGES: readonly SceneStage[] = [
  {
    id: 'all',
    focus: { x: MAP_W / 2, y: MAP_H / 2 },
    zoom: ARENA_ZOOM,
    actions: [{ label: 'everyStart', kind: 'orders', orders: startEveryArena }],
  },
  ...BOW_TRIAL_ARENAS.map((arena, index) => {
    const frame = frameOf(index);
    return {
      id: arena.id,
      focus: { x: (frame.blueHx + frame.redHx) / 4, y: frame.centreHy / 2 },
      zoom: ARENA_ZOOM,
      actions: ARENA_ACTIONS[index] ?? [],
    };
  }),
];

const headcount = (squads: readonly Squad[]): number => squads.reduce((n, s) => n + s.count, 0);
const garrisonOf = (arena: Arena): number =>
  arena.kind === 'tower' ? 2 * (TOWER_POSTS[arena.tower] ?? 0) : 0;

function settlersOf(arena: Arena): number {
  switch (arena.kind) {
    case 'field':
      return headcount(arena.blue) + headcount(arena.red);
    case 'tower':
      return garrisonOf(arena) + headcount(arena.red);
    case 'catapult':
      // The catapult's commander.
      return headcount(arena.blue) + 1;
  }
}

const SETTLERS = BOW_TRIAL_ARENAS.reduce((n, arena) => n + settlersOf(arena), 0);
const POSTS = BOW_TRIAL_ARENAS.reduce((n, arena) => n + garrisonOf(arena), 0);

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
  initialZoom: ARENA_ZOOM,
  stages: STAGES,
  checks: [
    {
      label: 'every arena fields its fighters, and nobody is hurt before an order',
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
