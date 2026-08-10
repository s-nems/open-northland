import type { ReadableVfs, Vfs, VfsEntry, VfsStat } from './types.js';
import { toPosix } from './vpath.js';

/**
 * Routes by first path segment(s) into root-relative sub-filesystems, e.g.
 * `{ '/game': pickedFolder, '/data': opfs }` - how the browser pipeline sees an input tree and its
 * output root as one file system. A write into a read-only mount is a routing failure, not an
 * adapter's.
 */
export function mountVfs(mounts: Readonly<Record<string, ReadableVfs>>): Vfs {
  const table = Object.entries(mounts)
    .map(([prefix, fs]) => ({ prefix: `/${toPosix(prefix).replace(/^\/+|\/+$/g, '')}`, fs }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  interface Routed {
    readonly fs: ReadableVfs;
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

  function isWritable(fs: ReadableVfs): fs is Vfs {
    return 'writeFile' in fs && 'mkdir' in fs && 'rm' in fs;
  }

  function routeWritable(path: string): { fs: Vfs; rel: string } {
    const { fs, rel } = route(path);
    if (!isWritable(fs)) throw new Error(`mount vfs: ${path} is on a read-only mount`);
    return { fs, rel };
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
      const { fs, rel } = routeWritable(path);
      return fs.writeFile(rel, data);
    },
    async mkdir(path: string): Promise<void> {
      const { fs, rel } = routeWritable(path);
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
      const { fs, rel } = routeWritable(path);
      return fs.rm(rel);
    },
  };
}
