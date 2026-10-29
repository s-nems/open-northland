import { diplomacyStance, type MapBriefView, mapBriefOf, zoneOfNode } from '../../../components/index.js';
import { isPlayerDead } from '../../../components/match.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import { anchorNodeOf, firstRingNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { fogHides, playerSeesNode } from '../../vision/gates.js';
import { seatBaseOf } from '../base.js';
import type { BuildOrder } from '../build-order/entries.js';
import { believedTowerPosts, zoneStaleness } from '../knowledge/intel/index.js';
import { gatheredGoodIds } from './signpost-coverage.js';

const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;

/** How long after the seat last saw into a zone the scout may visit it again (authored, untuned): three
 *  game minutes, so a start is looked at again about as often as a wave can form. */
export const SCOUT_REVISIT_TICKS = 3 * TICKS_PER_MINUTE;

/** The staleness a zone stops gaining at, and what a zone never seen counts (authored): ten game minutes,
 *  so a start seen long ago and one never seen weigh alike. */
export const SCOUT_STALENESS_CAP_TICKS = 10 * TICKS_PER_MINUTE;

/** Why a zone is worth a look, with its weight (authored): an enemy start due again (8 x 3 minutes)
 *  outranks a deposit zone never seen (1 x 10 minutes), a walk zone due again (2 x 3 minutes) does not. */
export const SCOUT_IMPORTANCE = {
  enemyStart: 8,
  neutralStart: 4,
  walk: 2,
  deposit: 1,
} as const;

/** How far from a manned enemy tower the scout's goal must stay, in Manhattan half-cell nodes (authored):
 *  the house bow's extracted 29-node `maximumrange` and one node more. Approximation: a post's boosted
 *  reach is not read, and the walk there is the pathfinder's, which may still cross a reach. */
export const SCOUT_TOWER_CLEARANCE_NODES = 30;

interface StaleZone {
  readonly zone: number;
  readonly score: number;
}

/**
 * Where the seat's scout should walk to look at the most valuable stale zone, or null when none is due.
 * Candidates on the seat's own static land component: the other seats' start zones (enemies, then
 * neutrals, relations read live, friends left out), the zones the straight walk to them crosses, and
 * zones never seen that hold a deposit the seat gathers. Score = importance x staleness (capped; a zone
 * never seen counts the cap), best first, ties to the lower zone index; a zone seen within
 * {@link SCOUT_REVISIT_TICKS} is not due. The goal is the node nearest the zone's centre on that land and
 * clear of every remembered manned enemy tower. With nothing hidden by the fog nothing is stale: null.
 */
export function nextStaleZoneTarget(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
): HalfCellNode | null {
  const fog = ctx.fog;
  const terrain = ctx.terrain;
  const brief = mapBriefOf(world);
  if (!fogHides(fog) || terrain === undefined || brief === null) return null;
  const base = seatBaseOf(world, ctx, player);
  const anchor = base === null ? null : anchorNodeOf(world, base);
  if (anchor === null) return null;
  const component = terrain.componentOf(terrain.nodeAtClamped(anchor.hx, anchor.hy));
  if (component === NO_COMPONENT) return null;

  const importance = candidateZones(world, brief, player, anchor, order, ctx.tick);
  const due: StaleZone[] = [];
  for (const [zone, weight] of importance) {
    if (brief.dominantLand[zone] !== component) continue;
    const staleness = zoneStaleness(world, player, zone, ctx.tick);
    if (staleness !== null && staleness < SCOUT_REVISIT_TICKS) continue;
    due.push({
      zone,
      score: weight * Math.min(staleness ?? SCOUT_STALENESS_CAP_TICKS, SCOUT_STALENESS_CAP_TICKS),
    });
  }
  due.sort((a, b) => b.score - a.score || a.zone - b.zone);

  const towers = believedTowerPosts(world, player);
  const clear = (x: number, y: number): boolean =>
    terrain.inBounds(x, y) &&
    terrain.componentOf(terrain.nodeAt(x, y)) === component &&
    towers.every((t) => Math.abs(t.hx - x) + Math.abs(t.hy - y) > SCOUT_TOWER_CLEARANCE_NODES);
  for (const { zone } of due) {
    const goal = zoneGoal(brief, terrain, zone, clear);
    // The intel samples zones on its own beat: a goal in sight now is already being looked at.
    if (goal !== null && !playerSeesNode(fog, player, goal.hx, goal.hy)) return goal;
  }
  return null;
}

/** Each candidate zone's importance, the highest of the reasons it holds. */
function candidateZones(
  world: World,
  brief: MapBriefView,
  player: number,
  anchor: HalfCellNode,
  order: BuildOrder,
  tick: number,
): Map<number, number> {
  const importance = new Map<number, number>();
  const raise = (zone: number, weight: number): void => {
    if (weight > (importance.get(zone) ?? 0)) importance.set(zone, weight);
  };
  const home = zoneOfNode(brief, anchor.hx, anchor.hy);
  for (const start of brief.seats) {
    if (start.player === player || isPlayerDead(world, start.player)) continue;
    const stance = diplomacyStance(world, player, start.player);
    if (stance === 'friend') continue;
    const target = zoneOfNode(brief, start.hx, start.hy);
    raise(target, stance === 'enemy' ? SCOUT_IMPORTANCE.enemyStart : SCOUT_IMPORTANCE.neutralStart);
    for (const zone of zonesOnLine(brief, anchor, start)) {
      if (zone !== home && zone !== target) raise(zone, SCOUT_IMPORTANCE.walk);
    }
  }
  const columns: number[] = [];
  for (const goodId of gatheredGoodIds(order)) {
    const column = brief.goods.indexOf(goodId);
    if (column >= 0) columns.push(column);
  }
  const zones = brief.zonesWide * brief.zonesHigh;
  for (let zone = 0; zone < zones; zone++) {
    if (zoneStaleness(world, player, zone, tick) !== null) continue; // seen: its deposits are known
    if (columns.some((c) => (brief.deposits[zone * brief.goods.length + c] ?? 0) > 0)) {
      raise(zone, SCOUT_IMPORTANCE.deposit);
    }
  }
  return importance;
}

/** The zones the straight line from `from` to `to` crosses, sampled at half a zone's edge. */
function zonesOnLine(brief: MapBriefView, from: HalfCellNode, to: HalfCellNode): Set<number> {
  const dx = to.hx - from.hx;
  const dy = to.hy - from.hy;
  const step = brief.zoneNodes / 2;
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / step));
  const zones = new Set<number>();
  for (let k = 0; k <= count; k++) {
    zones.add(
      zoneOfNode(brief, from.hx + Math.trunc((dx * k) / count), from.hy + Math.trunc((dy * k) / count)),
    );
  }
  return zones;
}

/** The node nearest `zone`'s centre, within half its edge, that `clear` accepts. */
function zoneGoal(
  brief: MapBriefView,
  terrain: TerrainGraph,
  zone: number,
  clear: (x: number, y: number) => boolean,
): HalfCellNode | null {
  const half = brief.zoneNodes / 2;
  const cx = (zone % brief.zonesWide) * brief.zoneNodes + half;
  const cy = Math.floor(zone / brief.zonesWide) * brief.zoneNodes + half;
  const x = Math.min(cx, terrain.width - 1);
  const y = Math.min(cy, terrain.height - 1);
  return firstRingNode(x, y, half, clear);
}
