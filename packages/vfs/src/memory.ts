import type { Vfs, VfsEntry, VfsStat } from './types.js';
import { normalizeRelPath, toPosix } from './vpath.js';

/** In-memory adapter for tests; paths are root-relative. */
export function memoryVfs(): Vfs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();

  function keyOf(path: string): string {
    const stripped = toPosix(path).replace(/^\/+/, '');
    if (stripped === '') return '';
    const key = normalizeRelPath(stripped);
    if (key === undefined) throw new Error(`memory vfs: unusable path ${path}`);
    return key;
  }

  function isDir(key: string): boolean {
    if (key === '' || dirs.has(key)) return true;
    const prefix = `${key}/`;
    for (const file of files.keys()) if (file.startsWith(prefix)) return true;
    for (const dir of dirs) if (dir.startsWith(prefix)) return true;
    return false;
  }

  function addDirWithAncestors(key: string): void {
    let current = key;
    while (current !== '') {
      dirs.add(current);
      const cut = current.lastIndexOf('/');
      current = cut < 0 ? '' : current.slice(0, cut);
    }
  }

  return {
    readFile(path: string): Promise<Uint8Array> {
      const data = files.get(keyOf(path));
      if (data === undefined) return Promise.reject(new Error(`memory vfs: no file ${path}`));
      // A copy both ways: writeFile detaches from the caller, readFile from the store.
      return Promise.resolve(Uint8Array.from(data));
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const data = await this.readFile(path);
      return data.subarray(offset, offset + length);
    },

    writeFile(path: string, data: Uint8Array): Promise<void> {
      const key = keyOf(path);
      if (key === '' || isDir(key)) return Promise.reject(new Error(`memory vfs: ${path} is a directory`));
      const cut = key.lastIndexOf('/');
      if (cut >= 0) addDirWithAncestors(key.slice(0, cut));
      files.set(key, Uint8Array.from(data));
      return Promise.resolve();
    },

    mkdir(path: string): Promise<void> {
      addDirWithAncestors(keyOf(path));
      return Promise.resolve();
    },

    readdir(path: string): Promise<VfsEntry[]> {
      const key = keyOf(path);
      if (files.has(key)) return Promise.reject(new Error(`memory vfs: ${path} is a file`));
      if (!isDir(key)) return Promise.reject(new Error(`memory vfs: no directory ${path}`));
      const prefix = key === '' ? '' : `${key}/`;
      const names = new Map<string, VfsEntry['kind']>();
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const name = rest.split('/')[0] ?? rest;
        names.set(name, rest.includes('/') ? 'dir' : 'file');
      }
      for (const dir of dirs) {
        if (dir === key || !dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        names.set(rest.split('/')[0] ?? rest, 'dir');
      }
      return Promise.resolve([...names].map(([name, kind]) => ({ name, kind })));
    },

    stat(path: string): Promise<VfsStat | undefined> {
      const key = keyOf(path);
      const data = files.get(key);
      if (data !== undefined) return Promise.resolve({ kind: 'file', size: data.byteLength });
      return Promise.resolve(isDir(key) ? { kind: 'dir', size: 0 } : undefined);
    },

    rm(path: string): Promise<void> {
      const key = keyOf(path);
      const prefix = key === '' ? '' : `${key}/`;
      for (const file of [...files.keys()]) {
        if (file === key || file.startsWith(prefix)) files.delete(file);
      }
      for (const dir of [...dirs]) {
        if (dir === key || dir.startsWith(prefix)) dirs.delete(dir);
      }
      return Promise.resolve();
    },
  };
}
