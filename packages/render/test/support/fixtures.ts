import {
  FOG_MODE,
  FOG_STATE,
  type FogMode,
  type FogView,
  fogSettings,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ONE } from '../../src/data/projection/index.js';
import type { SpriteState } from '../../src/data/scene/index.js';
import { lookupFrame, resolveSpriteBobId } from '../../src/data/sprites/index.js';
import type { DrawnGeometry } from '../../src/gpu/sprite-pool/index.js';
import type { AtlasFrame, DrawItem, SceneTerrain, SpriteAtlas, SpriteBindings } from '../../src/index.js';

/**
 * Shared snapshot fixtures for the render tests. A `WorldSnapshot` is plain data with no class
 * instances or live Maps, so the tests hand-build one instead of spinning up a Simulation.
 */

/** A {@link DrawItem} of the given kind at the origin (`ref 1`, depth 0), plus any extra fields a
 *  resolver test reads. */
export function drawItem(kind: DrawItem['kind'], fields: Partial<DrawItem> = {}): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0, ...fields };
}

/** The atlas rect a draw item selects from one atlas, or `null` for a terrain tile, an unbound kind or a
 *  bob id the atlas has no frame for. */
export function resolveSpriteFrame(
  item: DrawItem,
  bindings: SpriteBindings,
  atlas: SpriteAtlas,
  tick = 0,
): AtlasFrame | null {
  const bobId = resolveSpriteBobId(item, bindings, tick);
  return bobId === null ? null : lookupFrame(atlas, bobId);
}

/** Each field takes `| undefined` so a caller can forward its own optional argument through;
 *  `exactOptionalPropertyTypes` rejects an explicit `undefined` against a bare `?:`. An absent or
 *  `undefined` field is left off the item, because the resolvers distinguish absent from falsy. */
export interface SettlerItemFields {
  readonly facing?: number | undefined;
  readonly atomicId?: number | undefined;
  readonly elapsed?: number | undefined;
  readonly carrying?: boolean | undefined;
  readonly carryGood?: number | undefined;
  readonly engaged?: boolean | undefined;
}

/** A settler {@link DrawItem}; omitting `state` gives the stateless back-compat item. */
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

/** The smallest flat grid with both row parities, so a spec can place an entity on an odd
 *  (half-shifted) row. */
export const FLAT_3x2: SceneTerrain = { width: 3, height: 2, typeIds: [1, 1, 2, 2, 1, 1] };

/** A snapshot entity at a fractional tile position; Fixed is a scaled integer, so fractions are exact. */
export function entity(
  id: number,
  tileX: number,
  tileY: number,
  marker: Record<string, unknown>,
): { id: number; components: Readonly<Record<string, unknown>> } {
  return { id, components: { Position: { x: tileX * ONE, y: tileY * ONE }, ...marker } };
}

/** Canonicalized to the ascending-id order `takeSnapshot` guarantees, so a fixture cannot hand a reader
 *  a shape the sim never produces. */
export function snapshotOf(entities: WorldSnapshot['entities'], tick = 1): WorldSnapshot {
  return { tick, entities: [...entities].sort((a, b) => a.id - b.id), events: [] };
}

/** A {@link DrawnGeometry} whose seams report nothing drawn, except the ones a test overrides. */
export function drawnGeometry(seams: Partial<DrawnGeometry> = {}): DrawnGeometry {
  return { boundsOf: () => undefined, anchorOf: () => undefined, ...seams };
}

/** A {@link FogView} over a sparse `"cx,cy"` map where a missing cell is UNEXPLORED, mirroring the sim's
 *  known-terrain rule so a RECON spec reads the same mapping the app does. */
export function fogViewOf(
  states: ReadonlyMap<string, number>,
  generation: number,
  mode: FogMode = FOG_MODE.CLASSIC,
): FogView {
  return {
    mode,
    cellsWide: 64,
    cellsHigh: 64,
    generation,
    stateAt: (cx, cy) => {
      const raw = states.get(`${cx},${cy}`) ?? FOG_STATE.UNEXPLORED;
      if (raw === FOG_STATE.UNEXPLORED && fogSettings(mode)?.terrainKnown === true) return FOG_STATE.EXPLORED;
      return raw;
    },
  };
}
