import { footprintCellDx } from '@open-northland/data';
import { LandscapeResource, landscapeEditState, landscapeRevision } from '../../components/landscape.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import {
  LandscapePlacements,
  type NodeId,
  type ScriptLandscapePlacement,
  type ScriptLandscapeType,
  type TerrainGraph,
} from '../../nav/terrain/index.js';
import { countsMatchCells, sameCells } from '../footprint/geometry.js';
import { placementBlockCells } from './footprint.js';

// The live landscape as a script sees it: the map's authored placements minus the ones a script removed
// or a resource depleted, plus the script's own additions, every read costing the placements it touches.

/** The file position of an id the map never laid. */
const ABSENT = -1;

/** The map's authored placements, indexed once per terrain: the input is immutable. A placement is
 *  named by its file position, which also orders an area match whatever node order found it. */
class AuthoredLandscapes {
  readonly types: ReadonlyMap<number, ScriptLandscapeType>;
  readonly placements: LandscapePlacements;
  /** One past the highest authored id, where the script's own ids start. */
  readonly nextId: number;
  /** File position by id, {@link ABSENT} for an id the map skipped: ids are file positions, so dense. */
  private readonly indexById: Int32Array;
  /** Placements by anchor node as one list, node `n` owning `[nodeStarts[n], nodeStarts[n + 1])` in
   *  file order. */
  private readonly nodeStarts: Int32Array;
  private readonly nodeEntries: Int32Array;
  /** The resource-backed placements, and those whose type holds attach points, in file order. */
  readonly resourceBacked: Int32Array;
  readonly attaching: Int32Array;

  constructor(terrain: TerrainGraph) {
    const input = terrain.landscapes?.placements ?? [];
    const placements = input instanceof LandscapePlacements ? input : LandscapePlacements.from(input);
    const types = new Map(terrain.landscapes?.types.map((type) => [type.typeId, type]));
    let nextId = 0;
    let resourceBacked = 0;
    let attaching = 0;
    const nodeStarts = new Int32Array(terrain.nodeCount + 1);
    for (let i = 0; i < placements.length; i++) {
      const id = placements.id(i);
      if (id < 0) throw new RangeError(`authored landscape id ${id} is negative`);
      nextId = Math.max(nextId, id + 1);
      if (placements.resourceBacked(i)) resourceBacked++;
      if ((types.get(placements.typeId(i))?.attach?.length ?? 0) > 0) attaching++;
      const hx = placements.hx(i);
      const hy = placements.hy(i);
      if (!terrain.inBounds(hx, hy)) continue;
      const slot = terrain.nodeAt(hx, hy) + 1;
      nodeStarts[slot] = (nodeStarts[slot] ?? 0) + 1;
    }
    for (let n = 0; n < terrain.nodeCount; n++)
      nodeStarts[n + 1] = (nodeStarts[n + 1] ?? 0) + (nodeStarts[n] ?? 0);
    const fill = nodeStarts.slice(0, terrain.nodeCount);
    const nodeEntries = new Int32Array(nodeStarts[terrain.nodeCount] ?? 0);
    const indexById = new Int32Array(nextId).fill(ABSENT);
    this.resourceBacked = new Int32Array(resourceBacked);
    this.attaching = new Int32Array(attaching);
    resourceBacked = 0;
    attaching = 0;
    for (let i = 0; i < placements.length; i++) {
      indexById[placements.id(i)] = i;
      if (placements.resourceBacked(i)) this.resourceBacked[resourceBacked++] = i;
      if ((types.get(placements.typeId(i))?.attach?.length ?? 0) > 0) this.attaching[attaching++] = i;
      const hx = placements.hx(i);
      const hy = placements.hy(i);
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      const slot = fill[node] ?? 0;
      nodeEntries[slot] = i;
      fill[node] = slot + 1;
    }
    this.types = types;
    this.placements = placements;
    this.nextId = nextId;
    this.indexById = indexById;
    this.nodeStarts = nodeStarts;
    this.nodeEntries = nodeEntries;
  }

  /** The file position of authored `id`, or {@link ABSENT}. */
  indexOf(id: number): number {
    return id >= 0 && id < this.indexById.length ? (this.indexById[id] ?? ABSENT) : ABSENT;
  }

  has(id: number): boolean {
    return this.indexOf(id) !== ABSENT;
  }

