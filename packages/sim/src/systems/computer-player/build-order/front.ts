import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { intSqrt } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import {
  forecastAttackOrigin,
  forecastAttackTicks,
  peaceDeadlineTick,
  TOWER_LEAD_TICKS,
} from '../military/deadline.js';
import { nearestEnemyBuilding } from '../sea-route.js';

// The world-metric node pitch of `nav/node-circle.ts`: 34 px E/W, 19 px N/S per half-cell node, so a
// line measured in these px stands straight on screen.
const NODE_STEP_PX = 34;
const HALF_ROW_PX = 19;

/** Covering towers are an id allowlist, not `kind === 'tower'`: `work_pottery_02` shares the kind but
 *  is the defence wall. */
export const TOWER_CONTENT_IDS: readonly string[] = ['tower_00', 'tower_01'];

/** How far ahead of the seat's base its tower line stands toward the attacks, in world-metric nodes
 *  (authored): inside a cramped seat's build reach on every heading (29 rows straight north), with the
 *  base's own workshops behind it. A settlement already reaching past it moves the line out by whole
 *  steps of this depth, so one stray building does not shift every slot. */
export const FRONT_LINE_DEPTH_NODES = 16;

/** How many rows of tower slots a seat whose defence comes first holds on its front, the second half a
 *  spacing behind the first and staggered (owner ruling: the defence rings densely on the attack side). */
export const DEFENCE_FRONT_ROWS = 2;

/** How many rows an even ring puts on its front before it covers the rest of the town (owner ruling:
 *  the facing side first). */
export const EVEN_FRONT_ROWS = 1;

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

/** {@link frontLine} toward where `player`'s forecast attacks come from ({@link forecastAttackOrigin}),
 *  else toward its nearest believed enemy building; null with neither, or without a base. */
export function seatFrontLine(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): FrontLine | null {
  const base = baseNode(world, ctx, player);
  if (base === null) return null;
  const forecast = forecastAttackOrigin(world, ctx, player);
  if (forecast !== null) return frontLine(world, ctx, owned, base, forecast, true);
  const rival = nearestEnemyBuilding(world, ctx, player, base);
  return rival === null ? null : frontLine(world, ctx, owned, base, rival.node, false);
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
  const forecast = base === null ? null : forecastAttackOrigin(world, ctx, player);
  return base === null || forecast === null ? null : frontLine(world, ctx, owned, base, forecast, true);
}

function baseNode(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  return base === null ? null : anchorNodeOf(world, base);
}

/**
 * The line across the heading from `base` to `origin`, {@link FRONT_LINE_DEPTH_NODES} ahead of the base,
 * or as many whole depths further as the farthest of `owned` other than a tower already stands; null when
 * the two coincide.
 * Integer px arithmetic with truncating division, byte-identical across engines.
 */
export function frontLine(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  base: HalfCellNode,
  origin: HalfCellNode,
  scripted: boolean,
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
    farthest = Math.max(farthest, ahead(node.hx, node.hy));
    widest = Math.max(widest, Math.abs(across(node.hx, node.hy)));
  }
  const depthPx = stepPx * Math.max(1, Math.ceil(farthest / stepPx));
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
            hx: base.hx + Math.round((along * hx - lateral * hy) / length / NODE_STEP_PX),
            hy: base.hy + Math.round((along * hy + lateral * hx) / length / HALF_ROW_PX),
          });
        }
      }
      return out;
    },
  };
}
