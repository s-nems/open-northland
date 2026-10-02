import { Owner, Position } from '../../../../components/index.js';
import type { Fixed } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { BlockOverlay } from '../../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { type CalmZones, calmZonesByPlayer } from '../bodies.js';

/** The tick's two terrain-derived gates, built on first ask so a tick where no pair interacts builds
 *  neither. Construct one per tick: both caches are snapshots, so a pooled instance would keep approving
 *  displacements onto ground blocked since, and keep answering the old calm zones. */
export class SeparationGates {
  private zones: CalmZones | undefined;
  private blocked: BlockOverlay | undefined;

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
