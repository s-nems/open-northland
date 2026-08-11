/** In-memory FileSystemDirectoryHandle mimic, so the OPFS adapter joins the Node-run contract suite. */

class DirNode {
  readonly dirs = new Map<string, DirNode>();
  readonly files = new Map<string, Uint8Array>();
}

export interface FakeOpfsOptions {
  /** Rejects every write once this many have succeeded, the way a full origin does. */
  readonly quotaAfterWrites?: number;
}

interface Quota {
  written: number;
  readonly limit: number;
}

interface FakeWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FakeFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FakeWritable>;
}

interface FakeDirHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncGenerator<FakeDirHandle | FakeFileHandle>;
}

function fileHandleOf(node: DirNode, name: string, quota: Quota): FakeFileHandle {
  return {
    kind: 'file',
    name,
    getFile(): Promise<File> {
      const bytes = node.files.get(name);
      if (bytes === undefined) return Promise.reject(new Error(`fake opfs: file ${name} vanished`));
      return Promise.resolve(new File([Uint8Array.from(bytes) as unknown as BlobPart], name));
    },
    createWritable(): Promise<FakeWritable> {
      const chunks: Uint8Array[] = [];
      let errored = false;
      // Per the Streams standard, closing an errored writable rejects with a TypeError of its own.
      const closed = (): Promise<never> => Promise.reject(new TypeError('fake opfs: stream closed'));
      return Promise.resolve({
        write(data: Uint8Array): Promise<void> {
          if (quota.written >= quota.limit) {
            errored = true;
            return Promise.reject(new DOMException('fake opfs: quota', 'QuotaExceededError'));
          }
          quota.written++;
          chunks.push(Uint8Array.from(data));
          return Promise.resolve();
        },
        close(): Promise<void> {
          if (errored) return closed();
          const total = chunks.reduce((sum, c) => sum + c.length, 0);
          const out = new Uint8Array(total);
          let at = 0;
          for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.length;
          }
          node.files.set(name, out);
          return Promise.resolve();
        },
        abort(): Promise<void> {
          return Promise.resolve();
        },
      });
    },
  };
}

function dirHandleOf(node: DirNode, name: string, quota: Quota): FakeDirHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle(child: string, options?: { create?: boolean }): Promise<FakeDirHandle> {
      let next = node.dirs.get(child);
      if (next === undefined) {
        if (options?.create !== true || node.files.has(child)) {
          return Promise.reject(new Error(`fake opfs: no directory ${child}`));
        }
        next = new DirNode();
        node.dirs.set(child, next);
      }
      return Promise.resolve(dirHandleOf(next, child, quota));
    },
    getFileHandle(child: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
      if (!node.files.has(child)) {
        if (options?.create !== true || node.dirs.has(child)) {
          return Promise.reject(new Error(`fake opfs: no file ${child}`));
        }
        node.files.set(child, new Uint8Array(0));
      }
      return Promise.resolve(fileHandleOf(node, child, quota));
    },
    removeEntry(child: string): Promise<void> {
      if (node.files.delete(child) || node.dirs.delete(child)) return Promise.resolve();
      return Promise.reject(new DOMException(`fake opfs: no entry ${child}`, 'NotFoundError'));
    },
    async *values(): AsyncGenerator<FakeDirHandle | FakeFileHandle> {
      for (const [childName, child] of node.dirs) yield dirHandleOf(child, childName, quota);
      for (const childName of node.files.keys()) yield fileHandleOf(node, childName, quota);
    },
  };
}

export function fakeOpfsRoot(options?: FakeOpfsOptions): FileSystemDirectoryHandle {
  const quota: Quota = { written: 0, limit: options?.quotaAfterWrites ?? Number.POSITIVE_INFINITY };
  return dirHandleOf(new DirNode(), '', quota) as unknown as FileSystemDirectoryHandle;
}
