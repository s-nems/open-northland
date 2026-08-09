import type { Vfs, VfsEntry, VfsStat } from './types.js';
import { toPosix } from './vpath.js';

/**
 * Routes by first path segment(s) into root-relative sub-filesystems, e.g.
 * `{ '/game': droppedFolder, '/data': opfs }` - how the browser pipeline sees an input tree and its
 * output root as one file system. Renames cannot cross mounts.
 */
export function mountVfs(mounts: Readonly<Record<string, Vfs>>): Vfs {
  const table = Object.entries(mounts)
    .map(([prefix, fs]) => ({ prefix: `/${toPosix(prefix).replace(/^\/+|\/+$/g, '')}`, fs }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  interface Routed {
    readonly fs: Vfs;
    readonly rel: string;
  }

  function route(path: string): Routed {
    const posix = `/${toPosix(path).replace(/^\/+/, '')}`;
    for (const { prefix, fs } of table) {
      if (posix === prefix) return { fs, rel: '' };
      if (posix.startsWith(`${prefix}/`)) return { fs, rel: posix.slice(prefix.length + 1) };
    }
    throw new Error(`mount vfs: ${path} is outside every mount`);
  }

  return {
    async readFile(path: string): Promise<Uint8Array> {
      const { fs, rel } = route(path);
      return fs.readFile(rel);
    },
    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const { fs, rel } = route(path);
      return fs.readFileSlice(rel, offset, length);
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const { fs, rel } = route(path);
      return fs.writeFile(rel, data);
    },
    async mkdir(path: string): Promise<void> {
      const { fs, rel } = route(path);
      return fs.mkdir(rel);
    },
    async readdir(path: string): Promise<VfsEntry[]> {
      const { fs, rel } = route(path);
      return fs.readdir(rel);
    },
    async stat(path: string): Promise<VfsStat | undefined> {
      const { fs, rel } = route(path);
      return fs.stat(rel);
    },
    async rm(path: string): Promise<void> {
      const { fs, rel } = route(path);
      return fs.rm(rel);
    },
    async rename(from: string, to: string): Promise<void> {
      const source = route(from);
      const target = route(to);
      if (source.fs !== target.fs) {
        throw new Error(`mount vfs: cannot rename ${from} across mounts to ${to}`);
      }
      return source.fs.rename(source.rel, target.rel);
    },
  };
}
