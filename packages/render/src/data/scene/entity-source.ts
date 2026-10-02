import {
  collectPositioned,
  type EntitySnapshot,
  entityById,
  isPositioned,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import { TILE_HALF_H, TILE_HALF_W, type Viewport } from '../projection/index.js';
import type { DrawListOptions, LiveRefs } from './sprite-scene.js';

export type EntitySource = Pick<
  DrawListOptions,
  'viewport' | 'onlyRefs' | 'staticRefs' | 'portraitRef' | 'portraitHouse' | 'insetRefs'
>;

/**
 * Tiles an entity's drawn anchor may lie from its `Position`: a driving vehicle draws up to one node leg
 * behind it, and a choreographed craftsman at his workplace's anchor while he stands at its door.
 * Approximation: a door lies within this of its building's anchor.
 */
const DRAWN_ANCHOR_SLACK_TILES = 4;

/** Reused query output, written over from the start by each build so it keeps its capacity; the slots
 *  past a build's count hold entities an earlier build read. */
const candidates: EntitySnapshot[] = [];

/** The returned view reads `collected` live, so refs the caller adds afterwards count too. The viewport
 *  mode answers without having walked the map, and adds the positioned entities, minus the static
 *  ones, to that view: `emit` hears `indexed` for an entity the view answers for that way, which the
 *  emitter need not collect. */
export function emitEntities(
  snapshot: WorldSnapshot,
  source: EntitySource,
  collected: Set<number>,
  emit: (entity: EntitySnapshot, indexed: boolean) => void,
): LiveRefs {
  const { viewport, onlyRefs, staticRefs, portraitRef, portraitHouse, insetRefs } = source;
  if (viewport !== undefined && onlyRefs === undefined) {
    // Each candidate still runs the emitter's per-item cull, so the emitted set matches the full walk's.
    const count = collectPositioned(snapshot, anchorTileBox(viewport), candidates);
    for (let i = 0; i < count; i++) {
      const entity = candidates[i];
      if (entity !== undefined) emit(entity, true);
    }
    // The portrait subjects may sit outside the queried box.
    const force = (ref: number | undefined): void => {
      if (ref === undefined || collected.has(ref)) return;
      const subject = entityById(snapshot, ref);
      if (subject !== undefined) emit(subject, false);
    };
    force(portraitRef);
    force(portraitHouse);
    for (const ref of insetRefs ?? []) force(ref);
    // A positioned entity the scene does not classify answers true too; only one that stopped being
    // drawable while staying put (an emptied fish swarm) ever has a sprite to keep, detached, until it
    // leaves the snapshot or draws again.
    return {
      has: (ref) => collected.has(ref) || (isPositioned(snapshot, ref) && staticRefs?.has(ref) !== true),
    };
  }
  if (onlyRefs !== undefined) {
    // Binary search per ref, instead of walking a decoded map's tens of thousands of entities.
    for (const ref of onlyRefs) {
      const entity = entityById(snapshot, ref);
      if (entity !== undefined) emit(entity, false);
    }
    return collected;
  }
  for (const entity of snapshot.entities) emit(entity, false);
  return collected;
}

/**
 * Every tile position whose anchor can land in `viewport` (pre-lift px), grown by the drawn-anchor
 * slack. Inverts `tileToScreen`: x is `(2·col + stagger)·TILE_HALF_W` with the row stagger in [0, 1],
 * so a column reaches half a column left of its unstaggered spot; y is `row·TILE_HALF_H`.
 */
export function anchorTileBox(viewport: Viewport): TileBox {
  const columnPx = 2 * TILE_HALF_W;
  return {
    minX: viewport.minX / columnPx - 1 / 2 - DRAWN_ANCHOR_SLACK_TILES,
    maxX: viewport.maxX / columnPx + DRAWN_ANCHOR_SLACK_TILES,
    minY: viewport.minY / TILE_HALF_H - DRAWN_ANCHOR_SLACK_TILES,
    maxY: viewport.maxY / TILE_HALF_H + DRAWN_ANCHOR_SLACK_TILES,
  };
}
