import type { MapEscalation } from '@open-northland/data';
import { Building, ownerOf, Settler } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { isFighterJob } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { hexNodeDistance, manhattan } from '../../../spatial/metric.js';
import { entityNode } from '../../../spatial/nodes.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import { isBuilt } from '../../seat-roster.js';
import { spokenFor } from '../errand.js';
import {
  nearestRaiderWithin,
  type Raider,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from './threat.js';

/**
 * How many archers the strategic seat walls into each tower it raises. A posted man leaves the field army
 * for good ({@link import('../census.js').takeCensus} drops him), so a seat with five soldiers and a
 * standing tower holds its wave back rather than leave the wall silent.
 */
export const TOWER_GARRISON_ARCHERS = 3;

/** Archers of each class the scripted handler keeps in a tower while no raider is near it. Original
 *  behavior; it fills every class slot to its count while the tower is in defence mode. */
export const MAP_AI_PEACE_ARCHERS_PER_CLASS = 1;

/** How near a tower an archer must stand to take one of the extra posts a raider opens there, in map
 *  points. Original behavior for every post; the peace posts here take any reachable archer. */
export const MAP_AI_DEFENCE_REACH_POINTS = 20;

/**
 * Who decides how many archers a tower holds: the strategic seat ({@link TOWER_GARRISON_ARCHERS} in all),
 * or the scripted handler ({@link MAP_AI_PEACE_ARCHERS_PER_CLASS} per class, every slot while a raider
 * is near, the extra men sent back out once he is gone).
 */
export type TowerCrewRule = 'computer-player' | 'map-ai';

/** The postings this decision made, and the men they spend. */
export interface PostOrders {
  readonly commands: readonly PlayerCommand[];
  /** Men sent to a wall this decision. Their assignment only applies next tick, so the army has to be told
   *  here or it would march them off again in the same batch. */
  readonly claimed: ReadonlySet<Entity>;
}

/**
 * Man the seat's towers by `rule` from its free archers, nearest the door first, taken only from classes
 * the tower offers a slot for. The towers take one man per round in turn, so a seat short of archers
 * spreads them over every wall rather than filling the first ones it owns.
 *
 * A fighting slot is manned, not trained into (`economy/jobs/openings.ts`), so a seat whose archers are all
 * of the wrong class leaves the wall empty rather than reach into the drafting rung.
 *
 * Approximation for the scripted rule: the original holds a tower's defence mode for 360 ticks after the
 * last blow nearby; here a raider inside the tower's watch band fills it, and the extra men leave once no
 * raider stands within a further {@link THREAT_STAND_DOWN_MARGIN_NODES}. The original visits one tower per
 * turn and takes only men within {@link MAP_AI_DEFENCE_REACH_POINTS}; here every tower is manned each
 * decision, and only the extra posts keep that reach, so a quiet tower far from the soldiers still gets
 * its archer while an authored band elsewhere is not pulled off its task by a raid.
 */
export function towerPostOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  ready: readonly Entity[],
  rule: TowerCrewRule,
  raiders: () => readonly Raider[],
): PostOrders {
  const commands: PlayerCommand[] = [];
  const claimed = new Set<Entity>();
  // Nobody to post, and the strategic rule sends nobody out.
  if (rule === 'computer-player' && ready.length === 0) return { commands, claimed };
  const walls = standingWalls(world, ctx, terrain, owned, rule, raiders);
  if (rule === 'map-ai') commands.push(...releaseOrders(walls));
  let open = walls.filter(wantsMore);
  while (open.length > 0 && claimed.size < ready.length) {
    const next: Wall[] = [];
    for (const wall of open) {
      const pick = nearestFreeArcher(world, terrain, ready, claimed, wall);
      if (pick === null) continue;
      claimed.add(pick.archer);
      wall.crew.set(pick.jobType, (wall.crew.get(pick.jobType) ?? 0) + 1);
      commands.push({
        kind: 'assignWorker',
        entity: pick.archer,
        building: wall.tower,
        jobPriority: [pick.jobType],
      });
      if (wantsMore(wall)) next.push(wall);
    }
    open = next;
  }
  return { commands, claimed };
}

