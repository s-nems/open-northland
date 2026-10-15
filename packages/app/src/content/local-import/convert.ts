import { jsonFingerprint } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import {
  type ConvertProgress,
  convertMapTree,
  MapImportError,
  type MapTree,
  mapFiles,
  type OpenOptions,
  openArchive,
  treeFromFolder,
} from '@open-northland/map-import';
import { isMapFileSuffix, MAP_FILE_SUFFIXES, type MapFileSuffix } from '../map-source/files.js';
import { INSTALLED_MAP_RECORD_VERSION, type InstallableMap } from '../map-source/installed.js';
import { checkedLocalInput, type LocalMapInput, localInputBytes } from './input.js';
import { LOCAL_SOURCE_VERSION, type LocalSourceRecord, type RetainedLocalSource } from './source.js';

export type LocalImportProgress =
  | { readonly phase: 'reading' | 'unpacking'; readonly done: number; readonly total: number }
  | { readonly phase: 'converting'; readonly conversion: ConvertProgress };

export interface PreparedLocalImport {
  readonly source: RetainedLocalSource;
  readonly maps: readonly InstallableMap[];
  readonly warnings: readonly string[];
  readonly skipped: readonly string[];
}

export interface LocalConversionOptions {
  readonly unrarWasm?: OpenOptions['unrarWasm'];
  readonly onProgress?: (progress: LocalImportProgress) => void;
  readonly previous?: LocalSourceRecord;
  readonly knownSources?: readonly LocalSourceRecord[];
  readonly installedAt: number;
  readonly irVersion?: number;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads, unpacks, converts and serializes in a Worker; no generated document crosses as a JS tree. */
export async function prepareLocalImport(
  raw: LocalMapInput,
  options: LocalConversionOptions,
): Promise<PreparedLocalImport> {
  const input = checkedLocalInput(raw);
  const progress = options.onProgress ?? (() => undefined);
  let fingerprint: string;
  let tree: MapTree;
  if (input.kind === 'archive') {
    progress({ phase: 'reading', done: 0, total: 1 });
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    fingerprint = await digest(bytes);
    progress({ phase: 'unpacking', done: 0, total: 1 });
    tree = await openArchive(bytes, {
      name: input.name,
      ...(options.unrarWasm === undefined ? {} : { unrarWasm: options.unrarWasm }),
    });
  } else {
    let done = 0;
    const hashes: [string, string][] = [];
    const files = new Map(input.files.map((item) => [item.path, item.file]));
    progress({ phase: 'reading', done, total: files.size });
    tree = await treeFromFolder(files.keys(), async (path) => {
      const file = files.get(path);
      if (file === undefined) throw new Error('Missing picked file');
      const bytes = new Uint8Array(await file.arrayBuffer());
      hashes.push([path, await digest(bytes)]);
      progress({ phase: 'reading', done: ++done, total: files.size });
      return bytes;
    });
    fingerprint = jsonFingerprint(hashes);
  }
  if (options.previous !== undefined && options.previous.fingerprint !== fingerprint)
    throw new MapImportError('decode-failed', 'Retained source fingerprint differs');
  const previous =
    options.previous ?? options.knownSources?.find((source) => source.fingerprint === fingerprint);
  const sourceName = previous?.name ?? input.name;
  const warnings: string[] = [];
  const converted = await convertMapTree(tree, {
    provenance: 'user',
    rootName: input.kind === 'archive' ? sourceName.replace(/\.[^.]+$/, '') || 'map' : sourceName,
    onProgress: (conversion) => progress({ phase: 'converting', conversion }),
    onWarning: (message) => warnings.push(message),
  });
  // Repacking an archive or changing only its text replaces the same playable map pack.
  const entryId =
    previous?.entryId ?? `user-${jsonFingerprint(converted.maps.map((map) => map.index.fingerprint).sort())}`;
  const ranked = converted.maps
    .map((map, index) => ({ fingerprint: map.index.fingerprint, index }))
    .sort((a, b) =>
      a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : a.index - b.index,
    );
  const ranks = new Map(ranked.map((item, rank) => [item.index, rank + 1]));
  const names = converted.maps.map((map, i) => ({
    folder: map.folder,
    mapId: previous?.maps[i]?.mapId ?? `${entryId}-${ranks.get(i)}`,
  }));
  if (
    previous !== undefined &&
    (names.length !== previous.maps.length ||
      names.some((item, i) => previous?.maps[i]?.folder !== item.folder))
  )
    throw new MapImportError('decode-failed', 'Retained map pack no longer converts completely');
  const maps: InstallableMap[] = converted.maps.map((map, i) => {
    const mapId = names[i]?.mapId;
    if (mapId === undefined) throw new Error('Missing local map identity');
    const index = { ...map.index, id: mapId };
    const files = new Map<MapFileSuffix, Uint8Array>();
    const emitted = mapFiles({ ...map, id: mapId, index });
    for (const suffix of MAP_FILE_SUFFIXES) {
      const file = emitted.get(`${mapId}${suffix}`);
      if (file !== undefined)
        files.set(suffix, typeof file === 'string' ? new TextEncoder().encode(file) : file);
    }
    for (const [name, bytes] of map.pictures) {
      const suffix = `.pictures-${name}`;
      if (!isMapFileSuffix(suffix)) throw new Error('Invalid briefing picture name');
      files.set(suffix, bytes);
    }
    for (const [suffix, bytes] of map.voices) {
      if (!isMapFileSuffix(suffix)) throw new Error('Invalid briefing voice name');
      files.set(suffix, bytes);
    }
    return {
      record: {
        version: INSTALLED_MAP_RECORD_VERSION,
        revision: crypto.randomUUID(),
        mapId,
        entryId,
        fingerprint: index.fingerprint,
        irVersion: options.irVersion ?? IR_VERSION,
        index,
        installedAt: options.installedAt,
        size: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
        suffixes: [...files.keys()],
      },
      files,
    };
  });
  return {
    maps,
    source: {
      record: {
        kind: 'local-source',
        version: LOCAL_SOURCE_VERSION,
        entryId,
        name: sourceName,
        fingerprint,
        size: localInputBytes(input),
        maps: names,
      },
      input: { ...input, name: sourceName },
    },
    warnings,
    skipped: converted.skipped.map((item) => item.folder),
  };
}
