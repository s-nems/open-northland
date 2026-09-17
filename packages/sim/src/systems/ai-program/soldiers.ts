import type { MapAiTask } from '@open-northland/data';
import {
  type AiAttackGroupRecord,
  type AiDefaultPosition,
  type AiSoldierRecord,
  Armor,
  AttackOrder,
  Building,
  diplomacyStance,
  Engagement,
  hasMissionBehaviour,
  JobAssignment,
  MISSION_BEHAVIOUR,
  Owner,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { ownedSettlers } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { isTravelling } from '../movement/nav-state.js';
import { isFighterJob, isHeroJob, isMilitaryMode, MILITARY_MODE } from '../readviews/index.js';
import type { TaskGroup } from './tasks.js';

// The soldiers of one seat's program: the readings of the the original's
// `an original routine`, `an original routine`,
// `an original routine`, `an original routine` and
// `an original routine` (`docs/formats/MISSIONS.md`, AI data).

/** How many soldiers one handler lists. */
const SOLDIER_LIST_LIMIT = 200;
/** A man ranks this much farther from a task he is not already on, and again for each of a bare weapon
 *  slot and a bare armor slot, so the armed and the already posted go first. */
const RANK_PENALTY = 10000;
/** A Defend post's man walks back when farther than this from the post, whatever its range. */
const DEFEND_SLACK = 10;
/** The stance a Defend post's man holds; an Attack task names its own. */
const DEFEND_STANCE = MILITARY_MODE.DEFEND;

/**
 * Keep the list to the seat's fighters and heroes that man no workhouse and stand within the
 * player's control (`MISSIONS.md`, behaviour bit 5), dropping the men who left and listing the new
 * ones, ascending by entity id, up to the list's size. A listed man's task and default-position
 * marks survive the walk. `wanted` are the men the seat's towers are about to post, left out so the
 * program's first walk cannot carry them past the wall (the original attaches the towers before it
 * lists, on every turn).
 */
export function updateSoldierList(
  world: World,
  ctx: SystemContext,
  seat: number,
  records: AiSoldierRecord[],
  wanted: ReadonlySet<Entity>,
): void {
  const listed = new Map<Entity, AiSoldierRecord>();
  for (const record of records) {
    if (qualifies(world, ctx, seat, record.entity)) listed.set(record.entity, record);
  }
  records.length = 0;
  for (const e of ownedSettlers(world, seat)) {
    if (records.length >= SOLDIER_LIST_LIMIT) break;
    if (wanted.has(e) || !qualifies(world, ctx, seat, e)) continue;
    records.push(listed.get(e) ?? { entity: e, task: null, onDefault: false });
  }
}

function qualifies(world: World, ctx: SystemContext, seat: number, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || settler.jobType === null || world.tryGet(e, Owner)?.player !== seat)
    return false;
  if (!isFighterJob(ctx.content, settler.jobType) && !isHeroJob(ctx.content, settler.jobType)) return false;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) return false;
  return !world.has(e, JobAssignment) && world.has(e, Position);
}

/** Drop the task of every man whose task is no longer among the active groups. */
export function clearInvalidTasks(
  defs: readonly MapAiTask[],
  groups: readonly TaskGroup[],
  records: AiSoldierRecord[],
): void {
  for (const record of records) {
    if (record.task === null || record.onDefault) continue;
    if (groupOf(defs, groups, record) === null) record.task = null;
  }
}

/** The active group a listed man's task belongs to, matched by the task's description as the
 *  original compares it, or null. */
export function groupOf(
  defs: readonly MapAiTask[],
  groups: readonly TaskGroup[],
  record: AiSoldierRecord,
): TaskGroup | null {
  if (record.task === null) return null;
  const own = defs[record.task];
  if (own === undefined || (own.kind !== 'defend' && own.kind !== 'attack')) return null;
  for (const group of groups) {
    const lead = defs[group.tasks[0] ?? -1];
    if (lead !== undefined && sameTask(own, lead)) return group;
  }
  return null;
}

function sameTask(a: MapAiTask, b: MapAiTask): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'defend' && b.kind === 'defend') {
    return a.x === b.x && a.y === b.y && a.range === b.range && a.min === b.min && a.max === b.max;
  }
  if (a.kind === 'attack' && b.kind === 'attack') {
    return (
      a.x === b.x &&
      a.y === b.y &&
      a.range === b.range &&
      a.min === b.min &&
      a.max === b.max &&
      a.rallyX === b.rallyX &&
      a.rallyY === b.rallyY &&
      a.stance === b.stance
    );
  }
  return false;
}

