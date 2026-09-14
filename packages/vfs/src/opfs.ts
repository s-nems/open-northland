import type { Vfs, VfsEntry, VfsStat } from './types.js';
import { normalizeRelPath, toPosix } from './vpath.js';

/** Browser adapter over the origin-private file system. */

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
        await writable.close();
      } catch (error) {
        // Closing an errored stream rejects with a TypeError of its own, which would hide the quota
        // failure the caller words for the visitor. Opening the handle already created the file, so
        // a failed write leaves an empty one behind.
        await writable.abort().catch(() => {});
        await fs.rm(path).catch(() => {});
        throw error;
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
      let segments: string[];
      try {
        segments = segmentsOf(path);
      } catch {
        return undefined;
      }
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
      let parent: FileSystemDirectoryHandle;
      try {
        parent = await dirOf(segments, false);
      } catch {
        return;
      }
      try {
        await parent.removeEntry(name, { recursive: true });
      } catch (error) {
        // `rm -rf` ignores absence; a browser refusing the delete is a failure the caller needs,
        // because reclaiming storage before a retry is the reason this is called at all.
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    },
  };
  return fs;
}
