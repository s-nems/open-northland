import { Owner, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { constructionWorkCells, dynamicBlockOverlay } from '../../footprint/index.js';
import { canonicalById, isTravelling, NodeBuckets } from '../../spatial/nodes.js';

/**
 * The 4-connected radius of a completed workplace's loiter yard (4 half-cell steps ≈ two visual tiles).
 * This is a presentation tuning value, not extracted data.
 */
const WORKPLACE_YARD_RADIUS_NODES = 4;

/**
 * The spacing state shared by every drive that parks a settler on a node, for the span of one planner
 * tick. `occupancy` is built up front; the derived views below it are built on first use and reused for
 * the rest of the pass, so a tick whose settlers never reach a spacing drive pays for none of them.
 */
export class PlannerSpacing {
  private readonly claims = new Set<NodeId>();
  private blocked: BlockOverlay | undefined;
  private workCellsBySite: Map<Entity, readonly NodeId[]> | undefined;
  private yardByAnchor: Map<NodeId, ReadonlySet<NodeId>> | undefined;

  private constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    /** Stationary owned settlers bucketed by integer tile, as of the moment this pass began. */
    readonly occupancy: NodeBuckets,
    private readonly buildBlockedCells: () => BlockOverlay,
  ) {}

  /** Gated on {@link Owner}: the unowned golden/economy fixtures bucket nothing, so their planner
   *  output stays byte-identical. */
  static forTick(world: World, ctx: SystemContext, terrain: TerrainGraph): PlannerSpacing {
    const stationaryOwned = canonicalById(world.query(Settler, Position, Owner)).filter(
      (e) => !isTravelling(world, e),
    );
    return new PlannerSpacing(world, ctx, terrain, new NodeBuckets(world, stationaryOwned), () =>
      dynamicBlockOverlay(world, ctx, terrain),
    );
  }

  /** Spacing over an occupancy and a walk-block overlay the caller already holds, for a fixture that
   *  pins both rather than deriving them from the world. */
  static overExplicit(
    world: World,
    ctx: SystemContext,
    terrain: TerrainGraph,
    occupancy: NodeBuckets,
    blocked: BlockOverlay,
  ): PlannerSpacing {
    return new PlannerSpacing(world, ctx, terrain, occupancy, () => blocked);
  }

  /** The building/resource walk-block overlay: cells a drive may neither aim at nor route through. */
  blockedCells(): BlockOverlay {
    this.blocked ??= this.buildBlockedCells();
    return this.blocked;
  }

  /** Whether another spacing drive has already taken `cell` this pass. Claims only accumulate. */
  isClaimed(cell: NodeId): boolean {
    return this.claims.has(cell);
  }

  claim(cell: NodeId): void {
    this.claims.add(cell);
  }

  workCells(site: Entity): readonly NodeId[] {
    this.workCellsBySite ??= new Map();
    let cells = this.workCellsBySite.get(site);
    if (cells === undefined) {
      cells = constructionWorkCells(this.world, this.ctx, this.terrain, site, this.blockedCells());
      this.workCellsBySite.set(site, cells);
    }
    return cells;
  }

  /**
   * A workplace anchor's loiter yard: every walkable, unblocked node reachable from `anchor` within
   * {@link WORKPLACE_YARD_RADIUS_NODES} 4-connected steps, in canonical ring order — Set insertion order
   * is the claim priority, anchor first when it qualifies. Blocked cells are neither entered nor
   * traversed, mirroring the pathfinder, so a yard never spans a wall or a stream the walk couldn't
   * cross. Bounded: ≤ ~2·R² nodes visited.
   */
  yard(anchor: NodeId): ReadonlySet<NodeId> {
    this.yardByAnchor ??= new Map();
    let yard = this.yardByAnchor.get(anchor);
    if (yard === undefined) {
      yard = this.buildYard(anchor);
      this.yardByAnchor.set(anchor, yard);
    }
    return yard;
  }

  private buildYard(anchor: NodeId): ReadonlySet<NodeId> {
    const blocked = this.blockedCells();
    const yard = new Set<NodeId>();
    if (this.terrain.isWalkable(anchor) && !blocked.has(anchor)) yard.add(anchor);
    const seen = new Set<NodeId>([anchor]);
    let frontier: NodeId[] = [anchor];
    for (let depth = 0; depth < WORKPLACE_YARD_RADIUS_NODES; depth++) {
      const next: NodeId[] = [];
      for (const cell of frontier) {
        for (const n of this.terrain.walkableNeighbours(cell)) {
          if (seen.has(n) || blocked.has(n)) continue;
          seen.add(n);
          yard.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
    return yard;
  }
}