  /** Whether a placement anchored on `node` still stands. */
  standsAt(node: NodeId, world: World, removed: ReadonlySet<number>): boolean {
    const placements = this.placements;
    const end = this.nodeStarts[node + 1] ?? 0;
    for (let k = this.nodeStarts[node] ?? 0; k < end; k++) {
      const i = this.nodeEntries[k] ?? 0;
      const id = placements.id(i);
      if (removed.has(id)) continue;
      if (!placements.resourceBacked(i) || landscapeResources(world).has(id)) return true;
    }
    return false;
  }

  /** Visit the placements anchored on `node`, in file order. */
  forEachAt(node: NodeId, visit: (index: number) => void): void {
    const end = this.nodeStarts[node + 1] ?? 0;
    for (let k = this.nodeStarts[node] ?? 0; k < end; k++) visit(this.nodeEntries[k] ?? 0);
  }
}

const authoredIndexes = new WeakMap<TerrainGraph, AuthoredLandscapes>();

export function authoredLandscapes(terrain: TerrainGraph): AuthoredLandscapes {
  let held = authoredIndexes.get(terrain);
  if (held === undefined) {
    held = new AuthoredLandscapes(terrain);
    authoredIndexes.set(terrain, held);
  }
  return held;
}

export function landscapeTypes(terrain: TerrainGraph): ReadonlyMap<number, ScriptLandscapeType> {
  return authoredLandscapes(terrain).types;
}

/** The entities standing in for resource-backed placements, by placement id. Read again after a
 *  resource is created or reaped: an index held across that may be stale or patched. */
export interface ResourceIndex {
  has(id: number): boolean;
  /** The entities standing in for placement `id` in store order, empty for none; never edited later. */
  entitiesOf(id: number): readonly Entity[];
}

const NO_ENTITIES: readonly Entity[] = [];

/** {@link ResourceIndex} kept in step with the store's membership journal: a felled tree replays one
 *  entity instead of re-reading every resource on the map. */
class LiveResources implements ResourceIndex {
  /** Per placement id its one entity, or the entities in store order when several stand for it: nearly
   *  every id has one, so it holds no list. A list is replaced, never edited, so a held one stays valid. */
  readonly byId = new Map<number, Entity | readonly Entity[]>();
  /** The placement id each indexed entity stands for, to find its bucket once its component is gone. */
  readonly idOf = new Map<Entity, number>();

  constructor(public generation: number) {}

  has(id: number): boolean {
    return this.byId.has(id);
  }

  entitiesOf(id: number): readonly Entity[] {
    const held = this.byId.get(id);
    return held === undefined ? NO_ENTITIES : typeof held === 'number' ? [held] : held;
  }
}
const liveResources = new WeakMap<World, LiveResources>();

function indexResources(world: World): LiveResources {
  const live = new LiveResources(world.componentGeneration(LandscapeResource));
  const { byId, idOf } = live;
  for (const entity of world.query(LandscapeResource)) {
    const id = world.get(entity, LandscapeResource).id;
    idOf.set(entity, id);
    const held = byId.get(id);
    if (held === undefined) byId.set(id, entity);
    else byId.set(id, typeof held === 'number' ? [held, entity] : [...held, entity]);
  }
  return live;
}

/** Apply one journaled entity: false when its bucket holds another entity too, whose order against it
 *  only the store knows, so the caller re-reads the store. */
function replayResource(world: World, live: LiveResources, entity: Entity): boolean {
  const before = live.idOf.get(entity);
  const after = world.tryGet(entity, LandscapeResource)?.id;
  if (before !== undefined && typeof live.byId.get(before) === 'object') return false;
  if (after !== undefined && after !== before && live.byId.has(after)) return false;
  if (before === after) return true;
  if (before !== undefined) {
    live.byId.delete(before);
    live.idOf.delete(entity);
  }
  if (after !== undefined) {
    live.byId.set(after, entity);
    live.idOf.set(entity, after);
  }
  return true;
}

export function landscapeResources(world: World): ResourceIndex {
  const generation = world.componentGeneration(LandscapeResource);
  let live = liveResources.get(world);
  if (live?.generation === generation) return live;
  if (live !== undefined) {
    const held = live;
    let exact = true;
    const replayed = world.replayMembershipSince(LandscapeResource, held.generation, (entity) => {
      if (exact) exact = replayResource(world, held, entity);
    });
    if (replayed && exact) {
      held.generation = generation;
      return held;
    }
  }
  world.journalMembership(LandscapeResource);
  const fresh = indexResources(world);
  if (live === undefined) world.registerCacheVerifier('landscapeResources', () => verifyResources(world));
  live = fresh;
  liveResources.set(world, live);
  return live;
}

