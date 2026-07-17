import type { WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../../src/data/projection/index.js';
import type { SpriteState } from '../../src/data/scene/index.js';
import type { DrawItem, SceneTerrain } from '../../src/index.js';

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

/** The optional {@link DrawItem} fields a settler sprite-resolver spec varies. Each takes `| undefined`
 *  so a caller can forward its own optional argument through (`exactOptionalPropertyTypes` rejects an
 *  explicit `undefined` against a bare `?:`); an absent or `undefined` field is left off the item, since
 *  the resolvers distinguish an absent field from a falsy one. */
export interface SettlerItemFields {
  readonly facing?: number | undefined;
  readonly atomicId?: number | undefined;
  readonly elapsed?: number | undefined;
  readonly carrying?: boolean | undefined;
  readonly carryGood?: number | undefined;
  readonly engaged?: boolean | undefined;
}

/** A settler {@link DrawItem} in the given state (omitted entirely for the stateless back-compat case)
 *  carrying whichever resolver inputs the spec sets. */
export function settlerItem(state?: SpriteState, fields: SettlerItemFields = {}): DrawItem {
  return drawItem('settler', {
    ...(state !== undefined ? { state } : {}),
    ...(fields.facing !== undefined ? { facing: fields.facing } : {}),
    ...(fields.atomicId !== undefined ? { atomicId: fields.atomicId } : {}),
    ...(fields.elapsed !== undefined ? { elapsed: fields.elapsed } : {}),
    ...(fields.carrying ? { carrying: true } : {}),
    ...(fields.carryGood !== undefined ? { carryGood: fields.carryGood } : {}),
    ...(fields.engaged ? { engaged: true } : {}),
  });
}

/** A flat 3×2 landscape — the smallest grid with both row parities, so a spec can place an entity on an
 *  odd (half-shifted) row without hand-rolling a terrain per file. */
export const FLAT_3x2: SceneTerrain = { width: 3, height: 2, typeIds: [1, 1, 2, 2, 1, 1] };

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
