import {
  type CellTerrainMap,
  components,
  type Entity,
  type GroupDestination,
  nodeOfPosition,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  JOB_ARCHER,
  JOB_COLLECTOR,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HOME_00,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  placeFlag,
  placeResourceNode,
  placeSandboxSite,
  spawnBoundGatherer,
  spawnSettlerDirect,
  staffBuildingFully,
} from '../game/sandbox/index.js';
import { ownerPlayerOf, positionOf, settlerJobType } from '../game/snapshot-base.js';
import { GATHERER_BY_GOOD, VILLAGE, WAREHOUSE_IDS } from './sandbox/placements.js';
import type { SceneDefinition, SceneStage, StageOrder } from './types.js';

/**
 * The audio pass's listening scene: one world with a place for each thing the mix rations. A melee of
 * a thousand for the voice budget and the world cap; five staffed villages and a row of house
 * foundations for work sounds, chatter and the jingle lane; groups of 1, 5, 20 and 200 for the group
 * answer; a wooded shore with woodcutters for object ambience and zoom; and an outpost raided out of
 * view for the attack alert. Every fight and order waits for its stage's button, which repeats it.
 *
 * Scene ground is the sandbox's flat classes, which no terrain bed is bound to: the beds sound on a
 * decoded map, and in the `?sounds` gallery.
 */

/** Five sandbox villages, three over two, packed at their own extent rather than the sandbox's pitch. */
const VILLAGE_ORIGINS: readonly (readonly [number, number])[] = [
  [0, 0],
  [48, 0],
  [96, 0],
  [0, 56],
  [48, 56],
];
/** A row of home foundations below the villages, finished together with the villages' own by the city
 *  stage's button. */
const SITE_ROW_Y = 113;
const SITE_COUNT = 20;
const FIRST_SITE_X = 4;
/** Tiles from one foundation's column to the next. */
const SITE_PITCH = 7;
const SITE_COLUMNS: readonly number[] = Array.from(
  { length: SITE_COUNT },
  (_, i) => FIRST_SITE_X + i * SITE_PITCH,
);

/** The wooded shore: a stand of trees, woodcutters at its edge, open water past them. */
const FOREST = { x0: 164, x1: 200, dx: 3, y0: 10, y1: 100, dy: 4 } as const;
const WOODCUTTER_FLAGS: readonly (readonly [number, number])[] = [
  [204, 25],
  [204, 45],
  [204, 65],
  [204, 85],
];
const WATER_FROM_X = 236;
const SHORE_BOTTOM_Y = 112;

/** Two armies of 500, each 20 wide and 25 deep, out of each other's sight across open ground. */
const ARMY_COLUMNS = 20;
const ARMY_ROWS = 25;
const ARMY_SPACING = 2;
const OWN_ARMY = { x: 8, y: 128 } as const;
const ENEMY_ARMY = { x: 110, y: 128 } as const;
/** The tile column the armies charge across: each man runs to his mirror image beyond it. */
const MELEE_MID_X = 78;

/** The answering groups, each a job of its own so a stage finds its members by job. */
const ORDER_GROUPS: readonly {
  readonly size: number;
  readonly job: number;
  readonly x: number;
  readonly y: number;
  readonly columns: number;
}[] = [
  { size: 1, job: JOB_SOLDIER_BROADSWORD, x: 176, y: 124, columns: 1 },
  { size: 5, job: JOB_SOLDIER_SPEAR, x: 176, y: 130, columns: 5 },
  { size: 20, job: JOB_ARCHER, x: 176, y: 136, columns: 5 },
  { size: 200, job: JOB_SOLDIER_SPEAR_WOODEN, x: 172, y: 150, columns: 20 },
];
/** Tiles a move order carries a group east, or back west once it stands past the middle. */
const ORDER_MOVE_TILES = 12;
const ORDER_MID_X = 196;
/** The enemy the attack orders aim at: told to ignore the enemy, and too tough to fall. */
const TARGETS = { x: 252, y0: 150, y1: 166, dy: 2 } as const;
const TARGET_HITPOINTS = 1_000_000;

/** An own outpost far from every other stage, and raiders out of its sight who storm it on order. */
const OUTPOST = { x: 30, y: 215 } as const;
const RAIDERS = { x: 110, y0: 210, y1: 220, dy: 2 } as const;

