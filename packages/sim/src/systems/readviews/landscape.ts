import type { ContentSet, LandscapeType } from '@vinland/data';

// Pure, terminal **read views** for landscape placement layers — the data-defined "which layer may a
// type sit on" classification read straight off `landscapetypes.ini`'s `allowedon{land,water,everything}`
// flags (the full placement-layer triple: `isLandLayerType`/`isWaterLayerType`/`isUniversalLayerType`).
// These three flags are genuinely extracted by the pipeline (unlike `walkable`/`buildable`, which
// keep their schema defaults — see tools/asset-pipeline/src/decoders/ini.ts) yet had no sim consumer; the
// terrain graph reads only `walkable`/`maxValency`. The water-layer view is the placement-side seed the
// Sea/Northland slice reads — distinct from water-VALENCY terrain (which cells are water), which lives in
// the map tile grid, not this table. No mechanic is added here (nothing is placed
// over water); see ./index.ts for how read views relate to systems.

/**
 * Whether a {@link LandscapeType} may be placed on the **water layer** — its `allowedonwater` flag
 * ({@link LandscapeType.allowedOnWater}). In the real `landscapetypes.ini` exactly the three wall/gate
 * structures carry it (`wall`, `wall_gate_closed`, `wall_gate_open`) — fortifications that may span over
 * water — while every terrain/decor type does not. This is the placement-side "can this type sit over
 * water" gate, the data's own water-layer marker, NOT a claim that a *cell* is water (that is the map
 * tile grid's terrain valency, decoded elsewhere).
 *
 * source-basis: pinned to the extracted `allowedonwater` int (`1`/`0`). Adds no mechanic (nothing placed,
 * nothing moved) — a derived classification over the already-extracted landscape IR.
 */
export function isWaterLayerType(type: LandscapeType): boolean {
  return type.allowedOnWater;
}

/**
 * The **water-layer landscape types** as a derived **read view** over `content` — the rows a structure
 * may be placed over water, distinguished from land-only terrain *by the data alone*
 * ({@link isWaterLayerType}: the `allowedonwater` flag). In the real IR this isolates exactly the three
 * wall/gate types; it is the placement-side seed the Sea/Northland slice reads (which structures bridge
 * water), with nothing hardcoded — a richer set is the same shape with more rows.
 *
 * Returned as a {@link LandscapeType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.landscape` declaration order — the same canonical
 * shape `shipVehicles`/`seaJobs` return. {@link isWaterLayerType} is the matching single-type predicate.
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted landscape IR (like `shipVehicles`
 * over vehicles) — it adds no mechanic and invents no classification: the water-layer split is read straight
 * off the `allowedonwater` flag the pipeline pinned (see {@link isWaterLayerType}). Determinism: a pure
 * function of `content` (no world, no RNG, no wall-clock) over the plain `content.landscape` array, explicitly
 * **sorted** by `typeId`, so the same content yields a byte-identical array every call.
 */
export function waterLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isWaterLayerType).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether a {@link LandscapeType} may be placed on **any layer** — its `allowedoneverything` flag
 * ({@link LandscapeType.allowedOnEverything}). In the real `landscapetypes.ini` exactly the `void` type
 * carries it (the passable empty terrain, valency 100) — the layer-agnostic "nothing here" type that sits
 * regardless of land/water. The universal-layer twin of {@link isWaterLayerType}, completing the
 * placement-layer triple (`allowedon{land,water,everything}`) the source data carries.
 *
 * source-basis: pinned to the extracted `allowedoneverything` int (`1`/`0`). Adds no mechanic — a derived
 * classification over the already-extracted landscape IR.
 */
export function isUniversalLayerType(type: LandscapeType): boolean {
  return type.allowedOnEverything;
}

/**
 * The **universal-layer landscape types** as a derived **read view** over `content` — the rows that sit
 * on any placement layer, distinguished *by the data alone* ({@link isUniversalLayerType}: the
 * `allowedoneverything` flag). In the real IR this isolates exactly the `void` empty-terrain type; it is the
 * universal-layer twin of {@link waterLayerLandscape}, with nothing hardcoded.
 *
 * Returned as a {@link LandscapeType} **array** sorted ascending by `typeId`, the same canonical shape the
 * sibling views return. {@link isUniversalLayerType} is the matching single-type predicate.
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted landscape IR — it adds no mechanic
 * and invents no classification: the universal-layer split is read straight off the `allowedoneverything`
 * flag the pipeline pinned. Determinism: a pure function of `content` over the plain `content.landscape`
 * array, explicitly **sorted** by `typeId`, so the same content yields a byte-identical array every call.
 */
export function universalLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isUniversalLayerType).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether a {@link LandscapeType} may be placed on the **land layer** — its `allowedonland` flag
 * ({@link LandscapeType.allowedOnLand}). In the real `landscapetypes.ini` **nearly every** type carries it
 * (terrain, decor, dropped goods, and the wall/gate structures): 86 of the 87 rows, the lone exception
 * being the layer-agnostic `void` (which sits on `allowedoneverything` instead). It is the land half of the
 * placement-layer triple completed by {@link isWaterLayerType} (water) and {@link isUniversalLayerType}
 * (everything) — the data's own `allowedon{land,water,everything}` markers, read straight off the extracted
 * int. NOTE this is the *placement layer*, distinct from `walkable` (which keeps a schema default the
 * pipeline never sets — see the module header); a type can be land-layer yet non-walkable (a tree, a wall).
 *
 * source-basis: pinned to the extracted `allowedonland` int (`1`/`0`). Adds no mechanic — a derived
 * classification over the already-extracted landscape IR.
 */
export function isLandLayerType(type: LandscapeType): boolean {
  return type.allowedOnLand;
}

/**
 * The **land-layer landscape types** as a derived **read view** over `content` — the rows a structure/decor
 * may be placed on land, distinguished *by the data alone* ({@link isLandLayerType}: the `allowedonland`
 * flag). In the real IR this isolates the 86 land types (everything but the layer-agnostic `void`); it is
 * the land twin of {@link waterLayerLandscape}/{@link universalLayerLandscape}, completing the
 * placement-layer triple, with nothing hardcoded.
 *
 * Returned as a {@link LandscapeType} **array** sorted ascending by `typeId`, the same canonical shape the
 * sibling views return. {@link isLandLayerType} is the matching single-type predicate.
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted landscape IR — it adds no mechanic
 * and invents no classification: the land-layer split is read straight off the `allowedonland` flag the
 * pipeline pinned. Determinism: a pure function of `content` over the plain `content.landscape` array,
 * explicitly **sorted** by `typeId`, so the same content yields a byte-identical array every call.
 */
export function landLayerLandscape(content: ContentSet): LandscapeType[] {
  return content.landscape.filter(isLandLayerType).sort((a, b) => a.typeId - b.typeId);
}
