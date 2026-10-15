import {
  type CatalogEntry,
  MapBriefing,
  MapMeta,
  MapStrings,
  type MapsIndexEntry,
} from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import type { CatalogMapAnnouncement } from '@open-northland/net-protocol';
import {
  loadVerifiedMapDocuments,
  MAX_MAP_DOCUMENT_BYTES,
  type VerifiedMapDocuments,
  verifyMapDocuments,
} from '../transfer/documents.js';
import {
  apiBaseUrl,
  catalogRequestSignal,
  catalogSidecarUrl,
  convertedMaps,
  fetchCatalogEntry,
} from './api.js';
import {
  briefingPictureSuffixes,
  briefingVoiceSuffixes,
  MAP_FILE_SUFFIXES,
  type MapFileSuffix,
} from './files.js';
import { INSTALLED_MAP_RECORD_VERSION, type InstallableMap, type InstalledMapRecord } from './installed.js';
import { boundedMapPicture } from './picture.js';
import { type InstalledMapStore, installedMapStore } from './store.js';

/** A map's authored picture is a menu illustration; anything near this size is not one. */
export const MAX_MAP_PICTURE_BYTES = 16 * 1024 * 1024;
/** One map may contain many pages; their images share a bounded download budget. */
const MAX_BRIEFING_PICTURES_BYTES = 64 * 1024 * 1024;
/** One spoken briefing line; the longest shipped one is about a minute of ADPCM, under 2 MB. */
const MAX_BRIEFING_VOICE_BYTES = 16 * 1024 * 1024;
/** A map's spoken lines share one download budget. */
const MAX_BRIEFING_VOICES_BYTES = 128 * 1024 * 1024;
/** Bounds one in-memory installation, including all maps and their pictures. */
const MAX_CATALOG_INSTALL_BYTES = 512 * 1024 * 1024;

const TERRAIN: MapFileSuffix = '.json';
const SCRIPT: MapFileSuffix = '.script.json';
const PICTURE: MapFileSuffix = '.png';
const VOICE_EXTENSION = '.wav';
const HTTP_NOT_FOUND = 404;

/** A plain sidecar or the terrain, a briefing picture the pages require, or a voice a map may lack. */
type SidecarKind = 'document' | 'picture' | 'voice';

export type CatalogInstallFailure = 'notConverted' | 'otherVersion' | 'download' | 'verify';

