import {
  CurrentAtomic,
  EXPLORE_RADIUS_NODES,
  ExploreOrder,
  FOG_MODE,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { isScoutJob } from '../readviews/index.js';
import { canonicalById } from '../spatial/nodes.js';
import { cellOfNode, FOG_STATE, type FogState } from '../vision/index.js';
import { isOrderableSettler } from './guards.js';
import { moveUnit } from './movement.js';

/**
 * Send one owned scout to explore around (x,y) - see the command doc. The stamp is all the order does;
 * {@link exploreOrderSystem} walks the sweep out one leg at a time.
 */
export function exploreArea(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'exploreArea' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to reveal
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (!isScoutJob(ctx.content, world.get(e, Settler).jobType)) return; // only scouts explore
  // The walk it was on is superseded, so the first leg goes out this tick; a clip in flight plays to its
  // end, since the sweep below waits for the scout to be free anyway.
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
  world.add(e, ExploreOrder, { centre: terrain.nodeAtClamped(command.x, command.y), leg: null });
}

/**
 * Walk a standing {@link ExploreOrder} out: an idle scout is sent to the nearest cell around its explore
 * centre that its player has never seen, and the order ends once every cell in the circle is explored or
 * none of them can be walked to.
 *
 * Runs after the player-order system retires the arrived walk and before the planner could re-task the
 * scout, so one leg ends and the next starts on the same tick.
 *
 * Approximation: the original picks one of a handful of unexplored points at random; the nearest one is
 * the deterministic reading of the same sweep, and it walks the frontier outward the same way.
 */
export const exploreOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  const fog = ctx.fog;
  if (terrain === undefined) return; // mapless: no orders were issuable
  for (const e of canonicalById(world.query(Settler, ExploreOrder))) {
    const owner = world.tryGet(e, Owner);
    if (owner === undefined || !isScoutJob(ctx.content, world.get(e, Settler).jobType)) {
      world.remove(e, ExploreOrder); // re-professioned or unowned mid-sweep - the intent dies
      continue;
    }
    if (world.has(e, PlayerOrder) || world.has(e, CurrentAtomic)) continue; // still walking this leg out
    const { centre, leg } = world.get(e, ExploreOrder);
    const p = world.get(e, Position);
    const hn = nodeOfPosition(p.x, p.y);
    const from = terrain.nodeAtClamped(hn.hx, hn.hy);
    const goal = nearestUnexploredNode(terrain, fog, owner.player, centre, from);
    if (goal === null) {
      world.remove(e, ExploreOrder); // nothing left unseen in the circle - the sweep is done
      continue;
    }
    if (leg !== null && leg.from === from && leg.to === goal) {
      world.remove(e, ExploreOrder); // the same leg from the same spot: the walk never started
      continue;
    }
    const c = terrain.coordsOf(goal);
    moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y });
    // moveUnit drops the order it supersedes; this one issued the walk, so it outlives it.
    world.add(e, ExploreOrder, { centre, leg: { from, to: goal } });
  }
};

/**
 * The walkable node nearest `from` whose cell `player` has never explored, inside
 * {@link EXPLORE_RADIUS_NODES} of `centre`. Ties break on the lower node id, so the leg a scout picks
 * never depends on scan order. Null when the circle holds no unexplored walkable ground, which is also
 * what an off fog mode reads, since then nothing is hidden.
 */
function nearestUnexploredNode(
  terrain: TerrainGraph,
  fog: FogState | undefined,
  player: number,
  centre: NodeId,
  from: NodeId,
): NodeId | null {
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return null;
  const c = terrain.coordsOf(centre);
  const f = terrain.coordsOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const minX = Math.max(0, c.x - EXPLORE_RADIUS_NODES);
  const maxX = Math.min(terrain.width - 1, c.x + EXPLORE_RADIUS_NODES);
  const minY = Math.max(0, c.y - EXPLORE_RADIUS_NODES);
  const maxY = Math.min(terrain.height - 1, c.y + EXPLORE_RADIUS_NODES);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dcx = x - c.x;
      const dcy = y - c.y;
      if (dcx * dcx + dcy * dcy > EXPLORE_RADIUS_NODES * EXPLORE_RADIUS_NODES) continue;
      const cell = cellOfNode(x, y);
      if (fog.stateAt(player, cell.cx, cell.cy) !== FOG_STATE.UNEXPLORED) continue;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node)) continue;
      const dx = x - f.x;
      const dy = y - f.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist || (dist === bestDist && best !== null && node < best)) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}
