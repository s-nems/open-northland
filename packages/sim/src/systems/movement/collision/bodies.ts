import { Building, Owner, PathFollow, PathRequest, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';

/**
 * Unit body collision is an authored deviation: the original is observed letting walkers pass through each
 * other. Soft movers (any owned walking settler) nudge each other apart; firm movers (owned fighters) also
 * resolve against posts, a firm collider standing still, whose nodes enter the walk overlay. Everyone else
 * is a ghost that passes through, which keeps converging economy flows unjammable.
 */

/**
 * The Manhattan node radius of a player's calm zone around each of its buildings. Inside its own zone a firm
 * mover drops to the soft tier and its posts stay out of that player's walk overlay; enemies get no
 * exemption. Approximation: sized to cover a building footprint plus its door approaches.
 */
const CALM_ZONE_RADIUS_NODES = 8;

/**
 * Whether `e` takes part in soft mover-vs-mover separation: any owned settler, fighter or civilian. The Owner
 * gate keeps unowned fixtures and goldens byte-identical.
 */
export function hasSoftCollision(world: World, e: Entity): boolean {
  return world.has(e, Owner) && world.has(e, Settler);
}

/** Whether `e` is standing for collision purposes: not walking and not waiting on a live route, since a
 *  pending request means it is about to leave the node. A failed request counts as standing. */
export function isStanding(world: World, e: Entity): boolean {
  if (world.has(e, PathFollow)) return false;
  const req = world.tryGet(e, PathRequest);
  return req === undefined || req.failed;
}

/** Every player's calm zones, one live object per world that {@link calmZonesByPlayer} keeps current. */
export interface CalmZones {
  /** Moves whenever a node enters or leaves a zone, so a tally taken under the zones knows to recount. */
  readonly revision: number;
  /** Whether `node` lies in one of `player`'s calm zones. */
  has(player: number, node: NodeId): boolean;
}

/** Where a counted building stamps its zone: its owner and its anchor node. */
interface ZoneAnchor {
  readonly player: number;
  readonly hx: number;
  readonly hy: number;
}

/**
 * Per-world calm zones, kept per player as how many building diamonds cover each node. The zones read
 * each owned building's anchor and player, and positions are immutable once placed. A building joining
 * or leaving shows in the Building journal, an Owner stamped on, dropped from or rewritten on a building
 * in the Owner journals; each named entity re-stamps only its own diamond. A journal gap re-stamps all.
 */
class ZonesMemo implements CalmZones {
  revision = 0;
  buildingGeneration = 0;
  ownerGeneration = 0;
  ownerValueGeneration = 0;
  readonly anchors = new Map<Entity, ZoneAnchor>();
  readonly cover = new Map<number, Map<NodeId, number>>();

  constructor(readonly terrain: TerrainGraph) {}

  has(player: number, node: NodeId): boolean {
    return this.cover.get(player)?.has(node) ?? false;
  }

  current(world: World): boolean {
    return (
      this.buildingGeneration === world.componentGeneration(Building) &&
      this.ownerGeneration === world.componentGeneration(Owner) &&
      this.ownerValueGeneration === world.componentValueGeneration(Owner)
    );
  }

  /** Record the generations the zones now describe. */
  settle(world: World): void {
    this.buildingGeneration = world.componentGeneration(Building);
    this.ownerGeneration = world.componentGeneration(Owner);
    this.ownerValueGeneration = world.componentValueGeneration(Owner);
  }

  /** Re-stamp every building from the stores. */
  rebuild(world: World): void {
    this.anchors.clear();
    this.cover.clear();
    this.revision++;
    for (const b of world.query(Building, Position)) this.reanchor(world, b);
    this.settle(world);
  }

  /** Replay the journals since the held generations; false on a journal gap. */
  catchUp(world: World): boolean {
    if (this.current(world)) return true;
    const building = deltasSince(world.componentGeneration(Building), this.buildingGeneration, (since) =>
      world.membershipDeltasSince(Building, since),
    );
    const owner = deltasSince(world.componentGeneration(Owner), this.ownerGeneration, (since) =>
      world.membershipDeltasSince(Owner, since),
    );
    const ownerValue = deltasSince(
      world.componentValueGeneration(Owner),
      this.ownerValueGeneration,
      (since) => world.valueWritesSince(Owner, since),
    );
    if (building === null || owner === null || ownerValue === null) return false;
    for (const e of building) this.reanchor(world, e);
    for (const e of owner) this.reanchor(world, e);
    for (const e of ownerValue) this.reanchor(world, e);
    this.settle(world);
    return true;
  }

  /** Move `e`'s stamp to where its live building, position and owner put it, or lift it. */
  private reanchor(world: World, e: Entity): void {
    const held = this.anchors.get(e);
    const owner = world.has(e, Building) ? world.tryGet(e, Owner) : undefined;
    const p = owner === undefined ? undefined : world.tryGet(e, Position);
    if (owner === undefined || p === undefined) {
      if (held === undefined) return;
      this.stamp(held, -1);
      this.anchors.delete(e);
      return;
    }
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    if (held !== undefined) {
      if (held.player === owner.player && held.hx === hx && held.hy === hy) return;
      this.stamp(held, -1);
    }
    const live = { player: owner.player, hx, hy };
    this.stamp(live, 1);
    this.anchors.set(e, live);
  }

  /** Add (`1`) or lift (`-1`) one building's Manhattan diamond from its player's cover. */
  private stamp(anchor: ZoneAnchor, delta: 1 | -1): void {
    const { terrain } = this;
    let cover = this.cover.get(anchor.player);
    if (cover === undefined) {
      cover = new Map();
      this.cover.set(anchor.player, cover);
    }
    for (let dx = -CALM_ZONE_RADIUS_NODES; dx <= CALM_ZONE_RADIUS_NODES; dx++) {
      const rem = CALM_ZONE_RADIUS_NODES - Math.abs(dx);
      for (let dy = -rem; dy <= rem; dy++) {
        const hx = anchor.hx + dx;
        const hy = anchor.hy + dy;
        if (!terrain.inBounds(hx, hy)) continue;
        const node = terrain.nodeAt(hx, hy);
        const count = (cover.get(node) ?? 0) + delta;
        if (count === 0) cover.delete(node);
        else cover.set(node, count);
        if (count === 0 || (delta === 1 && count === 1)) this.revision++;
      }
    }
    if (cover.size === 0) this.cover.delete(anchor.player);
  }
}

const NO_DELTAS: readonly Entity[] = [];

function deltasSince(
  now: number,
  held: number,
  since: (generation: number) => readonly Entity[] | null,
): readonly Entity[] | null {
  return now === held ? NO_DELTAS : since(held);
}

const zonesMemo = new WeakMap<World, ZonesMemo>();

function sameCover(a: ZonesMemo, b: ZonesMemo): boolean {
  if (a.cover.size !== b.cover.size) return false;
  for (const [player, cover] of a.cover) {
    const other = b.cover.get(player);
    if (other === undefined || other.size !== cover.size) return false;
    for (const [node, count] of cover) if (other.get(node) !== count) return false;
  }
  return true;
}

/** The `verifyCaches` tripwire for a zone input the journals fail to name, against a fresh stamp. */
function verifyZonesMemo(world: World): string[] {
  const memo = zonesMemo.get(world);
  if (memo === undefined || !memo.current(world)) return []; // behind - the next read catches up
  const fresh = new ZonesMemo(memo.terrain);
  fresh.rebuild(world);
  if (sameCover(memo, fresh)) return [];
  return ['calmZonesByPlayer diverges from a fresh derive - a building or owner change went unseen'];
}

/**
 * Every player's calm zones: a Manhattan diamond of {@link CALM_ZONE_RADIUS_NODES} around each of its
 * buildings' anchor nodes. Membership-only, so iteration order cannot change an answer, and never hashed.
 */
export function calmZonesByPlayer(world: World, terrain: TerrainGraph): CalmZones {
  const held = zonesMemo.get(world);
  if (held !== undefined && held.terrain === terrain) {
    if (!held.catchUp(world)) held.rebuild(world);
    return held;
  }
  world.journalMembership(Building);
  world.journalMembership(Owner);
  world.journalValueWrites(Owner);
  const memo = new ZonesMemo(terrain);
  memo.rebuild(world);
  zonesMemo.set(world, memo);
  world.registerCacheVerifier('calmZonesByPlayer', () => verifyZonesMemo(world));
  return memo;
}
