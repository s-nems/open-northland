import { hostileMaskOf, hostilePlayerMasks, type Waypoint } from '../../../../components/index.js';
import type { Fixed } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeMask } from '../../../../nav/block-overlay.js';
import {
  type NodesBeside,
  nodeHxOfPosition,
  nodeHyOfPosition,
  nodesBesidePosition,
} from '../../../../nav/halfcell.js';
import { columnStepMiddles } from '../../../../nav/pathfinding/straight-steps.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { walkBlockMask } from '../../../footprint/walk-block-mask.js';
import { columnStepStopAt } from '../../../spatial/mover-node.js';
import { type CalmZones, calmZonesByPlayer } from '../bodies.js';
import { playerSlotBit } from '../standing-posts.js';

/** {@link nodesBesidePosition}'s result, reused so a landing test allocates nothing. */
const beside: NodesBeside = { northHx: 0, northHy: 0, southHx: 0, southHy: 0 };

/** A player id outside every slot, so its slot bit is zero; only for the type, as every listed post has
 *  an owner. */
const NO_PLAYER = -1;

/** The tick's gates, built on first ask so a tick where no pair interacts builds none. {@link reset} them
 *  every tick: the caches are snapshots, so a held answer would keep approving displacements onto ground
 *  blocked since, and keep answering the old calm zones and stances. Within the pass they hold: it writes
 *  only movers' Position and walk state, which no walk-block layer reads. */
export class SeparationGates {
  private zones: CalmZones | undefined;
  private blocked: NodeMask | undefined;
  private hostile: readonly number[] | undefined;

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
    private terrain: TerrainGraph,
  ) {}

  /** Drop the previous tick's answers and bind this tick's context. */
  reset(ctx: SystemContext, terrain: TerrainGraph): void {
    this.ctx = ctx;
    this.terrain = terrain;
    this.zones = undefined;
    this.blocked = undefined;
    this.hostile = undefined;
  }

  /** Whether half-cell node `(hx, hy)` lies inside one of `player`'s calm zones. */
  isGhost(player: number, hx: number, hy: number): boolean {
    this.zones ??= calmZonesByPlayer(this.world, this.terrain);
    return this.terrain.inBounds(hx, hy) && this.zones.has(player, this.terrain.nodeAt(hx, hy));
  }

  /** Keep the first `count` of `posts`, owned by `players` and standing on `nodes`, that block a mover of
   *  `player`, in order; returns the new count. An enemy's post blocks it anywhere; its own side's and its
   *  allies' only on `goal`, so it walks through them but never comes to rest on one. */
  keepBlockingPosts(
    player: number,
    goal: NodeId | undefined,
    posts: Entity[],
    players: readonly number[],
    nodes: readonly number[],
    count: number,
  ): number {
    this.hostile ??= hostilePlayerMasks(this.world);
    const hostile = hostileMaskOf(this.hostile, player);
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const post = posts[i];
      if (post === undefined) continue;
      const onGoal = goal !== undefined && nodes[i] === goal;
      if ((hostile & playerSlotBit(players[i] ?? NO_PLAYER)) !== 0 || onGoal) posts[kept++] = post;
    }
    return kept;
  }

  nodeAt(x: Fixed, y: Fixed): NodeId | undefined {
    const hx = nodeHxOfPosition(x, y);
    const hy = nodeHyOfPosition(x, y);
    return this.terrain.inBounds(hx, hy) ? this.terrain.nodeAt(hx, hy) : undefined;
  }

  /** Whether a push may land a body at `(x, y)`: off a column step, the nodes it stands between are
   *  walkable and unblocked, since walking on it reads either. On column step `step` the stop it reads
   *  there is, and so is the node under it unless that is one the step passes between: the step reads only
   *  its own stops, so a closed middle does not hold it. */
  allowsLanding(x: Fixed, y: Fixed, step: readonly [Waypoint, Waypoint] | undefined): boolean {
    if (step !== undefined) {
      const stop = columnStepStopAt(step[0], step[1], y);
      if (!this.openNode(nodeHxOfPosition(stop.x, stop.y), nodeHyOfPosition(stop.x, stop.y))) return false;
      const hx = nodeHxOfPosition(x, y);
      const hy = nodeHyOfPosition(x, y);
      if (this.openNode(hx, hy)) return true;
      if (!this.terrain.inBounds(hx, hy)) return false;
      const under = this.terrain.nodeAt(hx, hy);
      return columnStepMiddles(this.terrain, step[0].node, step[1].node).includes(under);
    }
    nodesBesidePosition(x, y, beside);
    return this.openNode(beside.northHx, beside.northHy) && this.openNode(beside.southHx, beside.southHy);
  }

  private openNode(hx: number, hy: number): boolean {
    if (!this.terrain.inBounds(hx, hy)) return false;
    const node = this.terrain.nodeAt(hx, hy);
    if (!this.terrain.isWalkable(node)) return false;
    this.blocked ??= walkBlockMask(this.world, this.ctx, this.terrain).levelled();
    return !this.blocked.has(node);
  }
}
