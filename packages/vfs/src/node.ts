import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Vfs, VfsEntry, VfsStat } from './types.js';

/** Passes paths straight to `node:fs`, so callers hand it native absolute roots. */
export function nodeVfs(): Vfs {
  return {
    readFile(path: string): Promise<Uint8Array> {
      return readFile(path);
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const handle = await open(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    async writeFile(path: string, data: Uint8Array): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },

    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },

    async readdir(path: string): Promise<VfsEntry[]> {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.flatMap((entry): VfsEntry[] => {
        if (entry.isFile()) return [{ name: entry.name, kind: 'file' }];
        if (entry.isDirectory()) return [{ name: entry.name, kind: 'dir' }];
        return [];
      });
    },

    async stat(path: string): Promise<VfsStat | undefined> {
      try {
        const info = await stat(path);
        if (info.isFile()) return { kind: 'file', size: info.size };
        if (info.isDirectory()) return { kind: 'dir', size: 0 };
        return undefined;
      } catch {
        return undefined;
      }
    },

    async rm(path: string): Promise<void> {
      await rm(path, { recursive: true, force: true });
    },

    async rename(from: string, to: string): Promise<void> {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
    },
  };
}
