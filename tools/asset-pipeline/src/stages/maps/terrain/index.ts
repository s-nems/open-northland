import type { MapStaticObjects } from '../../../decoders/ini.js';
import {
  decodeMapDat,
  decodeMapSize,
  findChunk,
  lmltToTerrainMap,
  type MapDatTerrainMap,
  unpackMapLayer,
} from '../../../decoders/mapdat/index.js';
import { errorMessage } from '../../../errors.js';
import { type GroundLayer, groundFromMapDat } from './ground.js';
import type { DecodedMap } from './lane.js';
import { type ObjectsLayer, objectsFromMapDat } from './objects.js';
import { brightnessFromMapDat, elevationFromMapDat } from './per-cell.js';
import { shoreFromMapDat } from './shore.js';
import { type TransitionsLayer, transitionsFromMapDat } from './transitions.js';

/** The emitted `maps/<id>.json` shape: the sim grid + the optional 1:1 render layers. */
export interface MapDatTerrainFile extends MapDatTerrainMap {
  /** Per-triangle ground patterns (`empa`/`empb` lanes joined through the `eapd` name dictionary). */
  readonly ground?: GroundLayer;
  /** Per-triangle transition overlays (`emt1..emt4` lanes + the `eatd` name dictionary, verbatim). */
  readonly transitions?: TransitionsLayer;
  /** Placed landscape objects (`emla` half-cell lane joined through the `eald` name dictionary). */
  readonly objects?: ObjectsLayer;
  /** Per-cell terrain height (`lmhe` lane, one byte per cell, 0..250 observed); omitted when the map lacks it. */
  readonly elevation?: number[];
  /** Per-cell baked brightness (`embr` lane, one byte per cell, 127 = neutral); omitted when the map lacks it. */
  readonly brightness?: number[];
  /** Per-cell `lmms` band, the lane collapsed to the cell-centre node; semantics unconfirmed. */
  readonly shore?: number[];
  /** Authored entity placements (the sibling `map.cif`'s `StaticObjects` verbs, names verbatim). */
  readonly entities?: MapStaticObjects;
}

function layer<K extends keyof MapDatTerrainFile, T extends NonNullable<MapDatTerrainFile[K]>>(
  key: K,
  laneLabel: string,
  build: () => T | undefined,
): { readonly [P in K]?: T } {
  let value: T | undefined;
  try {
    value = build();
  } catch (err) {
    console.warn(
      `[pipeline] map ${laneLabel} unreadable, emitting grid without that layer: ${errorMessage(err)}`,
    );
    return {};
  }
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: T });
}

/**
 * One `map.dat`'s bytes -> the emitted `maps/<id>.json` value: the mandatory sim grid (`lsiz` dims plus
 * the `lmlt` half-cell lane collapsed to the per-cell typeId grid `buildTerrainGraph` consumes; the
 * build tool never imports `sim`) and the optional 1:1 render lanes. Throws a `mapdat:`-prefixed error
 * for a non-container or a missing/corrupt `lsiz`/`lmlt` (`convertMapDatTree` catches per file); a
 * corrupt render lane only warns and omits its layer, so a map whose nav grid decodes fine never
 * disappears over its enrichments.
 */
export function mapDatToTerrain(bytes: Uint8Array): MapDatTerrainFile {
  const map = decodeMapDat(bytes);
  const size = decodeMapSize(map);
  const lmlt = findChunk(map, 'lmlt');
  if (lmlt === undefined) {
    throw new Error('mapdat: no lmlt landscape-type chunk (cannot build the terrain grid)');
  }
  const terrain = lmltToTerrainMap(unpackMapLayer(lmlt), size);
  const decoded: DecodedMap = { map, size };
  return {
    ...terrain,
    ...layer('ground', 'ground lanes', () => groundFromMapDat(decoded)),
    ...layer('transitions', 'transition lanes', () => transitionsFromMapDat(decoded)),
    ...layer('objects', 'object lanes', () => objectsFromMapDat(decoded)),
    ...layer('elevation', 'elevation lane', () => elevationFromMapDat(decoded)),
    ...layer('brightness', 'brightness lane', () => brightnessFromMapDat(decoded)),
    ...layer('shore', 'shore lane', () => shoreFromMapDat(decoded)),
  };
}
