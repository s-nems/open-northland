export interface VfsEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

export interface VfsStat {
  readonly kind: 'file' | 'dir';
  readonly size: number;
}

/** Consumers that never write take this, so a read-only adapter satisfies them by type rather than
 *  by rejecting at runtime. */
export interface ReadableVfs {
  /** Rejects when the file is absent. */
  readFile(path: string): Promise<Uint8Array>;
  /** Bytes `[offset, offset + length)` of a file - the zip reader's random access. */
  readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** Rejects when the directory is absent. */
  readdir(path: string): Promise<VfsEntry[]>;
  /** `undefined` when nothing exists at `path`, including a path this adapter cannot address. */
  stat(path: string): Promise<VfsStat | undefined>;
}

export interface Vfs extends ReadableVfs {
  /** Creates missing parent directories. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Recursive; an existing directory is a no-op. */
  mkdir(path: string): Promise<void>;
  /** `rm -rf` semantics: recursive, and an absent path is a no-op. */
  rm(path: string): Promise<void>;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function readText(fs: ReadableVfs, path: string): Promise<string> {
  return decoder.decode(await fs.readFile(path));
}

export async function writeText(fs: Vfs, path: string, text: string): Promise<void> {
  await fs.writeFile(path, encoder.encode(text));
}
