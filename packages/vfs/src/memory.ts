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
    return key === '' || dirs.has(key);
  }

  /** The nearest ancestor of `key` that is stored as a file, if any. Node refuses to put anything
   *  beneath a file; the test adapter has to refuse it too or it hides the failure. */
  function fileAncestorOf(key: string): string | undefined {
    for (let cut = key.indexOf('/'); cut >= 0; cut = key.indexOf('/', cut + 1)) {
      const ancestor = key.slice(0, cut);
      if (files.has(ancestor)) return ancestor;
    }
    return undefined;
  }

  function addDirWithAncestors(key: string): void {
    let current = key;
    while (current !== '') {
      dirs.add(current);
      const cut = current.lastIndexOf('/');
      current = cut < 0 ? '' : current.slice(0, cut);
    }
  }

  function readFile(path: string): Promise<Uint8Array> {
    const data = files.get(keyOf(path));
    if (data === undefined) return Promise.reject(new Error(`memory vfs: no file ${path}`));
    // A copy both ways: writeFile detaches from the caller, readFile from the store.
    return Promise.resolve(Uint8Array.from(data));
  }

  return {
    readFile,

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const data = await readFile(path);
      return data.subarray(offset, offset + length);
    },

    writeFile(path: string, data: Uint8Array): Promise<void> {
      const key = keyOf(path);
      if (key === '' || isDir(key)) return Promise.reject(new Error(`memory vfs: ${path} is a directory`));
      const blocking = fileAncestorOf(key);
      if (blocking !== undefined) {
        return Promise.reject(new Error(`memory vfs: ${blocking} is a file, not a directory`));
      }
      const cut = key.lastIndexOf('/');
      if (cut >= 0) addDirWithAncestors(key.slice(0, cut));
      files.set(key, Uint8Array.from(data));
      return Promise.resolve();
    },

    mkdir(path: string): Promise<void> {
      const key = keyOf(path);
      const blocking = files.has(key) ? key : fileAncestorOf(key);
      if (blocking !== undefined) {
        return Promise.reject(new Error(`memory vfs: ${blocking} is a file, not a directory`));
      }
      addDirWithAncestors(key);
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
      let key: string;
      try {
        key = keyOf(path);
      } catch {
        return Promise.resolve(undefined);
      }
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
