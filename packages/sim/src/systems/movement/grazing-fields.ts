import type { ContentSet } from '@open-northland/data';
import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  DraughtAnimal,
  Engagement,
  FarmAnimal,
  Frightened,
  Livestock,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Resting,
  Settler,
  StayPoint,
} from '../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { territoryRangeIn } from '../livestock/assignment.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { isTravelling } from './nav-state.js';
import { SPACING_PROBES } from './spacing.js';
import { settlerMovementNode } from './traversal.js';

/** An entity's role for the grazing drive: not an animal at all. */
const NOT_ANIMAL = 0;
/** Resting inside a building or travelling: off the field. */
const OFF_FIELD = 1;
/** Standing on a field while another drive (an atomic, a fight, a fright, a summon, a cart) holds it. */
const HELD = 2;
/** Standing on a field with no other drive holding it: the grazing drive's to move. */
const GRAZING = 3;

/** The node of an entity off the field, and the end of a per-node stander list (lists hold ids one-based). */
const NO_NODE = -1;
const NO_ENTRY = 0;

/** Stores whose membership makes an entity an animal: `StayPoint`, `Settler` and `Position` together. */
const ANIMAL_MEMBERSHIP = [StayPoint, Settler, Position];
/** Stores an animal's role or territory range reads: field standing (Resting, the travel state), the
 *  drives that hold a stander, and the claim that sets the leash. */
const ROLE_MEMBERSHIP = [
  Resting,
  MoveGoal,
  PathRequest,
  PathFollow,
  CurrentAtomic,
  DraughtAnimal,
  FarmAnimal,
  Engagement,
  Anger,
  AttackOrder,
  Frightened,
  Livestock,
  Owner,
];
/** `FarmAnimal.summoner` is written in place. */
const ROLE_VALUES = [FarmAnimal];

const idOf = (e: Entity): number => e;

/** The changes a {@link GrazingFields} replays, kept for the world's lifetime: animal membership, role
 *  stores, and node moves. */
interface FieldFeeds {
  readonly animals: ChangeFeed;
  readonly roles: ChangeFeed;
  readonly moves: NodeMoveFeed;
}

/** Whether a drive other than grazing holds standing animal `e`. */
function driveHolds(world: World, e: Entity): boolean {
  return (
    world.has(e, CurrentAtomic) ||
    world.has(e, DraughtAnimal) ||
    world.tryGet(e, FarmAnimal)?.summoner != null ||
    world.has(e, Engagement) ||
    world.has(e, Anger) ||
    world.has(e, AttackOrder) ||
    world.has(e, Frightened)
  );
}

/**
 * The animals standing on the field and their elected keepers, kept across ticks. The first stander in
 * ascending id whose spacing holds no lower keeper keeps its field. A change re-elects only the standers
 * near it and, when a keeper flips, the higher ones near that keeper, so a pass costs the changes since
 * the last one rather than the herd.
 */
