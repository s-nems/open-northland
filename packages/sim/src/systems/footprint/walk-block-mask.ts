import type { World } from '../../ecs/world.js';
import { type BlockOverlay, CountedBlocks, type CountedCells, NodeMask } from '../../nav/block-overlay.js';
import { NodeChangeStamps } from '../../nav/change-stamps.js';
import type { NodeArea } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { type LandscapeBlocks, landscapeBlocks } from '../landscape/view.js';
import { buildingBlockedLayer } from './building-blocked-cache.js';
import { resourceBlockedLayer, takeResourceBlockFlips } from './resource-blocked-cache.js';

// The union of the building, resource and landscape walk-block layers as one byte per node, levelled
// from the layers' own change logs. Derived state, never hashed.

/** The layers the mask unions. */
interface WalkBlockLayers {
  readonly building: CountedCells;
  readonly resource: CountedCells;
  readonly landscape: LandscapeBlocks;
}

/** Flipped nodes held for the label reader before the log is dropped and marked lost instead, so a world
 *  that routes without ever asking for labels stays bounded. */
const FLIP_LOG_CAP = 8192;

/**
 * The walk-block union as a live overlay: a read after any entity write first levels the mask with the
 * layers, so a holder sees current blocks, and a membership test is otherwise one array read.
 */
export class WalkBlockMask implements BlockOverlay {
  private revision = 0;
  /** Each walkable node's latest flip, stamped with {@link version}. */
  private readonly flipStamps: NodeChangeStamps;

