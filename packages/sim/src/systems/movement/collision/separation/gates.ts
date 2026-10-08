import { hostileMaskOf, hostilePlayerMasks, Owner, Position } from '../../../../components/index.js';
import type { Fixed } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { BlockOverlay } from '../../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { type CalmZones, calmZonesByPlayer } from '../bodies.js';
import { playerSlotBit } from '../standing-posts.js';

/** The tick's gates, built on first ask so a tick where no pair interacts builds none. Construct one per
 *  tick: the caches are snapshots, so a pooled instance would keep approving displacements onto ground
 *  blocked since, and keep answering the old calm zones and stances. */
export class SeparationGates {
  private zones: CalmZones | undefined;
  private blocked: BlockOverlay | undefined;
  private hostile: readonly number[] | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
  ) {}

  /** Whether `e` stands inside its own player's calm zone. */
  isGhost(e: Entity): boolean {
    this.zones ??= calmZonesByPlayer(this.world, this.terrain);
    const p = this.world.get(e, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    return (
      this.terrain.inBounds(hx, hy) &&
      this.zones.has(this.world.get(e, Owner).player, this.terrain.nodeAt(hx, hy))
    );
  }

  /** Keep the first `count` of `posts` that block `e`, in order; returns the new count. An enemy's post
   *  blocks it anywhere; its own side's and its allies' only on `goal`, so it walks through them but never
   *  comes to rest on one. */
  keepBlockingPosts(e: Entity, goal: NodeId | undefined, posts: Entity[], count: number): number {
    this.hostile ??= hostilePlayerMasks(this.world);
    const hostile = hostileMaskOf(this.hostile, this.world.get(e, Owner).player);
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const post = posts[i];
      if (post === undefined) continue;
      const onGoal = goal !== undefined && this.nodeOf(post) === goal;
      if ((hostile & playerSlotBit(this.world.get(post, Owner).player)) !== 0 || onGoal) {
        posts[kept++] = post;
      }
    }
    return kept;
  }

  /** The lattice node `e` stands on, undefined off the map. */
  nodeOf(e: Entity): NodeId | undefined {
    const p = this.world.get(e, Position);
    return this.nodeAt(p.x, p.y);
  }

  nodeAt(x: Fixed, y: Fixed): NodeId | undefined {
    const hx = nodeHxOfPosition(x, y);
    const hy = nodeHyOfPosition(y);
    return this.terrain.inBounds(hx, hy) ? this.terrain.nodeAt(hx, hy) : undefined;
  }

  allowsLanding(x: Fixed, y: Fixed): boolean {
    const hx = nodeHxOfPosition(x, y);
    const hy = nodeHyOfPosition(y);
    if (!this.terrain.inBounds(hx, hy)) return false;
    const node = this.terrain.nodeAt(hx, hy);
    if (!this.terrain.isWalkable(node)) return false;
    this.blocked ??= dynamicBlockOverlay(this.world, this.ctx, this.terrain);
    return !this.blocked.has(node);
  }
}
