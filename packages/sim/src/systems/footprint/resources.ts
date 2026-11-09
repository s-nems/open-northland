import type { ContentSet } from '@open-northland/data';
import {
  Felling,
  LandscapeResource,
  MineDeposit,
  Position,
  Resource,
  ResourceFootprint,
  type ResourceFootprintData,
  type ResourceFootprintRecordKey,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { bindWorldContent } from '../../core/world-content.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { ResourceSpec } from '../../nav/terrain/index.js';
import {
  refreshResourceBlockedCacheEntry,
  removeResourceBlockedCacheEntry,
  syncResourceBlockedCacheGeneration,
} from './resource-blocked-cache.js';

// Resource footprints are the `[GfxLandscape]` walk, build and work areas a standing resource occupies.

/** The key of a good's resource node footprint: its harvest-stage record `gfxIndex`, or without one the
 *  stage's first record, at `level` or full-grown. */
export function resourceFootprintForGood(
  content: ContentSet,
  goodType: number,
  gfxIndex?: number,
  level?: number,
): ResourceFootprintRecordKey | null {
  const pipeline = contentIndex(content).gatheringPipelinesByGood.get(goodType);
  const stage = pipeline?.harvest ?? pipeline?.pickup;
  if (stage === undefined) return null;
  const byIndex = contentIndex(content).landscapeGfxByIndex;
  const keyed = (gfx: number): ResourceFootprintRecordKey => (level === undefined ? { gfx } : { gfx, level });
  if (gfxIndex !== undefined) {
    if (!stage.gfxIndices.includes(gfxIndex) || !byIndex.has(gfxIndex)) return null;
    return keyed(gfxIndex);
  }
  for (const index of stage.gfxIndices) if (byIndex.has(index)) return keyed(index);
  return null;
}

/** Stamp a resource node with `footprint`, keeping the incremental blocked-cell cache coherent. A keyed
 *  footprint resolves against `content`, which binds the world when nothing has yet. */
export function stampResourceFootprintData(
  world: World,
  resource: Entity,
  footprint: ResourceFootprintData,
  content?: ContentSet,
): void {
  if (content !== undefined) bindWorldContent(world, content);
  removeResourceBlockedCacheEntry(world, resource);
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
  stampResourceFootprintData(world, resource, footprint, content);
  return true;
}

/** A fresh key of the anchor-only stand-in footprint. */
export function anchorOnlyFootprint(): ResourceFootprintData {
  return { standIn: 'anchor' };
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
  removeResourceBlockedCacheEntry(world, resource);
  world.remove(resource, ResourceFootprint);
  syncResourceBlockedCacheGeneration(world);
}

/** A resource node to place: the caller-resolved {@link ResourceSpec} at a half-cell lattice node
 *  (like every sim command, mapped to a visual-tile Position), owned by a landscape placement or not. */
export interface ResourceNodeSpec extends ResourceSpec {
  readonly landscapeId?: number;
  /** The authored valency (`lmlv`) its record's block rows stamp up to; absent, the full-grown cells. */
  readonly blockLevel?: number;
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
  // A map placement blocks as its own record at its own level; without one, as the good's first record.
  const own = resourceFootprintForGood(content, spec.good, spec.gfxIndex, spec.blockLevel);
  if (own === null) stampResourceFootprint(world, content, e, spec.good);
  else stampResourceFootprintData(world, e, own, content);
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
