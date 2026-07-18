import { Position, ResourceFootprint } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { sameCells, translatedCells } from './geometry.js';

// The incrementally-maintained per-world cache of cells standing resource nodes make unwalkable, plus
// its coherence verifier. Maintained by the resource stamp/unstamp paths (see ./resources.ts) so
// clearing a forest mutates just the affected node's cells instead of rescanning every resource on the
// next route; a direct ResourceFootprint store mutation still falls back to a full rebuild.

interface ResourceBlockedCache {
  generation: number;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  readonly counts: Map<NodeId, number>;
  readonly entries: Map<Entity, readonly NodeId[]>;
}

const resourceBlockedCache = new WeakMap<World, ResourceBlockedCache>();

function resourceBlockedCellsFor(world: World, terrain: TerrainGraph, resource: Entity): NodeId[] | null {
  const footprint = world.tryGet(resource, ResourceFootprint);
  const p = world.tryGet(resource, Position);
  if (footprint === undefined || p === undefined) return null;
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
    const count = (cache.counts.get(cell) ?? 0) + 1;
    cache.counts.set(cell, count);
    cache.cells.add(cell);
  }
}

function removeResourceBlockedCacheEntryFrom(cache: ResourceBlockedCache, resource: Entity): void {
  const cells = cache.entries.get(resource);
  if (cells === undefined) return;
  cache.entries.delete(resource);
  for (const cell of cells) {
    const count = (cache.counts.get(cell) ?? 0) - 1;
    if (count > 0) {
      cache.counts.set(cell, count);
    } else {
      cache.counts.delete(cell);
      cache.cells.delete(cell);
    }
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
    counts: new Map<NodeId, number>(),
    entries: new Map<Entity, readonly NodeId[]>(),
  };
  for (const e of world.query(ResourceFootprint, Position)) {
    const cells = resourceBlockedCellsFor(world, terrain, e);
    if (cells !== null) addResourceBlockedCacheEntry(cache, e, cells);
  }
  return cache;
}

function deriveResourceBlockedCells(world: World, terrain: TerrainGraph): Set<NodeId> {
  return deriveResourceBlockedCache(world, terrain).cells;
}

function verifyResourceBlockedCache(world: World, terrain: TerrainGraph): string[] {
  const cached = resourceBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain) return [];
  if (cached.generation !== world.componentGeneration(ResourceFootprint)) return [];
  const fresh = deriveResourceBlockedCells(world, terrain);
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `resourceBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} — stale resource footprint overlay`,
  ];
}

/**
 * The cells standing resource nodes make unwalkable. Built once per world/terrain and maintained by
 * `stampResourceFootprint` / `unstampResourceFootprint` for the resource spawn/removal paths, so clearing
 * a forest mutates just the affected node's cells instead of scanning every resource on the next route.
 * A direct ResourceFootprint store mutation still falls back to a full rebuild for correctness.
 */
export function resourceBlockedCells(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const generation = world.componentGeneration(ResourceFootprint);
  const cached = resourceBlockedCache.get(world);
  if (cached !== undefined && cached.terrain === terrain && cached.generation === generation) {
    return cached.cells;
  }

  const cache = deriveResourceBlockedCache(world, terrain);
  resourceBlockedCache.set(world, cache);
  world.registerCacheVerifier('resourceBlockedCells', () => verifyResourceBlockedCache(world, terrain));
  return cache.cells;
}
