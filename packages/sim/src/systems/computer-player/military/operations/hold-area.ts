import {
  computerControllerRuns,
  diplomacyStance,
  MAX_PLAYERS,
  mapBriefOf,
} from '../../../../components/index.js';
import type { World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance, hexDistanceBetween } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../../nav/terrain/index.js';
import { TOWER_POST_STRENGTH } from '../../../ai-shared/military/census.js';
import { ownedSettlers } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { playerSeesNode } from '../../../vision/gates.js';
import { type IntentArea, seatMapIntentOf } from '../../knowledge/map-intent/index.js';
import { believedDefendingPoints } from '../enemy-strength.js';
import { nodeOfEntity, visibleFighters } from './raid-target.js';

// What a hold reads about its area: which area the map rewards the seat for holding, the reachable spot in
// it, and the strength the seat believes holds it, from its own sight and memory only.

/** How far past an area's range a seat's start may lie and still count as the area's guardian, whose
 *  whole believed army defends it (authored): diamentowa_dolina's centre seat stands its market 7 map
 *  points from the centre and its towers up to 20, against a range of 13. */
export const HOLD_GUARD_MARGIN_POINTS = 10;
/** How far past an area's range an enemy fighter the seat sees counts as contesting it (authored: about a
 *  soldier's sight, so a band inside notices an army walking in). */
export const HOLD_WATCH_MARGIN_POINTS = 12;

/** The area `seat` wins by holding: its first win objective, in mission order, that asks its own men to
 *  stand in an area; null on a map that asks none. A computer seat knows the whole script (owner ruling). */
export function holdAreaOf(ctx: SystemContext, seat: number): IntentArea | null {
  for (const entry of seatMapIntentOf(ctx, seat, null).objectives) {
    const objective = entry.objective;
    if (entry.verdict === 'win' && objective.kind === 'holdArea' && objective.player === seat)
      return objective.area;
  }
  return null;
}

/** The node within `area` on `land` nearest its centre, ties to the lower row then column; null when no
 *  node of the area lies on that land. Scans the area's square once. */
export function postOf(terrain: TerrainGraph, area: IntentArea, land: number): HalfCellNode | null {
  if (land === NO_COMPONENT) return null;
  const { hx, hy } = area.point;
  let best: HalfCellNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, hy - area.range); y <= Math.min(terrain.height - 1, hy + area.range); y++) {
    for (let x = Math.max(0, hx - area.range); x <= Math.min(terrain.width - 1, hx + area.range); x++) {
      const distance = hexDistanceBetween(hx, hy, x, y);
      if (distance > area.range || distance >= bestDistance) continue;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || terrain.componentOf(node) !== land) continue;
      best = { hx: x, hy: y };
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether `at` lies within `area`, by the script's own measure. */
export function insideArea(area: IntentArea, at: HalfCellNode): boolean {
  return hexDistance(at, area.point) <= area.range;
}

/**
 * The enemy points `seat` believes hold `area`: every enemy it sees within {@link HOLD_WATCH_MARGIN_POINTS}
 * of the area, and for an enemy whose start lies in the area ({@link HOLD_GUARD_MARGIN_POINTS}) his whole
 * army as the seat believes it, his tower posts weighed as strongly as the wave launch weighs them.
 * Approximation: a guardian's men away from the area still count. An enemy the seat knows nothing of adds
 * nothing, so a seat that has never looked sends a band that turns back on sight. Costs the enemies'
 * fighters.
 */
export function believedAreaDefence(
  world: World,
  ctx: SystemContext,
  seat: number,
  area: IntentArea,
): number {
  const guardians = areaGuardians(world, area);
  let points = 0;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat || diplomacyStance(world, seat, other) !== 'enemy') continue;
    if (guardians.has(other)) {
      points += believedDefendingPoints(world, ctx, seat, other, 0, TOWER_POST_STRENGTH);
      continue;
    }
    for (const f of visibleFighters(world, ctx, seat, other)) {
      if (hexDistance(f.at, area.point) <= area.range + HOLD_WATCH_MARGIN_POINTS) points += f.points;
    }
  }
  return points;
}

/** The seats whose start, by the map brief, lies within {@link HOLD_GUARD_MARGIN_POINTS} of `area`. */
function areaGuardians(world: World, area: IntentArea): Set<number> {
  const guardians = new Set<number>();
  const reach = area.range + HOLD_GUARD_MARGIN_POINTS;
  for (const start of mapBriefOf(world)?.seats ?? []) {
    const near = (at: HalfCellNode) => hexDistance(at, area.point) <= reach;
    if (near(start) || start.buildings.some(near)) guardians.add(start.player);
  }
  return guardians;
}

/**
 * The guardians of the area `seat` wins by holding that never leave it: no computer player runs them and
 * their map program names no attack. Such a seat threatens a band in the area, never the seat's home.
 */
export function stayingGuardians(world: World, ctx: SystemContext, seat: number): ReadonlySet<number> {
  const area = holdAreaOf(ctx, seat);
  if (area === null) return NO_SEATS;
  const staying = new Set<number>();
  for (const guardian of areaGuardians(world, area)) {
    if (computerControllerRuns(world, guardian)) continue;
    const program = ctx.mapAiScript?.find((s) => s.player === guardian);
    if (program?.tasks.some((task) => task.kind === 'attack')) continue;
    staying.add(guardian);
  }
  return staying;
}

const NO_SEATS: ReadonlySet<number> = new Set();

/** Whether a friend of `seat` holds `area` as far as the seat sees: one of his people inside it and no
 *  enemy fighter. Relations are read live. Costs the friends' people and the enemies' fighters. */
export function friendHoldsArea(world: World, ctx: SystemContext, seat: number, area: IntentArea): boolean {
  let friendInside = false;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === seat) continue;
    const stance = diplomacyStance(world, seat, other);
    if (stance === 'enemy') {
      if (visibleFighters(world, ctx, seat, other).some((f) => insideArea(area, f.at))) return false;
    } else if (stance === 'friend' && !friendInside) {
      friendInside = ownedSettlers(world, other).some((e) => {
        const at = nodeOfEntity(world, e);
        return at !== null && insideArea(area, at) && playerSeesNode(ctx.fog, seat, at.hx, at.hy);
      });
    }
  }
  return friendInside;
}