const MAP_W = 260;
const MAP_H = 230;
const RUN_TICKS = 1;

const ZOOM_NEAR = 1;
const ZOOM_MID = 0.6;
const ZOOM_FAR = 0.35;

const { Health, Stance } = components;

function terrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      typeIds[y * MAP_W + x] = x >= WATER_FROM_X && y < SHORE_BOTTOM_Y ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function buildCity(sim: Simulation): void {
  for (const [ox, oy] of VILLAGE_ORIGINS) {
    for (const b of VILLAGE) {
      const e = placeBuiltSandboxBuilding(sim, b.id, ox + b.x, oy + b.y, HUMAN_PLAYER, {
        fillStock: WAREHOUSE_IDS.has(b.id),
      });
      staffBuildingFully(sim, e);
    }
  }
  for (const x of SITE_COLUMNS) placeSandboxSite(sim, BUILDING_HOME_00, x, SITE_ROW_Y);
}

function buildShore(sim: Simulation): void {
  const wood = GATHERER_BY_GOOD.get(GOOD_WOOD);
  if (wood === undefined) throw new Error('audio-mix: no woodcutting trade in the sandbox');
  for (let x = FOREST.x0; x <= FOREST.x1; x += FOREST.dx) {
    for (let y = FOREST.y0; y <= FOREST.y1; y += FOREST.dy) placeResourceNode(sim, wood, x, y);
  }
  for (const [x, y] of WOODCUTTER_FLAGS) {
    const flag = placeFlag(sim, x, y);
    spawnBoundGatherer(sim, JOB_COLLECTOR, x, y + 1, flag, { goodType: GOOD_WOOD });
  }
}

function spawnBlock(
  sim: Simulation,
  job: number,
  owner: number,
  at: { readonly x: number; readonly y: number },
  count: number,
  columns: number,
  spacing: number,
): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const x = at.x + (i % columns) * spacing;
    const y = at.y + Math.floor(i / columns) * spacing;
    out.push(spawnSettlerDirect(sim, job, x, y, owner));
  }
  return out;
}

function standFirm(sim: Simulation, e: Entity): void {
  const stance = sim.world.mut(e, Stance);
  stance.mode = systems.MILITARY_MODE.IGNORE;
  stance.anchorCell = null;
  const health = sim.world.mut(e, Health);
  health.hitpoints = TARGET_HITPOINTS;
  health.max = TARGET_HITPOINTS;
}

function build(sim: Simulation): void {
  buildCity(sim);
  buildShore(sim);
  const armySize = ARMY_COLUMNS * ARMY_ROWS;
  spawnBlock(sim, JOB_SOLDIER_SWORD, HUMAN_PLAYER, OWN_ARMY, armySize, ARMY_COLUMNS, ARMY_SPACING);
  spawnBlock(sim, JOB_SOLDIER_SWORD, ENEMY_PLAYER, ENEMY_ARMY, armySize, ARMY_COLUMNS, ARMY_SPACING);
  for (const g of ORDER_GROUPS) spawnBlock(sim, g.job, HUMAN_PLAYER, g, g.size, g.columns, ARMY_SPACING);
  for (let y = TARGETS.y0; y <= TARGETS.y1; y += TARGETS.dy) {
    standFirm(sim, spawnSettlerDirect(sim, JOB_SOLDIER_UNARMED, TARGETS.x, y, ENEMY_PLAYER));
  }
  placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, OUTPOST.x, OUTPOST.y, HUMAN_PLAYER);
  for (let y = RAIDERS.y0; y <= RAIDERS.y1; y += RAIDERS.dy) {
    spawnSettlerDirect(sim, JOB_SOLDIER_BROADSWORD, RAIDERS.x, y, ENEMY_PLAYER);
  }
}

// ─── Stage orders, read off the world as it stands when a button is pressed ─────────────────────────

interface Member {
  readonly id: number;
  readonly hx: number;
  readonly hy: number;
}

