import { footprintCellDx } from '@open-northland/data';
import { LandscapeResource, landscapeEditState, landscapeRevision } from '../../components/landscape.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../nav/halfcell.js';
import type {
  NodeId,
  ScriptLandscapePlacement,
  ScriptLandscapeType,
  TerrainGraph,
} from '../../nav/terrain/index.js';

/**
 * The live landscape as a script sees it: the map's authored placements minus the ones a script removed
 * or a resource depleted, plus the script's own additions. A read costs the placements it touches, not
 * the map: a script flipping one object every pass (a pressure plate) is the common case.
 */

/** The map's authored placements, indexed once per terrain: the input is immutable. */
interface AuthoredLandscapes {
  readonly types: ReadonlyMap<number, ScriptLandscapeType>;
  readonly byId: ReadonlyMap<number, ScriptLandscapePlacement>;
  /** Placements by anchor node, each bucket in file order. */
  readonly atNode: ReadonlyMap<NodeId, readonly ScriptLandscapePlacement[]>;
  /** File position by id: an area match is reported in file order, whatever node order found it. */
  readonly order: ReadonlyMap<number, number>;
  readonly resourceBacked: readonly ScriptLandscapePlacement[];
  /** One past the highest authored id, where the script's own ids start. */
  readonly nextId: number;
}

const authoredIndexes = new WeakMap<TerrainGraph, AuthoredLandscapes>();

export function authoredLandscapes(terrain: TerrainGraph): AuthoredLandscapes {
  const held = authoredIndexes.get(terrain);
  if (held !== undefined) return held;
  const placements = terrain.landscapes?.placements ?? [];
  const byId = new Map<number, ScriptLandscapePlacement>();
  const atNode = new Map<NodeId, ScriptLandscapePlacement[]>();
  const order = new Map<number, number>();
  const resourceBacked: ScriptLandscapePlacement[] = [];
  let nextId = 0;
  placements.forEach((placement, index) => {
    byId.set(placement.id, placement);
    order.set(placement.id, index);
    nextId = Math.max(nextId, placement.id + 1);
    if (placement.resourceBacked === true) resourceBacked.push(placement);
    if (!terrain.inBounds(placement.hx, placement.hy)) return;
    const node = terrain.nodeAt(placement.hx, placement.hy);
    const bucket = atNode.get(node);
    if (bucket === undefined) atNode.set(node, [placement]);
    else bucket.push(placement);
  });
  const built = {
    types: new Map(terrain.landscapes?.types.map((type) => [type.typeId, type])),
    byId,
    atNode,
    order,
    resourceBacked,
    nextId,
  };
  authoredIndexes.set(terrain, built);
  return built;
}

export function landscapeTypes(terrain: TerrainGraph): ReadonlyMap<number, ScriptLandscapeType> {
  return authoredLandscapes(terrain).types;
}

interface LiveResources {
  readonly generation: number;
  readonly byId: ReadonlyMap<number, readonly Entity[]>;
}
const liveResources = new WeakMap<World, LiveResources>();

/** The entities standing in for resource-backed placements, by placement id. Re-read when one is
 *  created or reaped, which only a script consumer pays for. */
export function landscapeResources(world: World): ReadonlyMap<number, readonly Entity[]> {
  const generation = world.componentGeneration(LandscapeResource);
  const held = liveResources.get(world);
  if (held?.generation === generation) return held.byId;
  const byId = new Map<number, Entity[]>();
  for (const entity of world.query(LandscapeResource)) {
    const id = world.get(entity, LandscapeResource).id;
    const held = byId.get(id);
    if (held === undefined) byId.set(id, [entity]);
    else held.push(entity);
  }
  liveResources.set(world, { generation, byId });
  return byId;
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
  world: World,
  placement: ScriptLandscapePlacement,
  removed: ReadonlySet<number>,
  resources: () => ReadonlyMap<number, readonly Entity[]>,
): boolean {
  if (removed.has(placement.id)) return false;
  return placement.resourceBacked !== true || resources().has(placement.id);
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
  const removed = removedIds(world);
  let resourceIndex: ReadonlyMap<number, readonly Entity[]> | undefined;
  const resources = (): ReadonlyMap<number, readonly Entity[]> => {
    resourceIndex ??= landscapeResources(world);
    return resourceIndex;
  };
  const found: ScriptLandscapePlacement[] = [];
  const yMin = Math.max(0, point.hy - range);
  const yMax = Math.min(terrain.height - 1, point.hy + range);
  const xMin = Math.max(0, point.hx - range);
  const xMax = Math.min(terrain.width - 1, point.hx + range);
  for (let hy = yMin; hy <= yMax; hy++) {
    for (let hx = xMin; hx <= xMax; hx++) {
      const bucket = authored.atNode.get(terrain.nodeAt(hx, hy));
      if (bucket === undefined || hexDistance({ hx, hy }, point) > range) continue;
      for (const placement of bucket) {
        if (standing(world, placement, removed, resources)) found.push(placement);
      }
    }
  }
  if (found.length > 1) {
    found.sort((a, b) => (authored.order.get(a.id) ?? 0) - (authored.order.get(b.id) ?? 0));
  }
  for (const placement of landscapeEditState(world).added) {
    if (hexDistance(placement, point) <= range && standing(world, placement, removed, resources)) {
      found.push(placement);
    }
  }
  return found;
}