/** The {@link landscapeResources} coherence verifier (`verifyCaches`): a cold read of the store must
 *  hold the same buckets in the same order. */
function verifyResources(world: World): string[] {
  const live = liveResources.get(world);
  if (live === undefined || live.generation !== world.componentGeneration(LandscapeResource)) return [];
  const fresh = indexResources(world);
  if (fresh.byId.size !== live.byId.size) {
    return [`landscapeResources holds ${live.byId.size} ids but re-derived ${fresh.byId.size}`];
  }
  for (const id of fresh.byId.keys()) {
    const entities = fresh.entitiesOf(id);
    const held = live.entitiesOf(id);
    if (held.length !== entities.length || held.some((e, k) => e !== entities[k])) {
      return [`landscapeResources bucket ${id} disagrees with the store`];
    }
  }
  return [];
}

interface RemovedIds {
  readonly revision: number;
  readonly ids: ReadonlySet<number>;
}
const removedIdSets = new WeakMap<World, RemovedIds>();

function removedIds(world: World): ReadonlySet<number> {
  const state = landscapeEditState(world);
  const held = removedIdSets.get(world);
  if (held?.revision === state.topologyRevision) return held.ids;
  const ids = new Set(state.removed);
  removedIdSets.set(world, { revision: state.topologyRevision, ids });
  return ids;
}

/** Whether the placement still stands: not removed by a script, and its backing resource, if any, not
 *  yet reaped. `resources` is read lazily, so a decor-only query never pays for the resource index. */
function standing(
  id: number,
  resourceBacked: boolean,
  removed: ReadonlySet<number>,
  resources: () => ResourceIndex,
): boolean {
  if (removed.has(id)) return false;
  return !resourceBacked || resources().has(id);
}

/**
 * The standing placements whose anchor lies within `range` map points of `point`: the authored ones in
 * file order, then the script's additions in the order they were laid. Costs the hexagon's nodes and
 * the additions, never the whole map.
 */
export function landscapesWithin(
  world: World,
  terrain: TerrainGraph,
  point: HalfCellNode,
  range: number,
): ScriptLandscapePlacement[] {
  if (range < 0) return [];
  const authored = authoredLandscapes(terrain);
  const placements = authored.placements;
  const removed = removedIds(world);
  let resourceIndex: ResourceIndex | undefined;
  const resources = (): ResourceIndex => {
    resourceIndex ??= landscapeResources(world);
    return resourceIndex;
  };
  const indexes: number[] = [];
  const collect = (i: number): void => {
    if (standing(placements.id(i), placements.resourceBacked(i), removed, resources)) indexes.push(i);
  };
  const yMin = Math.max(0, point.hy - range);
  const yMax = Math.min(terrain.height - 1, point.hy + range);
  const xMin = Math.max(0, point.hx - range);
  const xMax = Math.min(terrain.width - 1, point.hx + range);
  for (let hy = yMin; hy <= yMax; hy++) {
    for (let hx = xMin; hx <= xMax; hx++) {
      if (hexDistance({ hx, hy }, point) > range) continue;
      authored.forEachAt(terrain.nodeAt(hx, hy), collect);
    }
  }
  if (indexes.length > 1) indexes.sort((a, b) => a - b);
  const found = indexes.map((i) => placements.at(i));
  for (const placement of landscapeEditState(world).added) {
    if (
      hexDistance(placement, point) <= range &&
      standing(placement.id, placement.resourceBacked === true, removed, resources)
    ) {
      found.push(placement);
    }
  }
  return found;
}

/** Whether a standing placement is anchored on node `(hx, hy)`: {@link landscapesWithin} at range 0
 *  finding any, without building its list. */
export function landscapeStandsAt(world: World, terrain: TerrainGraph, hx: number, hy: number): boolean {
  const removed = removedIds(world);
  if (
    terrain.inBounds(hx, hy) &&
    authoredLandscapes(terrain).standsAt(terrain.nodeAt(hx, hy), world, removed)
  )
    return true;
  const added = landscapeEditState(world).added;
  for (let i = 0; i < added.length; i++) {
    const placement = added[i];
    if (placement === undefined || placement.hx !== hx || placement.hy !== hy) continue;
    if (removed.has(placement.id)) continue;
    if (placement.resourceBacked !== true || landscapeResources(world).has(placement.id)) return true;
  }
  return false;
}

