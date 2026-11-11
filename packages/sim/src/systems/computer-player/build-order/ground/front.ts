import { Building, diplomacyStance, mapBriefOf } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import { intSqrt } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { HALF_ROW_PX, NODE_STEP_PX } from '../../../../nav/node-circle.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import { seatBaseOf } from '../../base.js';
import { minutesToTicks } from '../../game-phase.js';
import {
  forecastAttackOrigin,
  forecastAttackTicks,
  peaceDeadlineTick,
  TOWER_LEAD_TICKS,
} from '../../military/deadline.js';
import { nearestEnemyBuilding } from '../../sea-route.js';

/** Covering towers are an id allowlist, not `kind === 'tower'`: `work_pottery_02` shares the kind but
 *  is the defence wall. */
export const TOWER_CONTENT_IDS: readonly string[] = ['tower_00', 'tower_01'];

/** How far ahead of the seat's base its tower line stands toward the attacks, in world-metric nodes
 *  (owner ruling: the line stands well forward, so the seat claims room toward the rival and its town
 *  grows behind the towers; authored figure: half again the depth that left the town of a specjalna_forteca
 *  or mroczny_las seat cramped behind its towers). Buildings already reaching past it move the line out
 *  by whole steps of this depth, so one stray building does not shift every slot: on a scripted front only
 *  the seat's start buildings, since a building the economy places beyond the line when nothing fits
 *  behind it would otherwise walk the line out step by step (on mroczny_las 75 rows north of the base by
 *  minute 60). */
export const FRONT_LINE_DEPTH_NODES = 24;

/** How far ahead of the seat's farthest building toward its nearest rival that rival's line stands at
 *  least, and the steps it moves out by, in world-metric nodes (authored, owner ruling: the line stands
 *  well forward so the town grows behind it). The farthest building then stands 16 to 23 nodes behind the
 *  line, inside a tower's defence circle (the house bow's 29 map points) across the heading. */
export const RIVAL_LINE_ADVANCE_NODES = 16;
const RIVAL_LINE_STEP_NODES = 8;

/** The farthest share of the way from the base to where the line faces, in percent (owner ruling: towers
 *  stand forward but never in the rival's reach): half, so two rivals' lines never cross, and toward a
 *  rival the way ends at the building the line faces, one the seat knows of, never one hidden in the fog. */
export const LINE_MAX_SHARE_PCT = 50;

/** Towers the seat wants standing, sites included, from {@link TOWER_LEAD_TICKS} before its first
 *  deadline, and how many more from that lead before each later one (owner ruling: the towers finish a
 *  bit before each attack, added wave by wave rather than all at the start). Authored counts: on
 *  mroczny_las a seat wants three towers from minute 5, five from the minute-25 raid and seven from minute
 *  40, ahead of the minute-50 wave. */
const FIRST_DEADLINE_TOWERS = 3;
const LATER_DEADLINE_TOWERS = 2;

/**
 * How many towers `player`'s seat wants by now ({@link FIRST_DEADLINE_TOWERS},
 * {@link LATER_DEADLINE_TOWERS}): its deadlines are the distinct ticks of its forecast scripted attacks
 * and its peace end, each counted from {@link TOWER_LEAD_TICKS} before it, or from the deadline before it
 * when that comes sooner: on mroczny_las towers opened 20 minutes ahead of the minute-50 wave stood only
 * half finished when it came. Null for no cap: a seat with no forecast attack (its ring waits on the
 * deadline lead instead), or once every deadline is counted.
 */
export function scheduledTowers(world: World, ctx: SystemContext, player: number): number | null {
  const attacks = forecastAttackTicks(world, ctx, player);
  if (attacks.length === 0) return null;
  const deadlines = [...new Set([...attacks, peaceDeadlineTick(world, player)])].sort((a, b) => a - b);
  let counted = 0;
  let previous = Number.POSITIVE_INFINITY;
  for (const deadline of deadlines) {
    if (ctx.tick >= Math.min(deadline - TOWER_LEAD_TICKS, previous)) counted++;
    previous = deadline;
  }
  if (counted === deadlines.length) return null;
  return counted === 0 ? 0 : FIRST_DEADLINE_TOWERS + (counted - 1) * LATER_DEADLINE_TOWERS;
}

/** How long before a forecast scripted attack no tower upgrade opens (authored): an upgrading tower
 *  stands as a site and shoots no one, and on mroczny_las a lower tower's upgrade stood 9 to over 12 game
 *  minutes after it opened; upgrades opened from minute 40 left every seat a tower or two short in the
 *  minute-50 wave. */
export const TOWER_UPGRADE_QUIET_TICKS = minutesToTicks(15);

/** Whether `player`'s seat holds its upgrade to the tower tier `target` (content id): a forecast scripted
 *  attack lands within {@link TOWER_UPGRADE_QUIET_TICKS} (owner ruling: towers first, upgraded later). */