export class CatalogInstallError extends Error {
  constructor(
    readonly failure: CatalogInstallFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Files fetched so far out of every sidecar the entry's maps may have. */
export interface InstallProgress {
  readonly done: number;
  readonly total: number;
}

export interface InstallOptions {
  readonly api: string;
  readonly store: InstalledMapStore;
  readonly fetchImpl?: typeof fetch;
  readonly irVersion?: number;
  readonly onProgress?: (progress: InstallProgress) => void;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

async function readCapped(response: Response, cap: number, url: string): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > cap)
    throw new CatalogInstallError('download', `${url} exceeds the size limit`);
  if (response.body === null) throw new CatalogInstallError('download', `${url} is empty`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) throw new CatalogInstallError('download', `${url} exceeds the size limit`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function json(bytes: Uint8Array, url: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CatalogInstallError('verify', `${url} is not JSON`);
  }
}

/** Checks one sidecar the way the loaders will read it, so a stored map never fails at boot. */
function checkSidecar(suffix: MapFileSuffix, bytes: Uint8Array, url: string): void {
  if (suffix.endsWith(PICTURE)) {
    if (!boundedMapPicture(bytes)) throw new CatalogInstallError('verify', `${url} is not a PNG`);
    return;
  }
  // A voice is a wav the narration decodes when it plays; one that does not decode stays silent.
  if (suffix.endsWith(VOICE_EXTENSION)) return;
  const value = json(bytes, url);
  const parsed =
    suffix === '.meta.json'
      ? MapMeta.safeParse(value)
      : suffix === '.strings.json'
        ? MapStrings.safeParse(value)
        : suffix === '.briefing.json'
          ? MapBriefing.safeParse(value)
          : null;
  if (parsed !== null && !parsed.success)
    throw new CatalogInstallError('verify', `${url} does not match this build`);
}

/** The catalogue map's listing row as the game lists it: its own id and the catalogue provenance. */
function installedIndex(entry: CatalogEntry, mapId: string, index: MapsIndexEntry): MapsIndexEntry {
  const folder = index.provenance?.folder ?? entry.id;
  return { ...index, id: mapId, provenance: { kind: 'catalog', folder } };
}

/**
 * Downloads every map of a converted catalogue entry, checks each file against what the server
 * announced (the fingerprint, the schemas, the size caps), and stores the entry as one install. A
 * campaign installs its main map with its sub maps.
 */
export async function installCatalogEntry(
  entry: CatalogEntry,
  options: InstallOptions,
): Promise<readonly InstalledMapRecord[]> {
  options.signal?.throwIfAborted();
  const irVersion = options.irVersion ?? IR_VERSION;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (entry.conversion?.verdict !== 'ok')
    throw new CatalogInstallError('notConverted', `${entry.id} has no converted maps`);
  if (entry.conversion.irVersion !== irVersion)
    throw new CatalogInstallError('otherVersion', `${entry.id} was converted for another game version`);
  const maps = convertedMaps(entry);
  let total = maps.length * MAP_FILE_SUFFIXES.length;
  let done = 0;
  let downloadedBytes = 0;
  options.onProgress?.({ done, total });
  const installedAt = (options.now ?? Date.now)();
  const installable: InstallableMap[] = [];
  for (const map of maps) {
    const files = new Map<MapFileSuffix, Uint8Array>();
    const download = new AbortController();
    const signal = catalogRequestSignal(
      options.signal === undefined ? download.signal : AbortSignal.any([download.signal, options.signal]),
    );
    let pictures: MapFileSuffix[] = [];
    let voices: MapFileSuffix[] = [];
    let pictureBytes = 0;
    let voiceBytes = 0;
    const fetchSidecar = async (suffix: MapFileSuffix, kind: SidecarKind = 'document'): Promise<void> => {
      const url = catalogSidecarUrl(options.api, irVersion, map.mapId, suffix);
      let response: Response;
      try {
        response = await fetchImpl(url, { signal });
      } catch (error) {
        throw new CatalogInstallError('download', `${url}: ${String(error)}`);
      }
      if (response.status === HTTP_NOT_FOUND && suffix !== TERRAIN && kind !== 'picture') {
        await response.body?.cancel();
      } else {
        if (!response.ok) throw new CatalogInstallError('download', `${url}: HTTP ${response.status}`);
        const bytes = await readCapped(
          response,
          kind === 'voice'
            ? MAX_BRIEFING_VOICE_BYTES
            : suffix.endsWith(PICTURE)
              ? MAX_MAP_PICTURE_BYTES
              : MAX_MAP_DOCUMENT_BYTES,
          url,
        );
        downloadedBytes += bytes.byteLength;
        if (downloadedBytes > MAX_CATALOG_INSTALL_BYTES)
          throw new CatalogInstallError('download', `${entry.id} exceeds the installation size limit`);
        checkSidecar(suffix, bytes, url);
        if (kind === 'picture') {
          pictureBytes += bytes.byteLength;
          if (pictureBytes > MAX_BRIEFING_PICTURES_BYTES)
            throw new CatalogInstallError('download', `${map.mapId} briefing pictures exceed the size limit`);
        }
        if (kind === 'voice') {
          voiceBytes += bytes.byteLength;
          if (voiceBytes > MAX_BRIEFING_VOICES_BYTES)
            throw new CatalogInstallError('download', `${map.mapId} briefing voices exceed the size limit`);
        }
        if (suffix === '.briefing.json') {
          const briefing = MapBriefing.parse(json(bytes, url));
          pictures = briefingPictureSuffixes(briefing);
          voices = briefingVoiceSuffixes(briefing);
          total += pictures.length + voices.length;
        }
        files.set(suffix, bytes);
      }
      if (!signal.aborted) {
        done++;
        options.onProgress?.({ done, total });
      }
    };
    try {
      await Promise.all(MAP_FILE_SUFFIXES.map((suffix) => fetchSidecar(suffix)));
      // Page documents supply the allowlist; never fetch authored URLs or paths.
      for (const suffix of pictures) {
        signal.throwIfAborted();
        await fetchSidecar(suffix, 'picture');
      }
      for (const suffix of voices) {
        signal.throwIfAborted();
        await fetchSidecar(suffix, 'voice');
      }
    } catch (error) {
      // Failed installs must not leave sibling requests reporting progress into a later retry.
      download.abort();
      throw error;
    }
    const terrain = files.get(TERRAIN);
    if (terrain === undefined) throw new CatalogInstallError('download', `${map.mapId} has no terrain`);
    const script = files.get(SCRIPT);
    let fingerprint: string;
    try {
      fingerprint = verifyMapDocuments(
        map.mapId,
        json(terrain, map.mapId),
        script === undefined ? null : json(script, map.mapId),
      ).fingerprint;
    } catch (error) {
      throw new CatalogInstallError('verify', `${map.mapId}: ${String(error)}`);
    }
    if (fingerprint !== map.fingerprint)
      throw new CatalogInstallError('verify', `${map.mapId} does not match the catalogue's fingerprint`);
    const suffixes = [...MAP_FILE_SUFFIXES, ...pictures, ...voices].filter((suffix) => files.has(suffix));
    installable.push({
      record: {
        version: INSTALLED_MAP_RECORD_VERSION,
        revision: crypto.randomUUID(),
        mapId: map.mapId,
        entryId: entry.id,
        fingerprint,
        irVersion,
        index: installedIndex(entry, map.mapId, map.index),
        installedAt,
        size: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
        suffixes,
      },
      files,
    });
  }
  options.signal?.throwIfAborted();
  await options.store.install(entry.id, installable);
  return installable.map((map) => map.record);
}

export interface AnnouncedMapServices {
  readonly signal?: AbortSignal;
  readonly api?: string;
  readonly store?: InstalledMapStore | null;
  readonly fetchImpl?: typeof fetch;
  readonly irVersion?: number;
}

/**
 * A room's catalogue map fetched from the catalogue server, or null when this build or the server cannot
 * supply the exact conversion the creator announced; the caller then asks the creator through the relay.
 */
export async function installAnnouncedCatalogMap(
  announced: CatalogMapAnnouncement,
  services: AnnouncedMapServices = {},
): Promise<VerifiedMapDocuments | null> {
  const irVersion = services.irVersion ?? IR_VERSION;
  const store = services.store === undefined ? installedMapStore() : services.store;
  if (store === null || announced.irVersion !== irVersion) return null;
  const api = services.api ?? apiBaseUrl();
  const fetchImpl = services.fetchImpl ?? fetch;
  const entry = await fetchCatalogEntry(api, announced.entryId, fetchImpl, services.signal);
  const listed =
    entry === null ? undefined : convertedMaps(entry).find((map) => map.mapId === announced.mapId);
  if (entry === null || listed?.fingerprint !== announced.fingerprint) return null;
  const records = await installCatalogEntry(entry, {
    api,
    store,
    fetchImpl,
    irVersion,
    ...(services.signal === undefined ? {} : { signal: services.signal }),
  });
  const record = records.find((item) => item.mapId === announced.mapId);
  if (record === undefined) return null;
  const documents = await loadVerifiedMapDocuments(announced.mapId, store.fetchFor(record));
  return documents?.fingerprint === announced.fingerprint ? documents : null;
}