interface AttachNodes {
  readonly revision: number;
  readonly resources: number;
  readonly nodes: ReadonlySet<NodeId>;
}
const attachNodeSets = new WeakMap<World, AttachNodes>();

/** The points the standing placements hold through their attach areas, rebuilt after an edit from the
 *  few placements whose type has one. */
export function landscapeAttachNodes(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const state = landscapeEditState(world);
  const resources = world.componentGeneration(LandscapeResource);
  const held = attachNodeSets.get(world);
  if (held?.revision === state.topologyRevision && held.resources === resources) return held.nodes;
  const authored = authoredLandscapes(terrain);
  const removed = removedIds(world);
  const nodes = new Set<NodeId>();
  const hold = (id: number, typeId: number, hx: number, hy: number, resourceBacked: boolean): void => {
    const cells = authored.types.get(typeId)?.attach;
    if (cells === undefined || !standing(id, resourceBacked, removed, () => landscapeResources(world)))
      return;
    for (const cell of cells) {
      const x = hx + footprintCellDx(hy, cell);
      const y = hy + cell.dy;
      if (terrain.inBounds(x, y)) nodes.add(terrain.nodeAt(x, y));
    }
  };
  const placements = authored.placements;
  for (const i of authored.attaching) {
    hold(
      placements.id(i),
      placements.typeId(i),
      placements.hx(i),
      placements.hy(i),
      placements.resourceBacked(i),
    );
  }
  for (const p of state.added) hold(p.id, p.typeId, p.hx, p.hy, p.resourceBacked === true);
  attachNodeSets.set(world, { revision: state.topologyRevision, resources, nodes });
  return nodes;
}

export interface LandscapeBlockChange {
  readonly node: NodeId;
  readonly channel: 'walk' | 'build';
  /** True when the cell became blocked, false when its last placement went. */
  readonly entered: boolean;
}

export interface LandscapeBlocks {
  readonly terrain: TerrainGraph;
  /** Live: every view of one world shares a set per channel, so a held view reads the current cells. */
  readonly walk: ReadonlySet<NodeId>;
  readonly build: ReadonlySet<NodeId>;
  /** The placements walk-blocking each node, row-major and live like {@link walk}: positive exactly on
   *  its cells, for the dynamic overlay's array read. */
  readonly walkCounts: Uint16Array;
  /** The cells that entered or left the sets since the previous view. */
  readonly changes: readonly LandscapeBlockChange[];
  /** The view minted after this one, so a holder replays every change since rather than re-reading
   *  the layer. Only the last {@link RETAINED_VIEWS} stay linked: a holder whose chain no longer
   *  reaches the current view re-reads. */
  next?: LandscapeBlocks;
}

/** Views kept linked behind the current one; a placement grid left unconsulted for longer re-reads
 *  the layer once rather than growing the chain for the rest of the session. */
export const RETAINED_VIEWS = 256;

/**
 * The counted cells behind {@link landscapeBlocks}, kept in step with the edit state one placement at
 * a time. Two placements may share a cell, so a cell stays blocked until the last one holding it goes.
 */
interface BlockCounts {
  readonly terrain: TerrainGraph;
  /** Placements per node; they overlap a few deep, far below the Uint16 range. */
  readonly walk: Uint16Array;
  readonly build: Uint16Array;
  readonly walkCells: Set<NodeId>;
  readonly buildCells: Set<NodeId>;
  /** The authored ids already withdrawn, and the script placements already stamped. */
  readonly withdrawn: Set<number>;
  readonly stamped: Map<number, ScriptLandscapePlacement>;
  /** The edit revision the counts describe, and the view minted for it. */
  revision: number;
  view: LandscapeBlocks;
  /** The linked views behind the current one, oldest first. */
  readonly retained: LandscapeBlocks[];
}
const blockCounts = new WeakMap<World, BlockCounts>();

