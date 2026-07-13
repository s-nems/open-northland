import type { WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../../src/data/iso.js';
import type { DrawItem } from '../../src/index.js';

/**
 * Shared snapshot fixtures for the render tests — a `WorldSnapshot` is plain data (no class
 * instances / live Maps), so the tests hand-build one instead of spinning up a Simulation; these
 * helpers are the one home for that shape (they were copy-pasted into five test files before).
 */

/** A minimal {@link DrawItem} of the given kind at the origin (`ref 1`, depth 0), plus any extra
 *  fields a resolver test reads. The one home for the base draw-item shape the sprite-resolver specs
 *  build on — before, a `{ kind, ref: 1, x: 0, y: 0, depth: 0 }` literal was re-hand-rolled per file. */
export function drawItem(kind: DrawItem['kind'], fields: Partial<DrawItem> = {}): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0, ...fields };
}

/** A snapshot entity at a fractional tile position (Fixed is a scaled integer — fractions are exact),
 *  carrying the given marker components on top of its Position. */
export function entity(
  id: number,
  tileX: number,
  tileY: number,
  marker: Record<string, unknown>,
): { id: number; components: Readonly<Record<string, unknown>> } {
  return { id, components: { Position: { x: tileX * ONE, y: tileY * ONE }, ...marker } };
}

/** A minimal snapshot around hand-built entities. */
export function snapshotOf(entities: WorldSnapshot['entities'], tick = 1): WorldSnapshot {
  return { tick, entities, events: [] };
}