/** The living settlers `owner` fields with `job`, where they stand on the half-cell lattice. */
export function membersOf(snapshot: WorldSnapshot, owner: number, job: number): Member[] {
  const out: Member[] = [];
  for (const e of snapshot.entities) {
    if (settlerJobType(e) !== job || ownerPlayerOf(e) !== owner) continue;
    const p = positionOf(e);
    if (p === undefined) continue;
    const node = nodeOfPosition(p.x, p.y);
    out.push({ id: e.id, hx: node.hx, hy: node.hy });
  }
  return out;
}

/** Half-cell nodes per tile along x. */
const NODES_PER_TILE = 2;

/** Each army charges at the other: every man attack-moves to his mirror image across the middle. */
function charge(snapshot: WorldSnapshot): StageOrder[] {
  const midHx = MELEE_MID_X * NODES_PER_TILE;
  return [HUMAN_PLAYER, ENEMY_PLAYER].map((owner) => {
    const members: GroupDestination[] = membersOf(snapshot, owner, JOB_SOLDIER_SWORD).map((m) => ({
      entity: m.id as Entity,
      x: 2 * midHx - m.hx,
      y: m.hy,
    }));
    return { by: 'admin', command: { kind: 'attackMoveUnitGroup', members } };
  });
}

function moveGroup(job: number): (snapshot: WorldSnapshot) => StageOrder[] {
  return (snapshot) => {
    const members = membersOf(snapshot, HUMAN_PLAYER, job);
    if (members.length === 0) return [];
    const meanHx = members.reduce((sum, m) => sum + m.hx, 0) / members.length;
    const shift = (meanHx < ORDER_MID_X * NODES_PER_TILE ? 1 : -1) * ORDER_MOVE_TILES * NODES_PER_TILE;
    const destinations = members.map((m) => ({ entity: m.id as Entity, x: m.hx + shift, y: m.hy }));
    return [{ by: 'viewer', command: { kind: 'moveUnitGroup', members: destinations } }];
  };
}

function attackGroup(job: number): (snapshot: WorldSnapshot) => StageOrder[] {
  return (snapshot) => {
    const members = membersOf(snapshot, HUMAN_PLAYER, job);
    const target = membersOf(snapshot, ENEMY_PLAYER, JOB_SOLDIER_UNARMED)[0];
    if (members.length === 0 || target === undefined) return [];
    const group = members.map((m) => ({ entity: m.id as Entity }));
    return [
      { by: 'viewer', command: { kind: 'attackUnitGroup', members: group, target: target.id as Entity } },
    ];
  };
}

/** Every unfinished own building finishes at once: a burst of house-built jingles for the lane. */
function finishSites(snapshot: WorldSnapshot): StageOrder[] {
  const orders: StageOrder[] = [];
  for (const e of snapshot.entities) {
    if (e.components.UnderConstruction === undefined || ownerPlayerOf(e) !== HUMAN_PLAYER) continue;
    orders.push({ by: 'admin', command: { kind: 'debugCompleteConstruction', target: e.id as Entity } });
  }
  return orders;
}

/** The raiders storm the outpost, wherever the camera is. */
function raid(snapshot: WorldSnapshot): StageOrder[] {
  const outpost = { hx: OUTPOST.x * NODES_PER_TILE, hy: OUTPOST.y * NODES_PER_TILE };
  const members = membersOf(snapshot, ENEMY_PLAYER, JOB_SOLDIER_BROADSWORD).map((m, i) => ({
    entity: m.id as Entity,
    x: outpost.hx,
    y: outpost.hy + i,
  }));
  return members.length === 0 ? [] : [{ by: 'admin', command: { kind: 'attackMoveUnitGroup', members } }];
}

/** Where each stage's camera looks: the middle of the five villages, the answering groups between
 *  their spot and their targets, and the woodcutters at the forest's edge. */
const CITY_FOCUS = { x: 72, y: 56 } as const;
const ORDERS_FOCUS = { x: 200, y: 150 } as const;
const SHORE_FOCUS = { x: 214, y: 56 } as const;

