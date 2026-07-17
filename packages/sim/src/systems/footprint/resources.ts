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

// RESOURCE footprints — the `[GfxLandscape]` walk/build/work areas a stamped resource occupies. Opt-in
// via ResourceFootprint: a bare Resource keeps the legacy same-tile fixture behavior. The blocked-cell
// overlay these feed lives in ./resource-blocked-cache.ts (maintained by the stamp/unstamp paths below).

/**
 * Convert one decoded `[GfxLandscape]` record into the sim's resource-footprint component payload.
 * The source stores repeated rows per valency/growth state; collision for Step 5 is static until the
 * node is removed, so `fullStateBlockAreaCells` (the fresh/full object's cells — also the app's
 * map-collision join) is the correct conservative consumer.
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

/**
 * The caller-resolved shape of a resource node to place: its good, half-cell NODE, starting yield and
 * harvest atomic, plus which harvest LIFECYCLE it runs (a felled tree, a mined deposit, or — neither — a
 * pluck-whole node). The felling/deposit balance constants live in the app catalog, so the caller
 * resolves them and hands the sim a ready spec (the same "app resolves content, sim applies" split as
 * the `attack` effect's pre-resolved damage). Consumed by {@link createResourceNode}.
 */
export interface ResourceNodeSpec {
  readonly good: number;
  /** The node's half-cell lattice coords (like every sim command; → a visual-tile Position). */
  readonly x: number;
  readonly y: number;
  readonly remaining: number;
  readonly harvestAtomic: number;
  /**
   * OPAQUE render-variant tag: the app's decoded-map species record index ("pine 02", "stones 05
   * grey" in the APP's content numbering) — stored on {@link Resource.gfxIndex} verbatim and carried
   * out through the snapshot so the render draws the exact original object. The sim NEVER interprets
   * it (footprint/collision still come from the good's own record in the SIM's content set, whose
   * numbering is unrelated). Omitted for an admin/scene spawn — the per-good representative draws, and
   * the component hashes exactly as before, so goldens are untouched.
   */
  readonly gfxIndex?: number;
  /** A felled node (a tree): its chops-to-fell counter. Mutually exclusive with `deposit`. */
  readonly felling?: { readonly chopsLeft: number };
  /** A mined finite deposit (stone/clay/iron/gold): its level ladder (`initial` = `remaining`) and
   *  how many work cycles chip one unit off (the app catalog's observed calibration; omitted → 1). */
  readonly deposit?: { readonly levels: number; readonly strikesPerUnit?: number };
}

/**
 * Assemble a standing resource node from a resolved {@link ResourceNodeSpec}: a {@link Position} +
 * {@link Resource} carrying its yield/atomic, its content-derived footprint (from `good`), and the
 * {@link Felling}/{@link MineDeposit} lifecycle marker the spec asks for. This is the ONE place a
 * resource node is built — the scene-setup helpers (pre-tick-0, direct) and the `placeResource`
 * command handler (runtime, through the mutation seam) both route here, so a hand-placed tree and a
 * command-placed tree are byte-identical entities.
 *
 * Returns `null` — creating NOTHING, so no entity id is burned — when `good` has no resource footprint
 * record: a scene-setup caller treats that as a hard bug and throws; the command handler treats it as
 * recoverable bad input and skips. The footprint is resolved BEFORE `create()` for exactly that reason —
 * an id-neutral skip like the `placeBuilding`/`placeBoat` gates, rather than a create-then-destroy that
 * would make the id sequence depend on how many rejected commands were issued. Determinism: a single
 * `create()` plus pure content reads (the footprint stamp maintains its own blocked-cell cache) — no
 * RNG, no wall-clock.
 */
export function createResourceNode(world: World, content: ContentSet, spec: ResourceNodeSpec): Entity | null {
  // Resolve the footprint FIRST (a memoized content read) so an unknown good is an id-neutral skip
  // before any `create()`. The `stampResourceFootprint` below re-resolves the same memoized record and
  // so cannot fail here — it does the ResourceFootprint stamp + the incremental blocked-cell cache entry.
  if (resourceFootprintForGood(content, spec.good) === null) return null;
  const e = world.create();
  // `spec.x`/`y` are HALF-CELL NODE coords (like every sim command); the Position is the node's
  // visual-tile coord, exactly as `spawnSettler` maps its command node → Position.
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Resource, {
    goodType: spec.good,
    remaining: spec.remaining,
    harvestAtomic: spec.harvestAtomic,
    // The opaque render-variant tag rides the component (absent = hash-identical to a pre-variant node).
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  stampResourceFootprint(world, content, e, spec.good);
  if (spec.felling !== undefined) world.add(e, Felling, { chopsLeft: spec.felling.chopsLeft });
  if (spec.deposit !== undefined) {
    world.add(e, MineDeposit, {
      initial: spec.remaining,
      levels: spec.deposit.levels,
      // Stamp the strike calibration only when the caller provides one — an unstamped node keeps the
      // legacy 1-strike hash shape (the separate-optional-field pattern).
      ...(spec.deposit.strikesPerUnit !== undefined
        ? { strikesPerUnit: spec.deposit.strikesPerUnit, strikes: 0 }
        : {}),
    });
  }
  return e;
}