export function towerUpgradeWaits(world: World, ctx: SystemContext, player: number, target: string): boolean {
  if (!TOWER_CONTENT_IDS.includes(target)) return false;
  return forecastAttackTicks(world, ctx, player).some(
    (at) => at >= ctx.tick && at - ctx.tick <= TOWER_UPGRADE_QUIET_TICKS,
  );
}

/** A seat's front: the straight line across the heading its attacks come from, a fixed depth ahead of its
 *  base. */
export interface FrontLine {
  /** Whether the heading comes from the map's forecast scripted attacks, not the nearest rival. */
  readonly scripted: boolean;
  /** Whether node `(x, y)` lies beyond the line, toward the attacks. */
  beyond(x: number, y: number): boolean;
  /** The line's tower slots for towers `spacingNodes` world-metric nodes apart across the heading, the
   *  one straight ahead first and then alternately left and right, over `rows` rows each half a spacing
   *  further back and staggered, spanning the settlement's width. */
  slots(spacingNodes: number, rows: number): HalfCellNode[];
}

/** {@link frontLine} toward where `player`'s forecast attacks come from ({@link scriptedFrontLine}),
 *  else toward its nearest believed enemy building; null with neither, while {@link enemiesSurround} the
 *  seat, or without a base. */
export function seatFrontLine(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): FrontLine | null {
  const base = baseNode(world, ctx, player);
  if (base === null) return null;
  const scripted = scriptedLineFrom(world, ctx, player, owned, base);
  if (scripted !== null) return scripted;
  if (enemiesSurround(world, player, base)) return null;
  const rival = nearestEnemyBuilding(world, ctx, player, base);
  return rival === null ? null : frontLine(world, ctx, owned, base, rival.node, false);
}

/** How far apart, as the cosine in percent, the bearings of two enemy groups from a seat's base lie for it
 *  to hold no single front (authored): 71, about 45 degrees. bogata_kotlina's 1v1v1v1 seats see their two
 *  neighbours 59 to 120 degrees apart; magiczny_las's seats see the map's own guardians in the middle at
 *  most 26 degrees off the enemy team's bearing. */
const SPLIT_FRONT_MAX_COSINE_PCT = 71;

/** Fixed-point scale of a unit bearing in {@link enemiesSurround}. */
const BEARING_UNIT = 1024;

/**
 * Whether `player`'s enemies come at its `base` from several sides rather than one (owner ruling: with
 * enemies on every side, a front toward one of them leaves the others' side open). The enemy seat starts
 * of the map brief fall into groups, a seat joining the first group whose first member does not hold it as
 * enemy, so a team marches as one; the seat holds no single front while two groups' summed unit bearings
 * lie more than {@link SPLIT_FRONT_MAX_COSINE_PCT} apart. Integer px arithmetic, byte-identical across
 * engines.
 */
export function enemiesSurround(world: World, player: number, base: HalfCellNode): boolean {
  const groups: { readonly lead: number; x: number; y: number }[] = [];
  for (const seat of mapBriefOf(world)?.seats ?? []) {
    if (seat.player === player || diplomacyStance(world, player, seat.player) !== 'enemy') continue;
    const bearing = unitBearing((seat.hx - base.hx) * NODE_STEP_PX, (seat.hy - base.hy) * HALF_ROW_PX);
    if (bearing === null) continue;
    let group = groups.find((g) => diplomacyStance(world, g.lead, seat.player) !== 'enemy');
    if (group === undefined) {
      group = { lead: seat.player, x: 0, y: 0 };
      groups.push(group);
    }
    group.x += bearing.x;
    group.y += bearing.y;
  }
  const bearings = groups.flatMap((g) => unitBearing(g.x, g.y) ?? []);
  return bearings.some((a, i) =>
    bearings
      .slice(i + 1)
      .some((b) => (a.x * b.x + a.y * b.y) * 100 < SPLIT_FRONT_MAX_COSINE_PCT * BEARING_UNIT * BEARING_UNIT),
  );
}

/** `(x, y)` scaled to {@link BEARING_UNIT} length, truncating; null for the zero vector. */
function unitBearing(x: number, y: number): { x: number; y: number } | null {
  const length = intSqrt(x * x + y * y);
  if (length === 0) return null;
  return { x: Math.trunc((x * BEARING_UNIT) / length), y: Math.trunc((y * BEARING_UNIT) / length) };
}

/** The {@link FrontLine} toward `player`'s forecast attacks only, or null for none: the one the seat's
 *  economy keeps behind. */
export function scriptedFrontLine(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): FrontLine | null {
  const base = baseNode(world, ctx, player);
  return base === null ? null : scriptedLineFrom(world, ctx, player, owned, base);
}

/** The line toward `player`'s {@link forecastAttackOrigin}, or null when none is forecast or it lies
 *  within {@link FRONT_LINE_DEPTH_NODES} of `base`: a line ahead of the base would then stand beyond the
 *  attacks it faces (krwawa_rzeka's forecast attacks all aim at the seat's own base). */
