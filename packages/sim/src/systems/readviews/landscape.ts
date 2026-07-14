import type { ContentSet, LandscapeType } from '@open-northland/data';

// Pure read views for landscape placement layers — the "which layer may a type sit on" classification read
// straight off `landscapetypes.ini`'s `allowedon{land,water,everything}` flags. These three flags are
// extracted by the pipeline (unlike `walkable`/`buildable`, which keep their schema defaults — see
// tools/asset-pipeline/src/decoders/ini.ts) yet had no sim consumer; the terrain graph reads only
// `walkable`/`maxValency`. The water-layer view is placement-side, distinct from water-valency terrain
// (which cells are water), which lives in the map tile grid, not this table.

/**
 * Whether a {@link LandscapeType} may be placed on the water layer — its `allowedonwater` flag. In the
 * real `landscapetypes.ini` exactly the three wall/gate structures carry it (`wall`, `wall_gate_closed`,
 * `wall_gate_open`). Placement-side only — not a claim that a *cell* is water (that is the map tile grid's
 * terrain valency, decoded elsewhere).
 */
export function isWaterLayerType(type: LandscapeType): boolean {
  return type.allowedOnWater;
}

/**
 * The water-layer landscape types — `content.landscape` filtered by {@link isWaterLayerType}, sorted
 * ascending by `typeId` for a stable enumeration order regardless of declaration order.
 */
export function waterLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isWaterLayerType).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether a {@link LandscapeType} may be placed on any layer — its `allowedoneverything` flag. In the real
 * `landscapetypes.ini` exactly the `void` type carries it (passable empty terrain, valency 100),
 * completing the placement-layer triple with {@link isWaterLayerType} and {@link isLandLayerType}.
 */
export function isUniversalLayerType(type: LandscapeType): boolean {
  return type.allowedOnEverything;
}

/**
 * The universal-layer landscape types — `content.landscape` filtered by {@link isUniversalLayerType},
 * sorted ascending by `typeId` (isolates the `void` empty-terrain type).
 */
export function universalLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isUniversalLayerType).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether a {@link LandscapeType} may be placed on the land layer — its `allowedonland` flag. In the real
 * `landscapetypes.ini` nearly every type carries it (86 of 87 rows; the lone exception is the
 * layer-agnostic `void`). Distinct from `walkable` (which keeps a schema default the pipeline never sets —
 * see the module header): a type can be land-layer yet non-walkable (a tree, a wall).
 */
export function isLandLayerType(type: LandscapeType): boolean {
  return type.allowedOnLand;
}

/**
 * The land-layer landscape types — `content.landscape` filtered by {@link isLandLayerType}, sorted
 * ascending by `typeId` (the 86 land types, everything but `void`).
 */
export function landLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isLandLayerType).sort((a, b) => a.typeId - b.typeId);
}