/** The assignment's view of one group: how many men it wants this pass and whether it was served. */
interface GroupShare {
  readonly group: TaskGroup;
  want: number;
  served: boolean;
}

/**
 * Hand the seat's listed men to the active groups by pooled priority, the nearest men first, then send
 * whoever is left to the default position. Every group gets the share of the free men its priority
 * earns, held between its min (or it gets none this pass) and its max; a Defend group that caps
 * neither side waits for the second pass, which fills it from what the first left. A man already on
 * a group's task keeps it and gets no new order; a man switched onto a task gets its stance.
 */
export function assignSoldiers(
  world: World,
  ctx: SystemContext,
  defs: readonly MapAiTask[],
  groups: readonly TaskGroup[],
  records: AiSoldierRecord[],
  attackGroups: AiAttackGroupRecord[],
  defaultPosition: AiDefaultPosition | null,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const claimed = new Set<Entity>();
  const shares: GroupShare[] = groups.map((group) => ({ group, want: 0, served: false }));
  let left = records.length;

  // Pass one: the groups that bound their band, by priority share of the men still free.
  for (;;) {
    const candidates = shares.filter(
      (s) => !s.served && (s.group.kind === 'attack' || (s.group.min !== 0 && s.group.max !== 0)),
    );
    const total = candidates.reduce((sum, s) => sum + s.group.priority, 0);
    if (total === 0) break;
    const filled: GroupShare[] = [];
    // Every candidate of one round is sized off the same pool; the round's takings come off after.
    const pool = left;
    for (const share of candidates) {
      let want = roundedShare(share.group.priority, pool, total);
      if (share.group.max !== 0) want = Math.min(want, share.group.max);
      if (want < share.group.min) continue;
      share.want = want;
      left -= want;
      filled.push(share);
    }
    if (filled.length === 0) break;
    for (const share of filled) {
      share.served = true;
      const taken = takeSoldiers(world, ctx, defs, share, records, claimed);
      commands.push(...taken.commands);
      formOrAttack(world, share.group, taken.band, attackGroups);
    }
  }

  // Pass two: the rest, when their share of the whole priority pool fills their cap to at least their
  // min (an uncapped group only with no min), sized off their share among themselves of the men the
  // first pass left, and never more than the group may still take.
  const pooled = shares.reduce((sum, s) => sum + s.group.priority, 0);
  const rest = shares.filter((s) => {
    if (s.served) return false;
    const { min, max, priority } = s.group;
    const fill = max === 0 || pooled === 0 ? 0 : roundedShare(priority * max, 1, pooled);
    return min <= fill;
  });
  const total = rest.reduce((sum, s) => sum + s.group.priority, 0);
  for (const share of rest) {
    let want = roundedShare(share.group.priority, left, total);
    if (share.group.max !== 0) want = Math.min(want, share.group.max);
    if (want < share.group.min) continue;
    share.want = Math.min(want, eligible(world, ctx, share.group, records, claimed).length);
    if (share.want < share.group.min) continue;
    share.served = true;
    const taken = takeSoldiers(world, ctx, defs, share, records, claimed);
    commands.push(...taken.commands);
    formOrAttack(world, share.group, taken.band, attackGroups);
  }

  // The men no task took hold the default position, unless already fighting; the guard stance is
  // set where each arrives.
  if (defaultPosition !== null) {
    for (const record of records) {
      if (record.task !== null || record.onDefault || fighting(world, record.entity)) continue;
      record.onDefault = true;
    }
  }
  return commands;
}

/** `priority / total` of `left`, rounded half up in integers. */
function roundedShare(priority: number, left: number, total: number): number {
  return Math.floor((2 * priority * left + total) / (2 * total));
}

/** The listed men a group may still take: the unclaimed, and for an Attack group no hero. */
function eligible(
  world: World,
  ctx: SystemContext,
  group: TaskGroup,
  records: readonly AiSoldierRecord[],
  claimed: ReadonlySet<Entity>,
): AiSoldierRecord[] {
  return records.filter(
    (r) =>
      !claimed.has(r.entity) &&
      !(group.kind === 'attack' && isHeroJob(ctx.content, world.get(r.entity, Settler).jobType)),
  );
}