const garrisonSlotMemo = new WeakMap<SystemContext['content'], Map<number, ReadonlyMap<number, number>>>();

/** The fighting classes a building employs and how many of each (the towers' `logicworker 40/41` bow-soldier
 *  posts), empty for every building staffed by civilians alone. The shared per-content table; never mutate it. */
export function garrisonSlots(
  world: World,
  ctx: SystemContext,
  building: Entity,
): ReadonlyMap<number, number> {
  const buildingType = world.get(building, Building).buildingType;
  let byType = garrisonSlotMemo.get(ctx.content);
  if (byType === undefined) {
    byType = new Map();
    garrisonSlotMemo.set(ctx.content, byType);
  }
  const held = byType.get(buildingType);
  if (held !== undefined) return held;
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  const slots = new Map<number, number>();
  for (const slot of type?.workers ?? []) {
    if (isFighterJob(ctx.content, slot.jobType)) slots.set(slot.jobType, slot.count);
  }
  byType.set(buildingType, slots);
  return slots;
}

/** The standing towers of `owned` with a garrison posted: the ones that shoot. In `owned`'s order. */
export function mannedTowers(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity[] {
  return owned.filter(
    (e) => isBuilt(world, e) && garrisonSlots(world, ctx, e).size > 0 && assignedWorkers(world, e).length > 0,
  );
}

/** One standing tower this decision mans: the men it wants of each class and in all, the men of each
 *  class it keeps before sending one out, where its door is, and who holds it, counted as men are posted. */
interface Wall {
  readonly tower: Entity;
  readonly door: NodeId;
  readonly want: ReadonlyMap<number, number>;
  readonly keep: ReadonlyMap<number, number>;
  /** Men of each class any reachable archer may fill; a post past this takes only a near one. */
  readonly open: ReadonlyMap<number, number>;
  readonly total: number;
  readonly crew: Map<number, number>;
  readonly posted: ReadonlyMap<number, readonly Entity[]>;
}

function standingWalls(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  rule: TowerCrewRule,
  raiders: () => readonly Raider[],
): Wall[] {
  const walls: Wall[] = [];
  for (const tower of owned) {
    if (!isBuilt(world, tower)) continue;
    const slots = garrisonSlots(world, ctx, tower);
    if (slots.size === 0) continue;
    const tribe = world.get(tower, Building).tribe;
    const door = interactionCell(world, ctx, terrain, tower);
    const posted = postedMen(world, tower);
    const crew = new Map([...posted].map(([job, men]) => [job, men.length]));
    if (rule === 'computer-player') {
      walls.push({
        tower,
        door,
        want: slots,
        keep: slots,
        open: slots,
        total: TOWER_GARRISON_ARCHERS,
        crew,
        posted,
      });
      continue;
    }
    const at = terrain.coordsOf(door);
    const watch = threatWatchNodes(ctx, tribe) + THREAT_STAND_DOWN_MARGIN_NODES;
    const near = raiders();
    const threatened = nearestRaiderWithin(near, at.x, at.y, watch, null) !== null;
    const calm =
      !threatened &&
      nearestRaiderWithin(near, at.x, at.y, watch + THREAT_STAND_DOWN_MARGIN_NODES, null) === null;
    const peace = peaceSlots(slots);
    walls.push({
      tower,
      door,
      want: threatened ? slots : peace,
      keep: calm ? calmKeep(ctx, ownerOf(world, tower), slots, peace) : slots,
      open: peace,
      total: Number.POSITIVE_INFINITY,
      crew,
      posted,
    });
  }
  return walls;
}

const peaceSlotMemo = new WeakMap<ReadonlyMap<number, number>, ReadonlyMap<number, number>>();

/** The scripted rule's quiet crew for a tower of `slots`, shared like the slots it derives from. */
function peaceSlots(slots: ReadonlyMap<number, number>): ReadonlyMap<number, number> {
  let peace = peaceSlotMemo.get(slots);
  if (peace === undefined) {
    const quiet = new Map<number, number>();
    for (const [job, count] of slots) quiet.set(job, Math.min(count, MAP_AI_PEACE_ARCHERS_PER_CLASS));
    peace = quiet;
    peaceSlotMemo.set(slots, peace);
  }
  return peace;
}

const heldCrewMemo = new WeakMap<
  MapEscalation,
  WeakMap<ReadonlyMap<number, number>, ReadonlyMap<number, number>>
>();

/**
 * The men of each class a calm tower of `slots` keeps under the scripted rule: its quiet crew, or for the
 * fortress seat of a map escalation that mans its towers, that garrison where larger, so the program
 * never sends the escalation's archers back out. Shared like the slots it derives from.
 */
function calmKeep(
  ctx: SystemContext,
  owner: number | undefined,
  slots: ReadonlyMap<number, number>,
  peace: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const escalation = ctx.mapEscalation;
  const garrison = escalation?.towerGarrison;
  if (escalation === undefined || garrison === undefined || owner !== escalation.keep.seat) return peace;
  let bySlots = heldCrewMemo.get(escalation);
  if (bySlots === undefined) {
    bySlots = new WeakMap();
    heldCrewMemo.set(escalation, bySlots);
  }
  let keep = bySlots.get(slots);
  if (keep === undefined) {
    const held = new Map(peace);
    for (const slot of garrison.slots) {
      const posts = slots.get(slot.job) ?? 0;
      held.set(slot.job, Math.max(held.get(slot.job) ?? 0, Math.min(slot.count, posts)));
    }
    keep = held;
    bySlots.set(slots, keep);
  }
  return keep;
}

/** The men employed at `tower`, by class. */
function postedMen(world: World, tower: Entity): Map<number, Entity[]> {
  const posted = new Map<number, Entity[]>();
  for (const e of assignedWorkers(world, tower)) {
    const job = world.tryGet(e, Settler)?.jobType;
    if (job === undefined || job === null) continue;
    const men = posted.get(job);
    if (men === undefined) posted.set(job, [e]);
    else men.push(e);
  }
  return posted;
}

function wantsMore(wall: Wall): boolean {
  let held = 0;
  let room = false;
  for (const [job, want] of wall.want) {
    const count = wall.crew.get(job) ?? 0;
    held += count;
    if (count < want) room = true;
  }
  return room && held < wall.total;
}

/** One man of each class a tower holds beyond its `keep`, the highest id, taken off the wall so he joins
 *  the free soldiers again. */
function releaseOrders(walls: readonly Wall[]): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const wall of walls) {
    for (const [job, keep] of wall.keep) {
      const men = wall.posted.get(job) ?? [];
      if (men.length <= keep) continue;
      const leaving = men.reduce((a, b) => (b > a ? b : a));
      commands.push({ kind: 'unassignWorker', entity: leaving });
      wall.crew.set(job, men.length - 1);
    }
  }
  return commands;
}

