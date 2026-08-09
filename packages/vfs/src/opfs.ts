import type { Vfs, VfsEntry, VfsStat } from './types.js';
import { normalizeRelPath, toPosix } from './vpath.js';

/** Browser adapters: the origin-private file system and read-only dropped-folder snapshots. */

function segmentsOf(path: string): string[] {
  const stripped = toPosix(path).replace(/^\/+/, '');
  if (stripped === '') return [];
  const normalized = normalizeRelPath(stripped);
  if (normalized === undefined) throw new Error(`opfs vfs: unusable path ${path}`);
  return normalized.split('/');
}

async function copyTree(fs: Vfs, from: string, to: string): Promise<void> {
  const info = await fs.stat(from);
  if (info === undefined) throw new Error(`opfs vfs: no entry ${from}`);
  if (info.kind === 'file') {
    await fs.writeFile(to, await fs.readFile(from));
    return;
  }
  await fs.mkdir(to);
  for (const entry of await fs.readdir(from)) {
    await copyTree(fs, `${from}/${entry.name}`, `${to}/${entry.name}`);
  }
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

    async rename(from: string, to: string): Promise<void> {
      // No cross-browser directory move exists, so a one-time copy-and-delete stands in.
      await copyTree(fs, from, to);
      await fs.rm(from);
    },
  };
  return fs;
}

/**
 * Read-only snapshot of a dropped or picked folder: keys are `/`-relative file paths inside it,
 * values the lazily-read `File`s. Structured-cloneable, so a page can hand it to a worker.
 */
export type FolderSnapshot = ReadonlyMap<string, File>;

export function fileMapVfs(files: FolderSnapshot): Vfs {
  function keyOf(path: string): string {
    return segmentsOf(path).join('/');
  }

  function isDir(key: string): boolean {
    if (key === '') return true;
    const prefix = `${key}/`;
    for (const file of files.keys()) if (file.startsWith(prefix)) return true;
    return false;
  }

  function fileAt(path: string): File {
    const file = files.get(keyOf(path));
    if (file === undefined) throw new Error(`dropped folder: no file ${path}`);
    return file;
  }

  const readOnly = (path: string): Promise<never> =>
    Promise.reject(new Error(`dropped folder: read-only, cannot write ${path}`));

  return {
    async readFile(path: string): Promise<Uint8Array> {
      return new Uint8Array(await fileAt(path).arrayBuffer());
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      return new Uint8Array(
        await fileAt(path)
          .slice(offset, offset + length)
          .arrayBuffer(),
      );
    },

    writeFile: readOnly,
    mkdir: readOnly,
    rm: readOnly,
    rename: readOnly,

    readdir(path: string): Promise<VfsEntry[]> {
      const key = keyOf(path);
      if (!isDir(key)) return Promise.reject(new Error(`dropped folder: no directory ${path}`));
      const prefix = key === '' ? '' : `${key}/`;
      const names = new Map<string, VfsEntry['kind']>();
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        names.set(rest.split('/')[0] ?? rest, rest.includes('/') ? 'dir' : 'file');
      }
      return Promise.resolve([...names].map(([name, kind]) => ({ name, kind })));
    },

    stat(path: string): Promise<VfsStat | undefined> {
      const key = keyOf(path);
      const file = files.get(key);
      if (file !== undefined) return Promise.resolve({ kind: 'file', size: file.size });
      return Promise.resolve(isDir(key) ? { kind: 'dir', size: 0 } : undefined);
    },
  };
}
