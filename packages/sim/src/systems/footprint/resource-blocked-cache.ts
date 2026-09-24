import { Position, ResourceFootprint } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { countsMatchCells, sameCells, translatedCells } from './geometry.js';

// The incrementally-maintained per-world cache of cells standing resource nodes make unwalkable, plus its
// coherence verifier - the resource twin of ./building-blocked-cache.ts.

interface ResourceBlockedCache extends CountedCells {
  generation: number;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  /** The resources covering each node. Overlapping footprints stack a handful deep, far below the
   *  Uint16 range. */
  readonly counts: Uint16Array;
  readonly entries: Map<Entity, readonly NodeId[]>;
}

const resourceBlockedCache = new WeakMap<World, ResourceBlockedCache>();

function resourceBlockedCellsFor(world: World, terrain: TerrainGraph, resource: Entity): NodeId[] | null {
  const footprint = world.get(resource, ResourceFootprint);
  const p = world.tryGet(resource, Position);
  if (p === undefined) return null;
  const n = nodeOfPosition(p.x, p.y);
  return translatedCells(terrain, footprint.walk, n.hx, n.hy);
}

function addResourceBlockedCacheEntry(
  cache: ResourceBlockedCache,
  resource: Entity,
  cells: readonly NodeId[],
): void {
  removeResourceBlockedCacheEntryFrom(cache, resource);
  cache.entries.set(resource, cells);
  for (const cell of cells) {
    cache.counts[cell] = (cache.counts[cell] ?? 0) + 1;
    cache.cells.add(cell);
  }
}

function removeResourceBlockedCacheEntryFrom(cache: ResourceBlockedCache, resource: Entity): void {
  const cells = cache.entries.get(resource);
  if (cells === undefined) return;
  cache.entries.delete(resource);
  for (const cell of cells) {
    const count = (cache.counts[cell] ?? 0) - 1;
    cache.counts[cell] = count;
    if (count === 0) cache.cells.delete(cell);
  }
}

export function refreshResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  const cells = resourceBlockedCellsFor(world, cache.terrain, resource);
  if (cells === null) {
    removeResourceBlockedCacheEntryFrom(cache, resource);
  } else {
    addResourceBlockedCacheEntry(cache, resource, cells);
  }
  syncResourceBlockedCacheGeneration(world);
}

export function removeResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  removeResourceBlockedCacheEntryFrom(cache, resource);
}

export function syncResourceBlockedCacheGeneration(world: World): void {
  const cache = resourceBlockedCache.get(world);
  if (cache !== undefined) cache.generation = world.componentGeneration(ResourceFootprint);
}

function deriveResourceBlockedCache(world: World, terrain: TerrainGraph): ResourceBlockedCache {
  const cache: ResourceBlockedCache = {
    generation: world.componentGeneration(ResourceFootprint),
    terrain,
    cells: new Set<NodeId>(),
    counts: new Uint16Array(terrain.nodeCount),
    entries: new Map<Entity, readonly NodeId[]>(),
  };
  for (const e of world.query(ResourceFootprint, Position)) {
    const cells = resourceBlockedCellsFor(world, terrain, e);
    if (cells !== null) addResourceBlockedCacheEntry(cache, e, cells);
  }
  return cache;
}

function verifyResourceBlockedCache(world: World, terrain: TerrainGraph): string[] {
  const cached = resourceBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain) return [];
  if (cached.generation !== world.componentGeneration(ResourceFootprint)) return [];
  const fresh = deriveResourceBlockedCache(world, terrain).cells;
  if (!sameCells(cached.cells, fresh)) {
    return [
      `resourceBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - stale resource footprint overlay`,
    ];
  }
  if (!countsMatchCells(cached.counts, cached.cells)) {
    return ['resourceBlockedCells counts disagree with its cells - a node count missed a stamp'];
  }
  return [];
}

/**
 * The cells standing resource nodes make unwalkable. Built once per world/terrain and maintained by
 * `stampResourceFootprint` / `unstampResourceFootprint`, so clearing a forest mutates just the affected
 * node's cells instead of scanning every resource on the next route. A direct ResourceFootprint store
 * mutation still falls back to a full rebuild.
 */
export function resourceBlockedCells(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  return resourceBlockedLayer(world, terrain).cells;
}

/** {@link resourceBlockedCells} with its live per-node counts, for the dynamic overlay. */
export function resourceBlockedLayer(world: World, terrain: TerrainGraph): CountedCells {
  const generation = world.componentGeneration(ResourceFootprint);
  const cached = resourceBlockedCache.get(world);
  if (cached !== undefined && cached.terrain === terrain && cached.generation === generation) {
    return cached;
  }

  const cache = deriveResourceBlockedCache(world, terrain);
  resourceBlockedCache.set(world, cache);
  world.registerCacheVerifier('resourceBlockedCells', () => verifyResourceBlockedCache(world, terrain));
  return cache;
}