  /** Whether a walkable node of `area` flipped after version `since` and passes `test`: independent
   *  readers can retain local searches without consuming the route label's flip log. */
  flippedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    this.catchUp();
    return this.flipStamps.anyChangedSince(area, since, test);
  }

  get version(): number {
    this.catchUp();
    return this.revision;
  }
  /** `World.mutationVersion` the mask was last levelled at: with no entity write since, no layer moved. */
  private checkedVersion = -1;
  private layers: WalkBlockLayers | null = null;
  private readonly mask: NodeMask;
  /** Scratch: nodes a layer may have flipped since the last levelling. */
  private readonly changed: NodeId[] = [];
  /** Walkable nodes whose membership flipped since {@link takeFlips}, a node possibly repeated. */
  private readonly flips: NodeId[] = [];
  private flipsLost = true;

  constructor(
    private readonly world: World,
    /** The latest caller's context; content is fixed per world, so any caller's serves. */
    public ctx: ContentContext,
    readonly terrain: TerrainGraph,
  ) {
    this.mask = new NodeMask(terrain.nodeCount);
    this.flipStamps = new NodeChangeStamps(terrain.width, terrain.height);
  }

  has(node: NodeId): boolean {
    this.catchUp();
    return this.mask.has(node);
  }

  get size(): number {
    this.catchUp();
    return this.mask.size;
  }

  /** The mask levelled now, read without the per-read level check: valid until the next entity write,
   *  for a flood that writes nothing. */
  levelled(): BlockOverlay {
    this.catchUp();
    return this.mask;
  }

  /**
   * Move the walkable nodes whose membership flipped since the previous call into `into`, returning false
   * when the log was dropped, so the reader must treat every node as changed. One reader per world: the
   * route-region labels.
   */
  takeFlips(into: NodeId[]): boolean {
    this.catchUp();
    const kept = !this.flipsLost;
    if (kept) for (const node of this.flips) into.push(node);
    this.flips.length = 0;
    this.flipsLost = false;
    return kept;
  }

  /** The mask as last levelled, read without levelling, when the label reader has taken every flip
   *  since: what the route-region labels were last re-keyed to. Null while flips wait for it. */
  labelBasis(): BlockOverlay | null {
    return this.flipsLost || this.flips.length > 0 ? null : this.mask;
  }

  /** Level the mask unless no entity was written since it last was. */
  catchUp(): void {
    if (this.world.mutationVersion !== this.checkedVersion) this.level();
  }

  /** Bring the mask level with the layers, from their change logs when each still has one since the last
   *  levelling, else by re-reading every node. */
  private level(): void {
    const world = this.world;
    const terrain = this.terrain;
    this.checkedVersion = world.mutationVersion;
    const held = this.layers;
    const building = buildingBlockedLayer(world, this.ctx, terrain);
    const resource = resourceBlockedLayer(world, terrain);
    const landscape = landscapeBlocks(world, terrain);
    const changed = this.changed;
    changed.length = 0;
    const tracked =
      takeResourceBlockFlips(world, terrain, changed) &&
      held !== null &&
      held.resource === resource &&
      landscapeChangesSince(held.landscape, landscape, changed);
    if (
      held !== null &&
      tracked &&
      held.building === building &&
      held.landscape === landscape &&
      changed.length === 0
    ) {
      return;
    }
    const layers: WalkBlockLayers = { building, resource, landscape };
    this.layers = layers;
    if (held === null || !tracked) {
      this.reread(layers);
      return;
    }
    const heldBuildings = held.building.cells;
    const buildings = building.cells;
    if (heldBuildings !== buildings) {
      for (const node of heldBuildings) if (!buildings.has(node)) changed.push(node);
      for (const node of buildings) if (!heldBuildings.has(node)) changed.push(node);
    }
    if (changed.length === 0) return;
    const overlay = layersOverlay(layers);
    for (const node of changed) {
      if (this.mask.set(node, overlay.has(node)) && terrain.isWalkable(node)) this.logFlip(node);
    }
  }

  private reread(layers: WalkBlockLayers): void {
    this.revision++;
    const overlay = layersOverlay(layers);
    for (let node = 0 as NodeId; node < this.terrain.nodeCount; node++)
      if (this.mask.set(node, overlay.has(node)) && this.terrain.isWalkable(node)) this.stampFlip(node);
    this.flips.length = 0;
    this.flipsLost = true;
  }

  private logFlip(node: NodeId): void {
    this.revision++;
    this.stampFlip(node);
    if (this.flips.length >= FLIP_LOG_CAP) {
      this.flips.length = 0;
      this.flipsLost = true;
    }
    if (!this.flipsLost) this.flips.push(node);
  }

  private stampFlip(node: NodeId): void {
    this.flipStamps.stamp(this.terrain.xOf(node), this.terrain.yOf(node), this.revision);
  }

  /** While the mask claims the current mutation version, it must match its layers node for node. */
  verify(): string[] {
    if (this.layers === null || this.checkedVersion !== this.world.mutationVersion) return [];
    const overlay = layersOverlay(this.layers);
    let stale = 0;
    for (let node = 0 as NodeId; node < this.terrain.nodeCount; node++) {
      if (this.mask.has(node) !== overlay.has(node)) stale += 1;
    }
    return stale === 0
      ? []
      : [`walkBlockMask disagrees with its layers on ${stale} nodes - a layer changed unlogged`];
  }
}

function layersOverlay(layers: WalkBlockLayers): BlockOverlay {
  const { building, resource, landscape } = layers;
  return new CountedBlocks([building, resource, { cells: landscape.walk, counts: landscape.walkCounts }]);
}

/** Append every walk-block change the landscape views made from `held` up to `current`, or return false
 *  when the retained view chain no longer reaches it. */
function landscapeChangesSince(held: LandscapeBlocks, current: LandscapeBlocks, into: NodeId[]): boolean {
  for (let view: LandscapeBlocks | undefined = held; view !== undefined; view = view.next) {
    if (view !== held) {
      for (const change of view.changes) if (change.channel === 'walk') into.push(change.node);
    }
    if (view === current) return true;
  }
  return false;
}

const maskByWorld = new WeakMap<World, WalkBlockMask>();

/** The world's {@link WalkBlockMask} on `terrain`, levelled now. */
export function walkBlockMask(world: World, ctx: ContentContext, terrain: TerrainGraph): WalkBlockMask {
  let mask = maskByWorld.get(world);
  if (mask === undefined || mask.terrain !== terrain) {
    const created = new WalkBlockMask(world, ctx, terrain);
    maskByWorld.set(world, created);
    world.registerCacheVerifier('walkBlockMask', () => created.verify());
    mask = created;
  } else {
    mask.ctx = ctx;
  }
  mask.catchUp();
  return mask;
}