/** The `want` eligible men nearest the group's point join it, and come back as the band it took this
 *  pass: a man already on the task is preferred by the rank penalty, and only a man switched onto the
 *  task gets a fresh stance order. */
function takeSoldiers(
  world: World,
  ctx: SystemContext,
  defs: readonly MapAiTask[],
  share: GroupShare,
  records: AiSoldierRecord[],
  claimed: Set<Entity>,
): { commands: PlayerCommand[]; band: AiSoldierRecord[] } {
  const { group } = share;
  const lead = group.tasks[0];
  const leadDef = lead === undefined ? undefined : defs[lead];
  if (lead === undefined || leadDef === undefined || (leadDef.kind !== 'defend' && leadDef.kind !== 'attack'))
    return { commands: [], band: [] };
  const ranked: Array<{ record: AiSoldierRecord; rank: number }> = [];
  for (const record of eligible(world, ctx, group, records, claimed)) {
    const at = pointOf(world, record.entity);
    let rank = hexDistanceBetween(at.hx, at.hy, group.hx, group.hy);
    if (groupOf(defs, [group], record) === null) rank += RANK_PENALTY;
    if (!world.has(record.entity, Weapon)) rank += RANK_PENALTY;
    if (!world.has(record.entity, Armor)) rank += RANK_PENALTY;
    ranked.push({ record, rank });
  }
  // Ascending rank; the list is ascending by entity id already, and the sort is stable.
  ranked.sort((a, b) => a.rank - b.rank);
  const commands: PlayerCommand[] = [];
  const band: AiSoldierRecord[] = [];
  for (const { record } of ranked.slice(0, share.want)) {
    claimed.add(record.entity);
    band.push(record);
    if (groupOf(defs, [group], record) === null) {
      record.task = lead;
      const stance = leadDef.kind === 'attack' ? leadDef.stance : DEFEND_STANCE;
      commands.push(...stanceOrder(world, record.entity, stance));
    }
    record.onDefault = false;
  }
  return { commands, band };
}

/** A stance order, unless the man already holds that stance or the script named no real one. The
 *  guard stance is issued on arrival instead, since this build anchors it where the man stands. */
function stanceOrder(world: World, e: Entity, mode: number): PlayerCommand[] {
  if (!isMilitaryMode(mode) || mode === DEFEND_STANCE) return [];
  if (world.tryGet(e, Stance)?.mode === mode) return [];
  return [{ kind: 'setStance', entity: e, mode }];
}

/**
 * Judge the band an Attack group took this pass: enough of it at the target keeps the attack on; a
 * band too scattered around its foremost man falls back to regroup at the rally point, tightly,
 * before it goes in again. The thresholds are stricter while regrouping.
 */
function formOrAttack(
  world: World,
  group: TaskGroup,
  band: readonly AiSoldierRecord[],
  attackGroups: AiAttackGroupRecord[],
): void {
  if (group.kind !== 'attack' || group.rally === null) return;
  const lead = group.tasks[0];
  if (lead === undefined) return;
  let state = attackGroups.find((g) => g.task === lead);
  if (state === undefined) {
    state = { task: lead, regrouping: false, range: 0 };
    attackGroups.push(state);
    attackGroups.sort((a, b) => a.task - b.task);
  }
  const n = band.length;
  const near = state.regrouping ? Math.floor(n / 2) : Math.floor(n / 3);
  const spread = state.regrouping ? 2 * n : 3 * n;
  state.regrouping = false;
  if (n < 2) return;
  let atTarget = 0;
  for (const r of band) {
    const at = pointOf(world, r.entity);
    if (hexDistanceBetween(at.hx, at.hy, group.hx, group.hy) <= group.range) atTarget++;
  }
  if (atTarget >= near) return;
  let foremost: HalfCellNode | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (const r of band) {
    const at = pointOf(world, r.entity);
    const d = hexDistanceBetween(group.hx, group.hy, at.hx, at.hy);
    if (d < closest) {
      closest = d;
      foremost = at;
    }
  }
  if (foremost === null) return;
  let together = 0;
  for (const r of band) {
    const at = pointOf(world, r.entity);
    if (hexDistanceBetween(at.hx, at.hy, foremost.hx, foremost.hy) <= spread) together++;
  }
  if (together < near) {
    state.regrouping = true;
    state.range = Math.floor(n / 3);
  }
}

