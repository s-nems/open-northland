import {
  assertMapModulesFitMap,
  MAP_ADDITIONS_FILE,
  MapAdditionsFile,
  type MapCells,
  type MapMeta,
  type MapScript,
  mapModulesStringIds,
} from '@open-northland/data';
import { errorMessage, MapImportError } from './errors.js';
import type { MapFolder } from './folder.js';
import { mapIdFromFolderName } from './folders.js';
import { type MapStringTables, mapTextOf } from './meta.js';
import type { MapDatTerrainFile } from './terrain/index.js';
import { applyMapObjectEdits } from './terrain/object-edits.js';

/**
 * The folder's `opennorthland.json`, or undefined when it holds none. A file that is not this
 * version's document fails the map with `decode-failed`: a mode converted without its rules would be
 * another map under the same name.
 */
export function readMapAdditions(folder: MapFolder): MapAdditionsFile | undefined {
  const bytes = folder.read([MAP_ADDITIONS_FILE]);
  if (bytes === undefined) return undefined;
  try {
    return MapAdditionsFile.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (err) {
    throw refusal(folder, errorMessage(err));
  }
}

/** The meta fields the file adds: the mode with its texts resolved and its map named by id, and the
 *  room defaults. Throws `decode-failed` on a mode text the map's string tables lack. */
export function additionsMeta(
  folder: MapFolder,
  additions: MapAdditionsFile,
  tables: MapStringTables,
): Pick<MapMeta, 'mode' | 'roomDefaults'> {
  const { mode, roomDefaults } = additions;
  const text = (id: number) => {
    const found = mapTextOf(tables, id);
    if (found === undefined) throw refusal(folder, `the map's string tables lack string ${id}`);
    return found;
  };
  const of = mode === undefined ? undefined : mapIdFromFolderName(mode.of);
  if (of === '') throw refusal(folder, `mode.of names no map folder: ${JSON.stringify(mode?.of)}`);
  return {
    ...(mode === undefined || of === undefined
      ? {}
      : {
          mode: {
            of,
            name: text(mode.name),
            ...(mode.detail === undefined ? {} : { detail: text(mode.detail) }),
          },
        }),
    ...(roomDefaults === undefined ? {} : { roomDefaults }),
  };
}

/**
 * The script with the file's modules. Throws `decode-failed` when they do not fit the map: no script
 * to run over, a point off the map, a seat the roster lacks, or a string no table of the map carries.
 * Content names are checked where the content is known, at world assembly.
 */
export function scriptWithModules(
  folder: MapFolder,
  additions: MapAdditionsFile,
  script: MapScript | undefined,
  size: MapCells,
  tables: MapStringTables,
): MapScript | undefined {
  const { modules } = additions;
  if (modules === undefined) return script;
  if (script === undefined) throw refusal(folder, 'its modules need the map script, which did not decode');
  try {
    assertMapModulesFitMap(modules, size, {
      seats: new Set(script.players.map((row) => row.player)),
      names: null,
    });
  } catch (err) {
    throw refusal(folder, errorMessage(err));
  }
  for (const id of mapModulesStringIds(modules)) {
    if (mapTextOf(tables, id) === undefined)
      throw refusal(folder, `the map's string tables lack string ${id}`);
  }
  return { ...script, modules };
}

/** The terrain with the file's landscape object edits. Throws `decode-failed` on an edit that does not
 *  fit what `map.dat` places. */
export function terrainWithObjectEdits(
  folder: MapFolder,
  additions: MapAdditionsFile,
  terrain: MapDatTerrainFile,
): MapDatTerrainFile {
  if (additions.objects === undefined) return terrain;
  const objects = applyMapObjectEdits(additions.objects, terrain, (why) => {
    throw refusal(folder, why);
  });
  return objects === undefined ? terrain : { ...terrain, objects };
}

function refusal(folder: MapFolder, why: string): MapImportError {
  return new MapImportError('decode-failed', `${folder.path}/${MAP_ADDITIONS_FILE}: ${why}`);
}