function countPlacement(
  counts: BlockCounts,
  types: ReadonlyMap<number, ScriptLandscapeType>,
  typeId: number,
  anchorHx: number,
  anchorHy: number,
  level: number,
  delta: 1 | -1,
  changes: LandscapeBlockChange[] | null,
): void {
  const type = types.get(typeId);
  if (type === undefined) return;
  const terrain = counts.terrain;
  const blocks = placementBlockCells(type, level);
  for (const [channel, cells, held, members] of [
    ['walk', blocks.walk, counts.walk, counts.walkCells],
    ['build', blocks.build, counts.build, counts.buildCells],
  ] as const) {
    for (const cell of cells) {
      const hx = anchorHx + footprintCellDx(anchorHy, cell);
      const hy = anchorHy + cell.dy;
      if (!terrain.inBounds(hx, hy)) continue;
      const node = terrain.nodeAt(hx, hy);
      const next = (held[node] ?? 0) + delta;
      held[node] = next;
      const entered = next === 1 && delta === 1;
      const left = next === 0;
      if (!entered && !left) continue;
      if (entered) members.add(node);
      else members.delete(node);
      changes?.push({ node, channel, entered });
    }
  }
}

/** Count a script's placement. Resources maintain their own changing footprints through the gathering
 *  lifecycle, so a resource-backed placement counts nothing here. */
function countAdded(
  counts: BlockCounts,
  types: ReadonlyMap<number, ScriptLandscapeType>,
  p: ScriptLandscapePlacement,
  delta: 1 | -1,
  changes: LandscapeBlockChange[] | null,
): void {
  if (p.resourceBacked !== true) countPlacement(counts, types, p.typeId, p.hx, p.hy, p.level, delta, changes);
}

/** {@link countAdded} for the authored placement at file position `i`. */
function countAuthored(
  counts: BlockCounts,
  authored: AuthoredLandscapes,
  i: number,
  delta: 1 | -1,
  changes: LandscapeBlockChange[] | null,
): void {
  const p = authored.placements;
  if (p.resourceBacked(i)) return;
  countPlacement(counts, authored.types, p.typeId(i), p.hx(i), p.hy(i), p.level(i), delta, changes);
}

function freshCounts(world: World, terrain: TerrainGraph): BlockCounts {
  const walkCells = new Set<NodeId>();
  const buildCells = new Set<NodeId>();
  const walk = new Uint16Array(terrain.nodeCount);
  const counts: BlockCounts = {
    terrain,
    walk,
    build: new Uint16Array(terrain.nodeCount),
    walkCells,
    buildCells,
    withdrawn: new Set(),
    stamped: new Map(),
    revision: -1,
    view: { terrain, walk: walkCells, build: buildCells, walkCounts: walk, changes: [] },
    retained: [],
  };
  const authored = authoredLandscapes(terrain);
  for (let i = 0; i < authored.placements.length; i++) countAuthored(counts, authored, i, 1, null);
  blockCounts.set(world, counts);
  world.registerCacheVerifier('landscapeBlocks', () => verifyBlockCounts(world, terrain));
  return counts;
}

/** The sets read straight from the map and the edit state, the way a cold cache would build them. */
function deriveBlockCells(world: World, terrain: TerrainGraph): { walk: Set<NodeId>; build: Set<NodeId> } {
  const state = landscapeEditState(world);
  const removed = new Set(state.removed);
  const authored = authoredLandscapes(terrain);
  const walk = new Set<NodeId>();
  const build = new Set<NodeId>();
  const stamp = (
    id: number,
    typeId: number,
    x: number,
    y: number,
    level: number,
    resourceBacked: boolean,
  ) => {
    if (resourceBacked || removed.has(id)) return;
    const type = authored.types.get(typeId);
    const blocks = type === undefined ? undefined : placementBlockCells(type, level);
    for (const [cells, target] of [
      [blocks?.walk ?? [], walk],
      [blocks?.build ?? [], build],
    ] as const) {
      for (const cell of cells) {
        const hx = x + footprintCellDx(y, cell);
        const hy = y + cell.dy;
        if (terrain.inBounds(hx, hy)) target.add(terrain.nodeAt(hx, hy));
      }
    }
  };
  const p = authored.placements;
  for (let i = 0; i < p.length; i++)
    stamp(p.id(i), p.typeId(i), p.hx(i), p.hy(i), p.level(i), p.resourceBacked(i));
  for (const a of state.added) stamp(a.id, a.typeId, a.hx, a.hy, a.level, a.resourceBacked === true);
  return { walk, build };
}

/** The {@link blockCounts} coherence verifier (`verifyCaches`): while the counts claim the live
 *  revision, a cold derivation must agree cell for cell. */
