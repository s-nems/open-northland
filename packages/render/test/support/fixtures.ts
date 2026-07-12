import type { WorldSnapshot } from '@vinland/sim';
import { ONE } from '../../src/data/iso.js';

/**
 * Shared snapshot fixtures for the render tests — a `WorldSnapshot` is plain data (no class
 * instances / live Maps), so the tests hand-build one instead of spinning up a Simulation; these
 * helpers are the one home for that shape (they were copy-pasted into five test files before).
 */

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