/**
 * One turn of orders for the listed men: a Defend post's man walks back to within half the range of
 * his post and guards there; an Attack band's man goes for the enemy house on the target, else within
 * half the range of the target, or gathers at the rally point while the band regroups. A man
 * fighting or still walking an order out is left to it.
 */
export function workOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  defs: readonly MapAiTask[],
  groups: readonly TaskGroup[],
  records: readonly AiSoldierRecord[],
  attackGroups: readonly AiAttackGroupRecord[],
  defaultPosition: AiDefaultPosition | null,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  // The house on each Attack target, resolved once per turn rather than once per man.
  const houses = new Map<TaskGroup, Entity | null>();
  for (const record of records) {
    const e = record.entity;
    if (fighting(world, e) || isTravelling(world, e)) continue;
    if (record.onDefault) {
      if (defaultPosition !== null) commands.push(...holdPost(world, terrain, e, defaultPosition));
      continue;
    }
    const group = groupOf(defs, groups, record);
    if (group === null) continue;
    if (group.kind === 'defend') {
      commands.push(...holdPost(world, terrain, e, { hx: group.hx, hy: group.hy, range: group.range }));
      continue;
    }
    const state = attackGroups.find((g) => g.task === group.tasks[0]);
    const at = pointOf(world, e);
    if (state?.regrouping && group.rally !== null) {
      if (hexDistanceBetween(at.hx, at.hy, group.rally.hx, group.rally.hy) > state.range) {
        commands.push(...attackMove(terrain, e, group.rally));
      }
      continue;
    }
    let house = houses.get(group);
    if (house === undefined) {
      house = enemyHouseAt(world, ctx, terrain, seat, group);
      houses.set(group, house);
    }
    if (house !== null) {
      if (world.tryGet(e, AttackOrder)?.target !== house)
        commands.push({ kind: 'attackUnit', entity: e, target: house });
      continue;
    }
    if (hexDistanceBetween(at.hx, at.hy, group.hx, group.hy) > Math.floor(group.range / 2)) {
      commands.push(...attackMove(terrain, e, group));
    }
  }
  return commands;
}

/** Walk back to the post when past the slack and past half its range, else guard where he stands. */
function holdPost(world: World, terrain: TerrainGraph, e: Entity, post: AiDefaultPosition): PlayerCommand[] {
  const at = pointOf(world, e);
  const d = hexDistanceBetween(at.hx, at.hy, post.hx, post.hy);
  if (d > DEFEND_SLACK && d >= Math.floor(post.range / 2)) return attackMove(terrain, e, post);
  const stance = world.tryGet(e, Stance);
  if (stance?.mode === DEFEND_STANCE) return [];
  return [{ kind: 'setStance', entity: e, mode: DEFEND_STANCE }];
}

/** An attack-move onto the point, clamped to the map, so the man fights what he meets on the way. */
function attackMove(terrain: TerrainGraph, e: Entity, to: { hx: number; hy: number }): PlayerCommand[] {
  const { x, y } = terrain.coordsOf(terrain.nodeAtClamped(to.hx, to.hy));
  return [{ kind: 'attackMoveUnit', entity: e, x, y }];
}

/** The enemy building standing on the group's target point, or null. */
function enemyHouseAt(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  group: TaskGroup,
): Entity | null {
  if (!terrain.inBounds(group.hx, group.hy)) return null;
  const target = terrain.nodeAt(group.hx, group.hy);
  let best: Entity | null = null;
  for (const e of world.query(Building, Owner, Position)) {
    if (diplomacyStance(world, seat, world.get(e, Owner).player) !== 'enemy') continue;
    const at = pointOf(world, e);
    const cells = buildingFootprintOf(ctx.content, world.get(e, Building).buildingType)?.blocked ?? [];
    const body = translatedCells(terrain, cells, at.hx, at.hy);
    if (body.includes(target) || (at.hx === group.hx && at.hy === group.hy)) {
      if (best === null || e < best) best = e;
    }
  }
  return best;
}

function fighting(world: World, e: Entity): boolean {
  return world.has(e, Engagement) || world.has(e, AttackOrder);
}

function pointOf(world: World, e: Entity): HalfCellNode {
  const at = world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}
