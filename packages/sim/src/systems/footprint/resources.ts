import {
  type ContentSet,
  type LandscapeBlockArea,
  type LandscapeGfx,
  fullStateBlockAreaCells,
} from '@vinland/data';
import {
  Position,
  ResourceFootprint,
  type ResourceFootprintCell,
  type ResourceFootprintData,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import { translatedCells } from './geometry.js';

// RESOURCE footprints — the `[GfxLandscape]` walk/build/work areas a stamped resource occupies, and
// the incrementally-maintained per-world blocked-cell cache (with its coherence verifier). Opt-in
// via ResourceFootprint: a bare Resource keeps the legacy same-tile fixture behavior.

/** Collapse a `[GfxLandscape]` area table to the fresh/full object's cells — the shared
 *  `fullStateBlockAreaCells` reading (also the app's map-collision join), typed to the component cell. */
function footprintCellsForFullState(areas: readonly LandscapeBlockArea[]): ResourceFootprintCell[] {
  return fullStateBlockAreaCells(areas);
}

/**
 * Convert one decoded `[GfxLandscape]` record into the sim's resource-footprint component payload.
 * The source stores repeated rows per valency/growth state; collision for Step 5 is static until the
 * node is removed, so the full/fresh state is the correct conservative consumer.
 */
export function resourceFootprintFromLandscapeGfx(record: LandscapeGfx): ResourceFootprintData {
  return {
    walk: footprintCellsForFullState(record.walkBlockAreas),
    build: footprintCellsForFullState(record.buildBlockAreas),
    work: footprintCellsForFullState(record.workAreas),
    sourceGfxIndex: record.index,
  };
}

/** Resolve the representative harvest-stage landscape gfx record for a good's resource node. */
export function resourceFootprintForGood(
  content: ContentSet,
  goodType: number,
  gfxIndex?: number,
): ResourceFootprintData | null {
  const pipeline = contentIndex(content).gatheringPipelinesByGood.get(goodType);
  const stage = pipeline?.harvest ?? pipeline?.pickup;
  if (stage === undefined) return null;
  const byIndex = contentIndex(content).landscapeGfxByIndex;
  if (gfxIndex !== undefined) {
    if (!stage.gfxIndices.includes(gfxIndex)) return null;
    const record = byIndex.get(gfxIndex);
    return record === undefined ? null : resourceFootprintFromLandscapeGfx(record);
  }
  for (const index of stage.gfxIndices) {
    const record = byIndex.get(index);
    if (record !== undefined) return resourceFootprintFromLandscapeGfx(record);
  }
  return null;
}

/** Stamp a resource node with its content-derived footprint, returning false when no source record exists. */
export function stampResourceFootprint(
  world: World,
  content: ContentSet,
  resource: Entity,
  goodType: number,
  gfxIndex?: number,
): boolean {
  const footprint = resourceFootprintForGood(content, goodType, gfxIndex);
  if (footprint === null) return false;
  world.add(resource, ResourceFootprint, footprint);
  refreshResourceBlockedCacheEntry(world, resource);
  return true;
}

/** Remove a resource footprint through the incremental blocked-cell cache before destroying a node. */
export function unstampResourceFootprint(world: World, resource: Entity): void {
  if (!world.has(resource, ResourceFootprint)) return;
  world.remove(resource, ResourceFootprint);
  removeResourceBlockedCacheEntry(world, resource);
  syncResourceBlockedCacheGeneration(world);
}

interface ResourceBlockedCache {
  generation: number;
  readonly terrain: TerrainGraph;
  readonly cells: Set<CellId>;
  readonly counts: Map<CellId, number>;
  readonly entries: Map<Entity, readonly CellId[]>;
}

const resourceBlockedCache = new WeakMap<World, ResourceBlockedCache>();

function resourceBlockedCellsFor(world: World, terrain: TerrainGraph, resource: Entity): CellId[] | null {
  const footprint = world.tryGet(resource, ResourceFootprint);
  const p = world.tryGet(resource, Position);
  if (footprint === undefined || p === undefined) return null;
  const ax = fx.toInt(p.x);
  const ay = fx.toInt(p.y);
  return translatedCells(terrain, footprint.walk, ax, ay);
}

function addResourceBlockedCacheEntry(
  cache: ResourceBlockedCache,
  resource: Entity,
  cells: readonly CellId[],
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

function refreshResourceBlockedCacheEntry(world: World, resource: Entity): void {
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

function removeResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  removeResourceBlockedCacheEntryFrom(cache, resource);
}

function syncResourceBlockedCacheGeneration(world: World): void {
  const cache = resourceBlockedCache.get(world);
  if (cache !== undefined) cache.generation = world.componentGeneration(ResourceFootprint);
}

function deriveResourceBlockedCache(world: World, terrain: TerrainGraph): ResourceBlockedCache {
  const cache: ResourceBlockedCache = {
    generation: world.componentGeneration(ResourceFootprint),
    terrain,
    cells: new Set<CellId>(),
    counts: new Map<CellId, number>(),
    entries: new Map<Entity, readonly CellId[]>(),
  };
  for (const e of world.query(ResourceFootprint, Position)) {
    const cells = resourceBlockedCellsFor(world, terrain, e);
    if (cells !== null) addResourceBlockedCacheEntry(cache, e, cells);
  }
  return cache;
}

function deriveResourceBlockedCells(world: World, terrain: TerrainGraph): Set<CellId> {
  return deriveResourceBlockedCache(world, terrain).cells;
}

function sameCells(a: ReadonlySet<CellId>, b: ReadonlySet<CellId>): boolean {
  if (a.size !== b.size) return false;
  for (const cell of a) if (!b.has(cell)) return false;
  return true;
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
export function resourceBlockedCells(world: World, terrain: TerrainGraph): ReadonlySet<CellId> {
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
