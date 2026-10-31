import { errorMessage, MapImportError } from '../errors.js';
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from '../limits.js';
import { type MapTree, TreeBuilder } from '../tree.js';
import { unpackC2m } from './c2m.js';
import {
  type ArchiveFormat,
  assertArchiveSize,
  detectArchiveFormat,
  fillTree,
  type Unpack,
} from './entries.js';

export { detectArchiveFormat };

import { unpackNsis } from './nsis.js';
import { unpackRar } from './rar.js';
import { unpackTar } from './tar.js';
import { unpackZip } from './zip.js';

export interface OpenOptions {
  readonly limits?: ImportLimits;
  /** The `node-unrar-js` binary or its loader, called only for RAR and once per archive tree. */
  readonly unrarWasm?: ArrayBuffer | (() => Promise<ArrayBuffer>);
  /** Names the archive in failure messages. */
  readonly name?: string;
}

function unpackers(options: OpenOptions): (format: ArchiveFormat) => Unpack {
  let wasm: Promise<ArrayBuffer> | undefined;
  const loadWasm = async (): Promise<ArrayBuffer> => {
    try {
      const source = options.unrarWasm;
      if (source === undefined) throw new Error('no unrar wasm given');
      wasm ??= typeof source === 'function' ? source() : Promise.resolve(source);
      return await wasm;
    } catch (err) {
      throw new MapImportError('unsupported-archive', `rar: ${errorMessage(err)}`);
    }
  };
  return (format) => {
    switch (format) {
      case 'zip':
        return unpackZip;
      case 'c2m':
        return unpackC2m;
      case 'tar':
        return unpackTar;
      case 'nsis':
        return unpackNsis;
      case 'rar':
        return async (bytes, builder, keep) => unpackRar(bytes, builder, keep, await loadWasm());
    }
  };
}

async function open(bytes: Uint8Array, format: ArchiveFormat, options: OpenOptions): Promise<MapTree> {
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;
  const source = options.name ?? format;
  assertArchiveSize(bytes, limits, source);
  const builder = new TreeBuilder(limits, source);
  await fillTree(bytes, format, builder, unpackers(options));
  return builder.build();
}

/** The map files of a zip, nested `.c2m`/`.rar`/`.tar`/`.zip` entries opened one level deep. */
export function openZip(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'zip', options);
}

/** The map files of a RAR4 or RAR5 archive; `wasm` is the `node-unrar-js` binary. */
export function openRar(bytes: Uint8Array, wasm: ArrayBuffer, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'rar', { ...options, unrarWasm: wasm });
}

/** The map files of a map editor `.c2m` export, rooted where its map folder was. */
export function openC2m(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'c2m', options);
}

/** The map files of a community setup's NSIS installer, rooted at its install directory. */
export function openNsis(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  return open(bytes, 'nsis', options);
}

/** Opens a zip, rar, c2m, plain tar or NSIS setup installer, told apart by their leading bytes or the
 *  tar's ustar magic. */
export function openArchive(bytes: Uint8Array, options: OpenOptions = {}): Promise<MapTree> {
  const format = detectArchiveFormat(bytes);
  if (format === undefined) {
    return Promise.reject(
      new MapImportError(
        'unsupported-archive',
        `${options.name ?? 'archive'}: not a zip, rar, c2m, tar or NSIS installer`,
      ),
    );
  }
  return open(bytes, format, options);
}
