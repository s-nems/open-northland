import { type ContentSet, fullStateBlockAreaCells, type LandscapeGfx } from '@open-northland/data';
import {
  Felling,
  MineDeposit,
  Position,
  Resource,
  ResourceFootprint,
  type ResourceFootprintData,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import {
  refreshResourceBlockedCacheEntry,
  removeResourceBlockedCacheEntry,
  syncResourceBlockedCacheGeneration,
} from './resource-blocked-cache.js';

// Resource footprints are the `[GfxLandscape]` walk, build and work areas a stamped resource occupies.
// They are opt-in through ResourceFootprint: a bare Resource keeps the same-tile fixture behavior.

/**
 * Convert one decoded `[GfxLandscape]` record into the sim's resource-footprint component payload. The
 * source stores repeated rows per valency and growth state, and collision is static until the node is
 * removed, so `fullStateBlockAreaCells` (the fresh, full object's cells) is the conservative consumer.
 */
function resourceFootprintFromLandscapeGfx(record: LandscapeGfx): ResourceFootprintData {
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
 * sandbox catalog, and real goods with no `[GfxLandscape]` stage such as wool. It is non-blocking, and the
 * `work` entry naming the node's own anchor is an invention, since a real record's work area is the
 * neighbour ring. Declaring a footprint at all also moves the node from the placement rule's OBSTACLE
 * channel to RESOURCE_ANCHOR, which admits a building over the node but refuses a work flag on it.
 */
export const ANCHOR_ONLY_FOOTPRINT: ResourceFootprintData = Object.freeze({
  walk: [],
  build: [],
  work: [{ dx: 0, dy: 0 }],
});

/** Stamp a node with its good's content-derived footprint, falling back to {@link ANCHOR_ONLY_FOOTPRINT}
 *  when the content ships no record. */
export function stampResourceFootprintOrFallback(
  world: World,
  content: ContentSet,
  resource: Entity,
  goodType: number,
): void {
  if (stampResourceFootprint(world, content, resource, goodType)) return;
  stampResourceFootprintData(world, resource, ANCHOR_ONLY_FOOTPRINT);
}

/** Remove a resource footprint through the incremental blocked-cell cache before destroying a node. */
export function unstampResourceFootprint(world: World, resource: Entity): void {
  if (!world.has(resource, ResourceFootprint)) return;
  world.remove(resource, ResourceFootprint);
  removeResourceBlockedCacheEntry(world, resource);
  syncResourceBlockedCacheGeneration(world);
}

/**
 * The caller-resolved shape of a resource node to place: its good, half-cell node, starting yield and
 * harvest atomic, plus which harvest lifecycle it runs (a felled tree, a mined deposit, or neither). The
 * felling and deposit balance constants live in the app catalog, so the caller resolves them and hands the
 * sim a ready spec.
 */
export interface ResourceNodeSpec {
  readonly good: number;
  /** The node's half-cell lattice coords, like every sim command, mapped to a visual-tile Position. */
  readonly x: number;
  readonly y: number;
  readonly remaining: number;
  readonly harvestAtomic: number;
  /**
   * Opaque render-variant tag: the app's decoded-map species record index, stored verbatim and carried out
   * through the snapshot so the render draws the exact original object. The sim never interprets it, since
   * footprint and collision come from the good's own record in the sim's content set, whose numbering is
   * unrelated. Omitted for an admin or scene spawn, where the per-good representative draws.
   */
  readonly gfxIndex?: number;
  /** A felled node such as a tree: its chops-to-fell counter. Mutually exclusive with `deposit`. */
  readonly felling?: { readonly chopsLeft: number };
  /** A mined finite deposit: its level ladder and how many work cycles chip one unit off (an observed
   *  calibration in the app catalog; omitted means 1). `initial` is the deposit's full size, the ladder
   *  denominator, for a node placed already part-mined; omitted it is `remaining`. */
  readonly deposit?: {
    readonly levels: number;
    readonly strikesPerUnit?: number;
    readonly initial?: number;
  };
}

/**
 * Assemble a standing resource node from a resolved {@link ResourceNodeSpec}. Every placed node is built
 * here, so a hand-placed tree and a command-placed tree are byte-identical entities.
 *
 * Returns `null` without creating anything when `good` has no resource footprint record. The footprint is
 * resolved before `create()` so the rejection burns no entity id: a create-then-destroy would make the id
 * sequence depend on how many rejected commands were issued.
 */
export function createResourceNode(world: World, content: ContentSet, spec: ResourceNodeSpec): Entity | null {
  // The stamp below re-resolves this same memoized record, so it cannot fail after the create.
  if (resourceFootprintForGood(content, spec.good) === null) return null;
  const e = world.create();
  // `spec.x` and `spec.y` are half-cell node coords; the Position is the node's visual-tile coord.
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Resource, {
    goodType: spec.good,
    remaining: spec.remaining,
    harvestAtomic: spec.harvestAtomic,
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  stampResourceFootprint(world, content, e, spec.good);
  if (spec.felling !== undefined) world.add(e, Felling, { chopsLeft: spec.felling.chopsLeft });
  if (spec.deposit !== undefined) {
    world.add(e, MineDeposit, {
      initial: spec.deposit.initial ?? spec.remaining,
      levels: spec.deposit.levels,
      // Stamp the strike calibration only when the caller provides one; an unstamped node stays 1-strike.
      ...(spec.deposit.strikesPerUnit !== undefined
        ? { strikesPerUnit: spec.deposit.strikesPerUnit, strikes: 0 }
        : {}),
    });
  }
  return e;
}