function verifyBlockCounts(world: World, terrain: TerrainGraph): string[] {
  const counts = blockCounts.get(world);
  if (counts === undefined || counts.terrain !== terrain) return [];
  if (counts.revision !== landscapeEditState(world).topologyRevision) return []; // a pending catch-up
  const fresh = deriveBlockCells(world, terrain);
  const findings: string[] = [];
  for (const [channel, held, derived, perNode] of [
    ['walk', counts.walkCells, fresh.walk, counts.walk],
    ['build', counts.buildCells, fresh.build, counts.build],
  ] as const) {
    if (!sameCells(held, derived)) {
      findings.push(
        `landscapeBlocks ${channel} holds ${held.size} cells but re-derived ${derived.size} - stale landscape layer`,
      );
    } else if (!countsMatchCells(perNode, held)) {
      findings.push(`landscapeBlocks ${channel} counts disagree with its cells - a count missed a placement`);
    }
  }
  return findings;
}

/** Apply what the edit state holds beyond the counts: the ids removed and the placements added or
 *  taken away since. An id removed stays removed and a script placement keeps its id, so each edit is
 *  visited once. */
function catchUpCounts(world: World, counts: BlockCounts): void {
  const state = landscapeEditState(world);
  const authored = authoredLandscapes(counts.terrain);
  const changes: LandscapeBlockChange[] = [];
  for (const id of state.removed) {
    if (counts.withdrawn.has(id)) continue;
    counts.withdrawn.add(id);
    const index = authored.indexOf(id);
    if (index !== ABSENT) countAuthored(counts, authored, index, -1, changes);
  }
  const added = new Set<number>();
  for (const placement of state.added) {
    added.add(placement.id);
    if (counts.stamped.has(placement.id)) continue;
    counts.stamped.set(placement.id, placement);
    countAdded(counts, authored.types, placement, 1, changes);
  }
  for (const [id, placement] of counts.stamped) {
    if (added.has(id)) continue;
    counts.stamped.delete(id);
    countAdded(counts, authored.types, placement, -1, changes);
  }
  counts.revision = state.topologyRevision;
  const view: LandscapeBlocks = {
    terrain: counts.terrain,
    walk: counts.walkCells,
    build: counts.buildCells,
    walkCounts: counts.walk,
    changes,
  };
  counts.view.next = view;
  counts.retained.push(counts.view);
  if (counts.retained.length > RETAINED_VIEWS) {
    const dropped = counts.retained.shift();
    if (dropped !== undefined) delete dropped.next;
  }
  counts.view = view;
}

/** The nodes the standing landscapes block for walking and building: a new view per script topology
 *  edit over one world's live sets, each view naming the cells it changed. */
export function landscapeBlocks(world: World, terrain: TerrainGraph): LandscapeBlocks {
  const held = blockCounts.get(world);
  const counts = held?.terrain === terrain ? held : freshCounts(world, terrain);
  if (counts.revision !== landscapeEditState(world).topologyRevision) catchUpCounts(world, counts);
  return counts.view;
}

export interface LandscapeEditView {
  readonly revision: number;
  /** Authored ids no longer standing, ascending: removed by a script or reaped as a resource. */
  readonly removed: readonly number[];
  readonly added: readonly ScriptLandscapePlacement[];
  /** The vertex colour palette index per map cell, row-major over {@link tintColumns}: the script's
   *  write, else the map author's; a cell neither tinted holds 0, the neutral entry. */
  readonly tints: Uint8Array;
  readonly tintColumns: number;
}

export function landscapeEdits(world: World, terrain: TerrainGraph | undefined): LandscapeEditView {
  const state = landscapeEditState(world);
  if (terrain === undefined)
    return {
      revision: landscapeRevision(world),
      removed: [],
      added: [],
      tints: new Uint8Array(0),
      tintColumns: 0,
    };
  const resources = landscapeResources(world);
  const removed = new Set(state.removed);
  const authored = authoredLandscapes(terrain);
  for (const i of authored.resourceBacked) {
    const id = authored.placements.id(i);
    if (!resources.has(id)) removed.add(id);
  }
  const tints = new Uint8Array(terrain.cellColumns * terrain.cellRows);
  terrain.copyAuthoredTints(tints);
  for (const [cell, value] of state.tints) tints[cell] = value;
  return {
    revision: landscapeRevision(world),
    removed: [...removed].sort((a, b) => a - b),
    added: state.added.filter((p) => p.resourceBacked !== true || resources.has(p.id)).map((p) => ({ ...p })),
    tints,
    tintColumns: terrain.cellColumns,
  };
}
