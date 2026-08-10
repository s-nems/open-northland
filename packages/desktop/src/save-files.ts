import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shell } from 'electron';
import type { ListedSaveFile } from './ipc.js';

/**
 * The saves-folder operations behind the save-list IPC channels. Every argument crosses the bridge
 * untyped, so each operation validates its own inputs before touching the filesystem.
 */

/** Refuses absurd save reads and writes before they hit memory. The renderer's decode seam caps
 *  what a compressed save may inflate to at the same magnitude. */
export const MAX_SAVE_FILE_BYTES = 256 * 1024 * 1024;

/** Characters no cross-platform save filename may carry; the renderer sanitizes, main enforces. */
const INVALID_SAVE_NAME_CHARS = /[\\/:*?"<>|]/;
const CONTROL_CHAR_CEILING = 0x20;
/** Filesystem headroom rather than the renderer's shorter display cap, which main must never
 *  undercut: common filesystems stop a basename at 255 bytes and the writer appends `.json.gz`. */
const MAX_SAVE_NAME_LENGTH = 200;
/** Boundary-forced mirror of the renderer's list (`save-load/list-model.ts`). */
const SAVE_FILE_SUFFIXES = ['.json.gz', '.json', '.gz'] as const;

/** The file's leading bytes, enough for the renderer to peek the save header. */
const SAVE_PREFIX_BYTES = 64 * 1024;

function hasSaveSuffix(name: string): boolean {
  return SAVE_FILE_SUFFIXES.some((suffix) => name.length > suffix.length && name.endsWith(suffix));
}

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code < CONTROL_CHAR_CEILING) return true;
  }
  return false;
}

/** A display title the writer may turn into `<name>.json.gz`; never a path. */
function assertSaveName(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('expected a string argument');
  const invalid =
    value.length === 0 ||
    value.length > MAX_SAVE_NAME_LENGTH ||
    INVALID_SAVE_NAME_CHARS.test(value) ||
    hasControlChars(value);
  if (invalid) throw new Error('expected a plain save name');
}

/** A basename the saves listing could have produced; anything else never touches the filesystem. */
function assertSaveFileName(value: unknown): asserts value is string {
  assertSaveName(value);
  if (!hasSaveSuffix(value)) throw new Error('expected a save file name');
}

export function assertSaveBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error('expected save bytes');
}

async function filePrefix(path: string, length: number): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function listSaveFiles(savesDir: string): Promise<ListedSaveFile[]> {
  let names: string[];
  try {
    names = await readdir(savesDir);
  } catch {
    return []; // No save has been written yet.
  }
  const files: ListedSaveFile[] = [];
  for (const name of names) {
    if (!hasSaveSuffix(name)) continue;
    const path = join(savesDir, name);
    const info = await stat(path).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const prefix = await filePrefix(path, Math.min(info.size, SAVE_PREFIX_BYTES));
    files.push({ file: name, savedAt: Math.round(info.mtimeMs), prefix });
  }
  return files;
}

export async function readSaveFile(savesDir: string, file: unknown): Promise<Uint8Array | null> {
  assertSaveFileName(file);
  const path = join(savesDir, file);
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile()) return null;
  if (info.size > MAX_SAVE_FILE_BYTES) throw new Error('save exceeds the size limit');
  return readFile(path);
}

export async function writeSaveFile(savesDir: string, name: unknown, bytes: unknown): Promise<void> {
  assertSaveName(name);
  assertSaveBytes(bytes);
  if (bytes.byteLength > MAX_SAVE_FILE_BYTES) throw new Error('save exceeds the size limit');
  await mkdir(savesDir, { recursive: true });
  // Written beside the target and renamed over it: a write that dies on a full disk must not take
  // the save it was overwriting with it.
  const target = join(savesDir, `${name}.json.gz`);
  const staging = `${target}.part`;
  await writeFile(staging, bytes);
  try {
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { force: true });
    throw err;
  }
}

export async function deleteSaveFile(savesDir: string, file: unknown): Promise<void> {
  assertSaveFileName(file);
  await rm(join(savesDir, file), { force: true });
}

export async function revealSavesFolder(savesDir: string): Promise<void> {
  await mkdir(savesDir, { recursive: true });
  const failure = await shell.openPath(savesDir);
  if (failure !== '') throw new Error(failure);
}