export class GrazingFields {
  private readonly grazerIds: Entity[] = [];
  private roles = new Uint8Array(0);
  /** Each stander's node, {@link NO_NODE} off the field. */
  private nodes = new Int32Array(0);
  private keepers = new Uint8Array(0);
  private ranges = new Int32Array(0);
  private claims = new Uint8Array(0);
  /** The next stander on the same node, one-based; per node, {@link firstOnNode} starts the list. */
  private nextOnNode = new Int32Array(0);
  private readonly firstOnNode: Int32Array;
  /** Per node, its keeper's id plus one. */
  private readonly keeperByNode: Int32Array;
  /** Standers to re-elect, ascending id. */
  private readonly dirty: Entity[] = [];
  private readonly resyncAny = (e: Entity): void => this.resync(e);
  private readonly resyncAnimal = (e: Entity): void => {
    if ((this.roles[e] ?? NOT_ANIMAL) !== NOT_ANIMAL) this.resync(e);
  };
  private readonly resyncStander = (e: Entity): void => {
    if ((this.nodes[e] ?? NO_NODE) !== NO_NODE) this.resync(e);
  };

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
    readonly feeds: FieldFeeds,
  ) {
    this.firstOnNode = new Int32Array(terrain.nodeCount);
    this.keeperByNode = new Int32Array(terrain.nodeCount);
    this.rebuild();
  }

  /** Standing animals no other drive holds, ascending id: the grazing drive's candidates. */
  get grazers(): readonly Entity[] {
    return this.grazerIds;
  }

  nodeOf(e: Entity): NodeId {
    return (this.nodes[e] ?? NO_NODE) as NodeId;
  }

  rangeOf(e: Entity): number {
    return this.ranges[e] ?? 0;
  }

  /** Whether `e` is livestock a player owns, which grazes at the calm cadence. */
  claimed(e: Entity): boolean {
    return this.claims[e] === 1;
  }

  keeperAt(node: NodeId): Entity | undefined {
    const stored = this.keeperByNode[node] ?? NO_ENTRY;
    return stored === NO_ENTRY ? undefined : ((stored - 1) as Entity);
  }

  /** The keeper holding `node` or any node within the stander spacing of it, or undefined when free. */
  keeperNear(node: NodeId): Entity | undefined {
    const terrain = this.terrain;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (const probe of SPACING_PROBES) {
      const dx = probe[0];
      const dy = probe[1];
      if (!terrain.inBounds(x + dx, y + dy)) continue;
      const keeper = this.keeperAt(terrain.nodeAt(x + dx, y + dy));
      if (keeper !== undefined) return keeper;
    }
    return undefined;
  }

  /** Applies the changes since the last pass. */
  update(): void {
    const { animals, roles, moves } = this.feeds;
    let lost = animals.drain(this.resyncAny);
    lost = roles.drain(this.resyncAnimal) || lost;
    lost = moves.drain(this.resyncStander) || lost;
    if (lost) this.rebuild();
    else this.elect();
  }

  private rebuild(): void {
    const { animals, roles, moves } = this.feeds;
    animals.drain(() => {});
    roles.drain(() => {});
    moves.drain(() => {});
    const size = this.world.nextEntityId;
    this.roles = new Uint8Array(size);
    this.nodes = new Int32Array(size).fill(NO_NODE);
    this.keepers = new Uint8Array(size);
    this.ranges = new Int32Array(size);
    this.claims = new Uint8Array(size);
    this.nextOnNode = new Int32Array(size);
    this.firstOnNode.fill(NO_ENTRY);
    this.keeperByNode.fill(NO_ENTRY);
    this.grazerIds.length = 0;
    this.dirty.length = 0;
    for (const e of this.world.canonicalQuery(...ANIMAL_MEMBERSHIP)) this.resync(e);
    this.elect();
  }

  /** Re-derive `e`'s role, node and range from the stores. */
  private resync(e: Entity): void {
    const world = this.world;
    if (e >= this.roles.length) this.grow(e);
    let role = NOT_ANIMAL;
    let node: NodeId | null = null;
    if (world.has(e, StayPoint) && world.has(e, Settler) && world.has(e, Position)) {
      if (world.has(e, Resting) || isTravelling(world, e)) {
        role = OFF_FIELD;
      } else {
        node = settlerMovementNode(world, this.terrain, e);
        role = driveHolds(world, e) ? HELD : GRAZING;
      }
      this.ranges[e] = territoryRangeIn(world, this.content, e);
      this.claims[e] = world.has(e, Livestock) && world.has(e, Owner) ? 1 : 0;
    }
    const wasGrazing = this.roles[e] === GRAZING;
    this.roles[e] = role;
    if (this.nodes[e] !== (node ?? NO_NODE)) {
      if (this.nodes[e] !== NO_NODE) this.leave(e);
      if (node !== null) this.enter(e, node);
    }
    if (wasGrazing !== (role === GRAZING)) {
      if (role === GRAZING) insertSortedById(this.grazerIds, e, idOf);
      else removeSortedById(this.grazerIds, e, idOf);
    }
  }

  private enter(e: Entity, node: NodeId): void {
    this.nodes[e] = node;
    this.nextOnNode[e] = this.firstOnNode[node] ?? NO_ENTRY;
    this.firstOnNode[node] = e + 1;
    this.markDirty(e);
  }

  /** Takes stander `e` off its node's list, freeing the higher standers its keep blocked. */
  private leave(e: Entity): void {
    const node = this.nodeOf(e);
    this.nodes[e] = NO_NODE;
    let prev = NO_ENTRY;
    let at = this.firstOnNode[node] ?? NO_ENTRY;
    while (at !== NO_ENTRY && at !== e + 1) {
      prev = at;
      at = this.nextOnNode[at - 1] ?? NO_ENTRY;
    }
    const next = this.nextOnNode[e] ?? NO_ENTRY;
    if (prev === NO_ENTRY) this.firstOnNode[node] = next;
    else this.nextOnNode[prev - 1] = next;
    this.nextOnNode[e] = NO_ENTRY;
    if (this.keepers[e] !== 1) return;
    this.keepers[e] = 0;
    if (this.keeperByNode[node] === e + 1) this.keeperByNode[node] = NO_ENTRY;
    this.markHigherNear(node, e);
  }

  /** Re-elects the dirty standers in ascending id: a stander's election reads only lower ids, so each is
   *  final when visited, and a flip queues the higher standers it may now block or free. */
  private elect(): void {
    const dirty = this.dirty;
    for (let i = 0; i < dirty.length; i++) {
      const e = dirty[i] as Entity;
      const node = this.nodeOf(e);
      if (node === NO_NODE) continue;
      const keeps = !this.lowerKeeperNear(e, node);
      if (keeps) this.keeperByNode[node] = e + 1;
      if (keeps === (this.keepers[e] === 1)) continue;
      this.keepers[e] = keeps ? 1 : 0;
      if (!keeps && this.keeperByNode[node] === e + 1) this.keeperByNode[node] = NO_ENTRY;
      this.markHigherNear(node, e);
    }
    dirty.length = 0;
  }

  private lowerKeeperNear(e: Entity, node: NodeId): boolean {
    const terrain = this.terrain;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (const probe of SPACING_PROBES) {
      const dx = probe[0];
      const dy = probe[1];
      if (!terrain.inBounds(x + dx, y + dy)) continue;
      let at = this.firstOnNode[terrain.nodeAt(x + dx, y + dy)] ?? NO_ENTRY;
      for (; at !== NO_ENTRY; at = this.nextOnNode[at - 1] ?? NO_ENTRY) {
        if (at - 1 < e && this.keepers[at - 1] === 1) return true;
      }
    }
    return false;
  }

  private markHigherNear(node: NodeId, above: Entity): void {
    const terrain = this.terrain;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (const probe of SPACING_PROBES) {
      const dx = probe[0];
      const dy = probe[1];
      if (!terrain.inBounds(x + dx, y + dy)) continue;
      let at = this.firstOnNode[terrain.nodeAt(x + dx, y + dy)] ?? NO_ENTRY;
      for (; at !== NO_ENTRY; at = this.nextOnNode[at - 1] ?? NO_ENTRY) {
        if (at - 1 > above) this.markDirty((at - 1) as Entity);
      }
    }
  }

  private markDirty(e: Entity): void {
    if (!includesSortedId(this.dirty, e, idOf)) insertSortedById(this.dirty, e, idOf);
  }

  private grow(e: Entity): void {
    const size = Math.max(this.world.nextEntityId, e + 1, 2 * this.roles.length);
    const widen = <T extends Uint8Array | Int32Array>(from: T, to: T): T => {
      to.set(from);
      return to;
    };
    this.roles = widen(this.roles, new Uint8Array(size));
    this.nodes = widen(this.nodes, new Int32Array(size).fill(NO_NODE));
    this.keepers = widen(this.keepers, new Uint8Array(size));
    this.ranges = widen(this.ranges, new Int32Array(size));
    this.claims = widen(this.claims, new Uint8Array(size));
    this.nextOnNode = widen(this.nextOnNode, new Int32Array(size));
  }

  /** Brings the index up to date, then compares it with a fresh election over the stores. */
  verify(): string[] {
    this.update();
    const world = this.world;
    const fresh = new Map<NodeId, Entity>();
    const grazers: Entity[] = [];
    let wrong = 0;
    for (const e of world.canonicalQuery(...ANIMAL_MEMBERSHIP)) {
      if (this.ranges[e] !== territoryRangeIn(world, this.content, e)) wrong++;
      if (this.claimed(e) !== (world.has(e, Livestock) && world.has(e, Owner))) wrong++;
      if (world.has(e, Resting) || isTravelling(world, e)) {
        if (this.nodeOf(e) !== NO_NODE) wrong++;
        continue;
      }
      const node = settlerMovementNode(world, this.terrain, e);
      if (this.nodeOf(e) !== node) wrong++;
      if (!driveHolds(world, e)) grazers.push(e);
      if (this.keeperNearIn(fresh, node)) continue;
      fresh.set(node, e);
    }
    for (const [node, keeper] of fresh) if (this.keeperAt(node) !== keeper) wrong++;
    if (this.keeperByNode.reduce((held, k) => (k === NO_ENTRY ? held : held + 1), 0) !== fresh.size) wrong++;
    if (grazers.length !== this.grazers.length || grazers.some((e, i) => this.grazers[i] !== e)) wrong++;
    return wrong === 0 ? [] : [`grazingFields: ${wrong} checks disagree with a fresh election`];
  }

  private keeperNearIn(keepers: ReadonlyMap<NodeId, Entity>, node: NodeId): boolean {
    const terrain = this.terrain;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (const [dx, dy] of SPACING_PROBES) {
      if (terrain.inBounds(x + dx, y + dy) && keepers.has(terrain.nodeAt(x + dx, y + dy))) return true;
    }
    return false;
  }
}

const indexes = new WeakMap<World, GrazingFields>();

/** `world`'s grazing fields, brought up to date. Valid until the next call; never mutate it. */
export function grazingFields(world: World, content: ContentSet, terrain: TerrainGraph): GrazingFields {
  const held = indexes.get(world);
  if (held !== undefined && held.content === content && held.terrain === terrain) {
    held.update();
    return held;
  }
  const fields = new GrazingFields(
    world,
    content,
    terrain,
    held?.feeds ?? {
      animals: world.watchChanges(ANIMAL_MEMBERSHIP, []),
      roles: world.watchChanges(ROLE_MEMBERSHIP, ROLE_VALUES),
      moves: watchNodeMoves(world),
    },
  );
  if (held === undefined)
    world.registerCacheVerifier('grazingFields', () => indexes.get(world)?.verify() ?? []);
  indexes.set(world, fields);
  return fields;
}