export interface LandscapeBlocks {
  readonly revision: number;
  readonly terrain: TerrainGraph;
  readonly walk: ReadonlySet<NodeId>;
  readonly build: ReadonlySet<NodeId>;
}

/**
 * The counted cells behind {@link landscapeBlocks}, kept in step with the edit state one placement at
 * a time. Two placements may share a cell, so a cell stays blocked until the last one holding it goes.
 */
interface BlockCounts {
  readonly terrain: TerrainGraph;
  readonly walk: Map<NodeId, number>;
  readonly build: Map<NodeId, number>;
  /** The authored ids already withdrawn, and the script placements already stamped. */
  readonly withdrawn: Set<number>;
  readonly stamped: Map<number, ScriptLandscapePlacement>;
  /** The edit revision the counts describe, and the view minted for it. */
  revision: number;
  view: LandscapeBlocks;
}
const blockCounts = new WeakMap<World, BlockCounts>();

function addCount(counts: Map<NodeId, number>, node: NodeId, delta: number): void {
  const next = (counts.get(node) ?? 0) + delta;
  if (next > 0) counts.set(node, next);
  else counts.delete(node);
}

function countPlacement(
  counts: BlockCounts,
  types: ReadonlyMap<number, ScriptLandscapeType>,
  placement: ScriptLandscapePlacement,
  delta: number,
): void {
  const type = types.get(placement.typeId);
  if (type === undefined) return;
  const terrain = counts.terrain;
  for (const [cells, target] of [
    [type.walk, counts.walk],
    [type.build, counts.build],
  ] as const) {
    for (const cell of cells) {
      const hx = placement.hx + footprintCellDx(placement.hy, cell);
      const hy = placement.hy + cell.dy;
      if (terrain.inBounds(hx, hy)) addCount(target, terrain.nodeAt(hx, hy), delta);
    }
  }
}

/** Resources maintain their own changing footprints through the gathering lifecycle, so a
 *  resource-backed placement counts nothing here. */
function countsBlocks(placement: ScriptLandscapePlacement): boolean {
  return placement.resourceBacked !== true;
}

function freshCounts(world: World, terrain: TerrainGraph): BlockCounts {
  const counts: BlockCounts = {
    terrain,
    walk: new Map(),
    build: new Map(),
    withdrawn: new Set(),
    stamped: new Map(),
    revision: -1,
    view: { revision: -1, terrain, walk: new Set(), build: new Set() },
  };
  const authored = authoredLandscapes(terrain);
  for (const placement of terrain.landscapes?.placements ?? []) {
    if (countsBlocks(placement)) countPlacement(counts, authored.types, placement, 1);
  }
  blockCounts.set(world, counts);
  return counts;
}

/** Apply what the edit state holds beyond the counts: the ids removed and the placements added or
 *  taken away since. An id removed stays removed and a script placement keeps its id, so each edit is
 *  visited once. */
function catchUpCounts(world: World, counts: BlockCounts): void {
  const state = landscapeEditState(world);
  const authored = authoredLandscapes(counts.terrain);
  for (const id of state.removed) {
    if (counts.withdrawn.has(id)) continue;
    counts.withdrawn.add(id);
    const placement = authored.byId.get(id);
    if (placement !== undefined && countsBlocks(placement)) countPlacement(counts, authored.types, placement, -1);
  }
  const added = new Set<number>();
  for (const placement of state.added) {
    added.add(placement.id);
    if (counts.stamped.has(placement.id)) continue;
    counts.stamped.set(placement.id, placement);
    if (countsBlocks(placement)) countPlacement(counts, authored.types, placement, 1);
  }
  for (const [id, placement] of counts.stamped) {
    if (added.has(id)) continue;
    counts.stamped.delete(id);
    if (countsBlocks(placement)) countPlacement(counts, authored.types, placement, -1);
  }
  counts.revision = state.topologyRevision;
  // A fresh set per revision: the placement grid withdraws the view it stamped before stamping the
  // next, so a view must keep the cells it was minted with.
  counts.view = {
    revision: state.topologyRevision,
    terrain: counts.terrain,
    walk: new Set(counts.walk.keys()),
    build: new Set(counts.build.keys()),
  };
}

/** The nodes the standing landscapes block for walking and building. A new object per script
 *  topology edit, holding only that edit's difference over the previous one. */
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
  readonly tints: readonly { readonly hx: number; readonly hy: number; readonly value: number }[];
}

export function landscapeEdits(world: World, terrain: TerrainGraph | undefined): LandscapeEditView {
  const state = landscapeEditState(world);
  if (terrain === undefined) return { revision: landscapeRevision(world), removed: [], added: [], tints: [] };
  const resources = landscapeResources(world);
  const removed = new Set(state.removed);
  for (const placement of authoredLandscapes(terrain).resourceBacked) {
    if (!resources.has(placement.id)) removed.add(placement.id);
  }
  return {
    revision: landscapeRevision(world),
    removed: [...removed].sort((a, b) => a - b),
    added: state.added
      .filter((p) => p.resourceBacked !== true || resources.has(p.id))
      .map((p) => ({ ...p })),
    tints: [...state.tints].map(([node, value]) => ({
      hx: terrain.xOf(node),
      hy: terrain.yOf(node),
      value,
    })),
  };
}
