import { type ContentSet, fullStateBlockAreaCells, type LandscapeGfx } from '@open-northland/data';
import {
  Felling,
  LandscapeResource,
  MineDeposit,
  Position,
  Resource,
  ResourceFootprint,
  type ResourceFootprintData,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { ResourceSpec } from '../../nav/terrain/index.js';
import {
  refreshResourceBlockedCacheEntry,
  removeResourceBlockedCacheEntry,
  syncResourceBlockedCacheGeneration,
} from './resource-blocked-cache.js';

// Resource footprints are the `[GfxLandscape]` walk, build and work areas a standing resource occupies.

/**
 * Convert one decoded `[GfxLandscape]` record into the sim's resource-footprint component payload. The
 * source stores repeated rows per valency and growth state, and collision is static until the node is
 * removed, so `fullStateBlockAreaCells` (the fresh, full object's cells) is the conservative consumer.
 */
export function resourceFootprintFromLandscapeGfx(record: LandscapeGfx): ResourceFootprintData {
  return {
    walk: fullStateBlockAreaCells(record.walkBlockAreas),
    build: fullStateBlockAreaCells(record.buildBlockAreas),
    work: fullStateBlockAreaCells(record.workAreas),
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

/** Stamp a resource node with a caller-declared footprint, keeping the incremental blocked-cell cache
 *  coherent. For a node whose cells come from a landscape record, use {@link stampResourceFootprint}. */
export function stampResourceFootprintData(
  world: World,
  resource: Entity,
  footprint: ResourceFootprintData,
): void {
  world.add(resource, ResourceFootprint, footprint);
  refreshResourceBlockedCacheEntry(world, resource);
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
  stampResourceFootprintData(world, resource, footprint);
  return true;
}

/**
 * The stand-in footprint for a node whose good resolves no landscape record: the synthetic fixtures, the
 * sandbox catalog, and real goods with no `[GfxLandscape]` stage such as wool. Non-blocking, and the
 * `work` entry naming the node's own anchor is an invention, since a real record's work area is the
 * neighbour ring.
 */
export function anchorOnlyFootprint(): ResourceFootprintData {
  return { walk: [], build: [], work: [{ dx: 0, dy: 0 }] };
}

/** Stamp a node with its good's content-derived footprint, falling back to {@link anchorOnlyFootprint}
 *  when the content ships no record. */
export function stampResourceFootprintOrFallback(
  world: World,
  content: ContentSet,
  resource: Entity,
  goodType: number,
): void {
  if (stampResourceFootprint(world, content, resource, goodType)) return;
  stampResourceFootprintData(world, resource, anchorOnlyFootprint());
}

/** Remove a resource footprint through the incremental blocked-cell cache before destroying a node. */
export function unstampResourceFootprint(world: World, resource: Entity): void {
  if (!world.has(resource, ResourceFootprint)) return;
  world.remove(resource, ResourceFootprint);
  removeResourceBlockedCacheEntry(world, resource);
  syncResourceBlockedCacheGeneration(world);
}

/** A resource node to place: the caller-resolved {@link ResourceSpec} at a half-cell lattice node
 *  (like every sim command, mapped to a visual-tile Position), owned by a landscape placement or not. */
export interface ResourceNodeSpec extends ResourceSpec {
  readonly landscapeId?: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Assemble a standing resource node from a resolved {@link ResourceNodeSpec} - the one construction path,
 * so a hand-placed tree and a command-placed tree are byte-identical entities. Null without creating
 * anything when `good` has no resource footprint record; that is rejected before `create()` so the
 * rejection burns no entity id, which would otherwise make the id sequence depend on how many rejected
 * commands were issued.
 */
export function createResourceNode(world: World, content: ContentSet, spec: ResourceNodeSpec): Entity | null {
  // The stamp below re-resolves this same memoized record, so it cannot fail after the create.
  if (resourceFootprintForGood(content, spec.good) === null) return null;
  const e = world.create();
  if (spec.landscapeId !== undefined) world.add(e, LandscapeResource, { id: spec.landscapeId });
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Resource, {
    goodType: spec.good,
    remaining: spec.remaining,
    harvestAtomic: spec.harvestAtomic,
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  stampResourceFootprint(world, content, e, spec.good);
  if (spec.felling === true) world.add(e, Felling, { chops: 0 });
  if (spec.deposit !== undefined) {
    world.add(e, MineDeposit, {
      initial: spec.deposit.initial ?? spec.remaining,
      levels: spec.deposit.levels,
      strikes: 0,
    });
  }
  return e;
}
