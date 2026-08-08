import { Owner, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { BlockOverlay } from '../../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { constructionWorkCells, dynamicBlockOverlay } from '../../footprint/index.js';
import { isTravelling } from '../../movement/nav-state.js';
import { canonicalById, NodeBuckets } from '../../spatial/nodes.js';

/**
 * The 4-connected radius of a completed workplace's loiter yard, in half-cell steps, about two visual
 * tiles. Approximation: a presentation tuning value, not extracted data.
 */
const WORKPLACE_YARD_RADIUS_NODES = 4;

/**
 * The spacing state shared by every drive that parks a settler on a node, for one planner tick.
 * `occupancy` is built up front; the derived views are built on first use, so a tick whose settlers
 * never reach a spacing drive pays for none of them.
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

  /** Gated on {@link Owner}, so an unowned fixture buckets nothing. */
  static forTick(world: World, ctx: SystemContext, terrain: TerrainGraph): PlannerSpacing {
    const stationaryOwned = canonicalById(world.query(Settler, Position, Owner)).filter(
      (e) => !isTravelling(world, e),
    );
    return new PlannerSpacing(world, ctx, terrain, new NodeBuckets(world, stationaryOwned), () =>
      dynamicBlockOverlay(world, ctx, terrain),
    );
  }

  /** Spacing over an occupancy and a walk-block overlay the caller already holds, for a fixture that
   *  pins both instead of deriving them from the world. */
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
   * A workplace anchor's loiter yard: every walkable, unblocked node within
   * {@link WORKPLACE_YARD_RADIUS_NODES} 4-connected steps of `anchor`, in canonical ring order, where
   * insertion order is the claim priority. Blocked cells are neither entered nor traversed, mirroring
   * the pathfinder, so a yard never spans a wall the walk could not cross.
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