function scriptedLineFrom(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  base: HalfCellNode,
): FrontLine | null {
  const forecast = forecastAttackOrigin(world, ctx, player);
  if (forecast === null) return null;
  const dx = (forecast.hx - base.hx) * NODE_STEP_PX;
  const dy = (forecast.hy - base.hy) * HALF_ROW_PX;
  const depthPx = FRONT_LINE_DEPTH_NODES * NODE_STEP_PX;
  if (dx * dx + dy * dy <= depthPx * depthPx) return null;
  return frontLine(world, ctx, owned, base, forecast, true, startBuildingNodes(world, ctx, player));
}

/** The anchor nodes of `player`'s start buildings other than towers, from the map brief. */
function startBuildingNodes(world: World, ctx: SystemContext, player: number): HalfCellNode[] {
  const index = contentIndex(ctx.content);
  const start = mapBriefOf(world)?.seats.find((seat) => seat.player === player);
  const nodes: HalfCellNode[] = [];
  for (const b of start?.buildings ?? []) {
    const type = index.buildings.get(b.buildingType);
    if (type !== undefined && !TOWER_CONTENT_IDS.includes(type.id)) nodes.push({ hx: b.hx, hy: b.hy });
  }
  return nodes;
}

function baseNode(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  return base === null ? null : anchorNodeOf(world, base);
}

/**
 * The line across the heading from `base` to `origin`, {@link FRONT_LINE_DEPTH_NODES} ahead of the base,
 * or as many whole depths further as the farthest of `depthFrom` stands; null when the two coincide.
 * Without `depthFrom`, toward a rival, it stands {@link RIVAL_LINE_ADVANCE_NODES} past the farthest of
 * `owned` other than its towers, rounded out to whole steps. Either way it stands no farther than
 * {@link LINE_MAX_SHARE_PCT} of the way to `origin`. The slots span the width of `owned`.
 * Integer px arithmetic, byte-identical across engines: divisions truncate, and a slot rounds half up to
 * its node.
 */
export function frontLine(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  base: HalfCellNode,
  origin: HalfCellNode,
  scripted: boolean,
  depthFrom?: readonly HalfCellNode[],
): FrontLine | null {
  const hx = (origin.hx - base.hx) * NODE_STEP_PX;
  const hy = (origin.hy - base.hy) * HALF_ROW_PX;
  const length = intSqrt(hx * hx + hy * hy);
  if (length === 0) return null;
  const ahead = (x: number, y: number): number =>
    Math.trunc(((x - base.hx) * NODE_STEP_PX * hx + (y - base.hy) * HALF_ROW_PX * hy) / length);
  const across = (x: number, y: number): number =>
    Math.trunc(((y - base.hy) * HALF_ROW_PX * hx - (x - base.hx) * NODE_STEP_PX * hy) / length);
  const stepPx = FRONT_LINE_DEPTH_NODES * NODE_STEP_PX;
  const index = contentIndex(ctx.content);
  let farthest = 0;
  let widest = 0;
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type !== undefined && TOWER_CONTENT_IDS.includes(type.id)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    if (depthFrom === undefined) farthest = Math.max(farthest, ahead(node.hx, node.hy));
    widest = Math.max(widest, Math.abs(across(node.hx, node.hy)));
  }
  for (const node of depthFrom ?? []) farthest = Math.max(farthest, ahead(node.hx, node.hy));
  const rivalStepPx = RIVAL_LINE_STEP_NODES * NODE_STEP_PX;
  const wantedPx =
    depthFrom === undefined
      ? Math.max(
          stepPx,
          rivalStepPx * Math.ceil((farthest + RIVAL_LINE_ADVANCE_NODES * NODE_STEP_PX) / rivalStepPx),
        )
      : stepPx * Math.max(1, Math.ceil(farthest / stepPx));
  const depthPx = Math.min(wantedPx, Math.trunc((length * LINE_MAX_SHARE_PCT) / 100));
  return {
    scripted,
    beyond: (x, y) => ahead(x, y) > depthPx,
    slots(spacingNodes, rows) {
      const spacingPx = spacingNodes * NODE_STEP_PX;
      if (spacingPx <= 0) return [];
      const reach = Math.max(1, Math.ceil(widest / spacingPx));
      const out: HalfCellNode[] = [];
      for (let row = 0; row < rows; row++) {
        const along = depthPx - Math.trunc((row * spacingPx) / 2);
        const stagger = row % 2 === 0 ? 0 : Math.trunc(spacingPx / 2);
        for (let k = 0; k <= 2 * reach; k++) {
          // 0, -1, 1, -2, 2, ...: straight ahead first.
          const side = k % 2 === 0 ? k / 2 : -(k + 1) / 2;
          const lateral = side * spacingPx + stagger;
          out.push({
            hx: base.hx + nearestQuotient(along * hx - lateral * hy, length * NODE_STEP_PX),
            hy: base.hy + nearestQuotient(along * hy + lateral * hx, length * HALF_ROW_PX),
          });
        }
      }
      return out;
    },
  };
}

/** `a / b` rounded half up for integers and `b > 0`, exact where a float quotient could land beside a
 *  half. */
function nearestQuotient(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}