export const AUDIO_MIX_STAGES: readonly SceneStage[] = [
  {
    id: 'melee',
    focus: { x: MELEE_MID_X, y: OWN_ARMY.y + ARMY_ROWS },
    zoom: ZOOM_MID,
    actions: [{ label: 'charge', kind: 'orders', orders: charge }],
  },
  {
    id: 'city',
    focus: CITY_FOCUS,
    zoom: ZOOM_FAR,
    actions: [{ label: 'finishSites', kind: 'orders', orders: finishSites }],
  },
  {
    id: 'orders',
    focus: ORDERS_FOCUS,
    zoom: ZOOM_MID,
    actions: ORDER_GROUPS.flatMap((g) => [
      { label: 'move', values: { size: g.size }, kind: 'orders' as const, orders: moveGroup(g.job) },
      { label: 'attack', values: { size: g.size }, kind: 'orders' as const, orders: attackGroup(g.job) },
    ]),
  },
  {
    id: 'shore',
    focus: SHORE_FOCUS,
    zoom: ZOOM_NEAR,
    actions: [
      { label: 'zoomNear', kind: 'zoom', zoom: ZOOM_NEAR },
      { label: 'zoomMid', kind: 'zoom', zoom: ZOOM_MID },
      { label: 'zoomFar', kind: 'zoom', zoom: ZOOM_FAR },
    ],
  },
  {
    id: 'alert',
    focus: SHORE_FOCUS,
    zoom: ZOOM_MID,
    actions: [{ label: 'raid', kind: 'orders', orders: raid }],
  },
];

// ─── Headless checks ──────────────────────────────────────────────────────────────────────────────

function count(sim: Simulation, owner: number, job: number): number {
  return membersOf(sim.snapshot(), owner, job).length;
}

export const audioMixScene: SceneDefinition = {
  id: 'audio-mix',
  seed: 97,
  terrain: terrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: ZOOM_MID,
  stages: AUDIO_MIX_STAGES,
  checks: [
    {
      label: 'a thousand swordsmen stand in two armies of 500, out of each other`s sight',
      predicate: (sim) => {
        const own = membersOf(sim.snapshot(), HUMAN_PLAYER, JOB_SOLDIER_SWORD);
        const enemy = membersOf(sim.snapshot(), ENEMY_PLAYER, JOB_SOLDIER_SWORD);
        const ownFront = Math.max(...own.map((m) => m.hx));
        const enemyFront = Math.min(...enemy.map((m) => m.hx));
        const half = ARMY_COLUMNS * ARMY_ROWS;
        return (
          own.length === half && enemy.length === half && enemyFront - ownFront > systems.SIGHT_RADIUS_NODES
        );
      },
    },
    {
      label: 'the city stands at least 200 buildings with a crew at work',
      predicate: (sim) => {
        let buildings = 0;
        for (const e of sim.world.query(components.Building, components.Owner)) {
          if (sim.world.get(e, components.Owner).player === HUMAN_PLAYER) buildings++;
        }
        const crew = [...sim.world.query(components.JobAssignment)].length;
        return buildings >= 200 && crew >= 200;
      },
    },
    {
      label: 'groups of 1, 5, 20 and 200 wait for orders',
      predicate: (sim) => ORDER_GROUPS.every((g) => count(sim, HUMAN_PLAYER, g.job) === g.size),
    },
    {
      label: 'every stage order names the members it should',
      predicate: (sim) => {
        const snapshot = sim.snapshot();
        const commandSizes = (orders: StageOrder[]): number[] =>
          orders.map((o) => ('members' in o.command ? o.command.members.length : 1));
        const half = ARMY_COLUMNS * ARMY_ROWS;
        return (
          commandSizes(charge(snapshot)).join() === `${half},${half}` &&
          commandSizes(finishSites(snapshot)).length >= SITE_COLUMNS.length &&
          ORDER_GROUPS.every(
            (g) =>
              commandSizes(moveGroup(g.job)(snapshot)).join() === `${g.size}` &&
              commandSizes(attackGroup(g.job)(snapshot)).join() === `${g.size}`,
          ) &&
          commandSizes(raid(snapshot)).join() === `${(RAIDERS.y1 - RAIDERS.y0) / RAIDERS.dy + 1}`
        );
      },
    },
    {
      label: 'the raiders stand beyond sight of the outpost',
      predicate: (sim) =>
        membersOf(sim.snapshot(), ENEMY_PLAYER, JOB_SOLDIER_BROADSWORD).every(
          (m) => m.hx - OUTPOST.x * NODES_PER_TILE > systems.SIGHT_RADIUS_NODES,
        ),
    },
  ],
};