/**
 * The free archer closest to the `wall`'s door it still wants, or null. The gates mirror `assignWorker`'s
 * own, so a refused command is never issued. `ready` arrives ascending-id, so the strict `<` keeps the
 * lowest id among equal distances.
 */
function nearestFreeArcher(
  world: World,
  terrain: TerrainGraph,
  ready: readonly Entity[],
  claimed: ReadonlySet<Entity>,
  wall: Wall,
): { archer: Entity; jobType: number } | null {
  const reachable = terrain.componentOf(wall.door);
  let best: { archer: Entity; jobType: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of ready) {
    if (claimed.has(e)) continue;
    const settler = world.get(e, Settler);
    const jobType = settler.jobType;
    if (jobType === null) continue;
    const want = wall.want.get(jobType);
    const held = wall.crew.get(jobType) ?? 0;
    if (want === undefined || held >= want) continue;
    if (spokenFor(world, e)) continue;
    const at = entityNode(world, terrain, e);
    if (terrain.componentOf(at) !== reachable) continue;
    if (
      held >= (wall.open.get(jobType) ?? 0) &&
      hexNodeDistance(terrain, at, wall.door) > MAP_AI_DEFENCE_REACH_POINTS
    )
      continue;
    const distance = manhattan(terrain, at, wall.door);
    if (distance >= bestDistance) continue;
    best = { archer: e, jobType };
    bestDistance = distance;
  }
  return best;
}
