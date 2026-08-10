import type { ReadableVfs, Vfs, VfsEntry, VfsStat } from './types.js';
import { normalizeRelPath, toPosix } from './vpath.js';

/** Browser adapters: the origin-private file system and read-only picked-folder snapshots. */

function segmentsOf(path: string): string[] {
  const stripped = toPosix(path).replace(/^\/+/, '');
  if (stripped === '') return [];
  const normalized = normalizeRelPath(stripped);
  if (normalized === undefined) throw new Error(`opfs vfs: unusable path ${path}`);
  return normalized.split('/');
}

/** Read-write adapter over a directory handle, typically `navigator.storage.getDirectory()`. */
export function opfsVfs(root: FileSystemDirectoryHandle): Vfs {
  async function dirOf(segments: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let current = root;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  async function fileOf(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const segments = segmentsOf(path);
    const name = segments.pop();
    if (name === undefined) throw new Error(`opfs vfs: ${path} is the root, not a file`);
    const parent = await dirOf(segments, create);
    return parent.getFileHandle(name, { create });
  }

  const fs: Vfs = {
    async readFile(path: string): Promise<Uint8Array> {
      const file = await (await fileOf(path, false)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const file = await (await fileOf(path, false)).getFile();
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },

    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const writable = await (await fileOf(path, true)).createWritable();
      try {
        // A SharedArrayBuffer-backed view is not a BlobPart; copying also detaches nothing.
        await writable.write(Uint8Array.from(data));
      } finally {
        await writable.close();
      }
    },

    async mkdir(path: string): Promise<void> {
      await dirOf(segmentsOf(path), true);
    },

    async readdir(path: string): Promise<VfsEntry[]> {
      const dir = await dirOf(segmentsOf(path), false);
      const entries: VfsEntry[] = [];
      for await (const handle of dir.values()) {
        entries.push({ name: handle.name, kind: handle.kind === 'file' ? 'file' : 'dir' });
      }
      return entries;
    },

    async stat(path: string): Promise<VfsStat | undefined> {
      const segments = segmentsOf(path);
      const name = segments.pop();
      let parent: FileSystemDirectoryHandle;
      try {
        parent = await dirOf(segments, false);
      } catch {
        return undefined;
      }
      if (name === undefined) return { kind: 'dir', size: 0 };
      try {
        const file = await (await parent.getFileHandle(name)).getFile();
        return { kind: 'file', size: file.size };
      } catch {
        // Not a file; fall through to the directory probe.
      }
      try {
        await parent.getDirectoryHandle(name);
        return { kind: 'dir', size: 0 };
      } catch {
        return undefined;
      }
    },

    async rm(path: string): Promise<void> {
      const segments = segmentsOf(path);
      const name = segments.pop();
      if (name === undefined) {
        for (const entry of await fs.readdir('')) {
          await root.removeEntry(entry.name, { recursive: true });
        }
        return;
      }
      try {
        const parent = await dirOf(segments, false);
        await parent.removeEntry(name, { recursive: true });
      } catch {
        // rm -rf semantics: an absent path or parent is a no-op.
      }
    },
  };
  return fs;
}

/**
 * A picked folder's file, kept unresolved where the browser offers a handle: materializing every
 * `File` up front costs one main-thread round trip per file, and a game folder holds ~44k of them.
 */
export type SnapshotFile = File | FileSystemFileHandle;

/**
 * Read-only snapshot of a picked or dropped folder: keys are `/`-relative file paths inside it.
 * Structured-cloneable, so a page can hand it to a worker.
 */
export type FolderSnapshot = ReadonlyMap<string, SnapshotFile>;

type Children = Map<string, VfsEntry['kind']>;

/** One pass over the keys, so `readdir` and directory `stat` cost a lookup instead of a full scan. */
function directoryIndex(files: FolderSnapshot): Map<string, Children> {
  const dirs = new Map<string, Children>();
  const childrenOf = (dir: string): Children => {
    const existing = dirs.get(dir);
    if (existing !== undefined) return existing;
    const created: Children = new Map();
    dirs.set(dir, created);
    return created;
  };
  childrenOf('');
  for (const key of files.keys()) {
    let parent = '';
    let at = 0;
    for (;;) {
      const cut = key.indexOf('/', at);
      if (cut < 0) {
        childrenOf(parent).set(key.slice(at), 'file');
        break;
      }
      const name = key.slice(at, cut);
      childrenOf(parent).set(name, 'dir');
      parent = parent === '' ? name : `${parent}/${name}`;
      childrenOf(parent);
      at = cut + 1;
    }
  }
  return dirs;
}

export function fileMapVfs(files: FolderSnapshot): ReadableVfs {
  const dirs = directoryIndex(files);

  function keyOf(path: string): string {
    return segmentsOf(path).join('/');
  }

  async function fileAt(path: string): Promise<File> {
    const entry = files.get(keyOf(path));
    if (entry === undefined) throw new Error(`picked folder: no file ${path}`);
    return entry instanceof File ? entry : entry.getFile();
  }

  return {
    async readFile(path: string): Promise<Uint8Array> {
      return new Uint8Array(await (await fileAt(path)).arrayBuffer());
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const file = await fileAt(path);
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },

    readdir(path: string): Promise<VfsEntry[]> {
      const children = dirs.get(keyOf(path));
      if (children === undefined) return Promise.reject(new Error(`picked folder: no directory ${path}`));
      return Promise.resolve([...children].map(([name, kind]) => ({ name, kind })));
    },

    async stat(path: string): Promise<VfsStat | undefined> {
      const key = keyOf(path);
      const entry = files.get(key);
      if (entry !== undefined) {
        const file = entry instanceof File ? entry : await entry.getFile();
        return { kind: 'file', size: file.size };
      }
      return dirs.has(key) ? { kind: 'dir', size: 0 } : undefined;
    },
  };
}
