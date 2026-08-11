import type { SnapshotFile } from '@open-northland/vfs/opfs';
import type { PickedFolder } from './shell-api.js';

/** Browser folder acquisition for the setup page: a directory handle, a `webkitdirectory` input, or
 *  a drop, each yielding the snapshot the shell hands on. */

export async function snapshotDirectoryHandle(root: FileSystemDirectoryHandle): Promise<PickedFolder> {
  const files = new Map<string, SnapshotFile>();
  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const handle of dir.values()) {
      const path = prefix === '' ? handle.name : `${prefix}/${handle.name}`;
      if (handle.kind === 'directory') {
        await walk(handle, path);
      } else {
        files.set(path, handle);
      }
    }
  }
  await walk(root, '');
  return { name: root.name, files };
}

/**
 * A `webkitdirectory` file-input selection as a folder: `webkitRelativePath` spells
 * `FolderName/sub/file`, so the first segment names the folder and the rest keys the snapshot.
 */
export function snapshotFileList(files: ArrayLike<File>): PickedFolder | undefined {
  const map = new Map<string, SnapshotFile>();
  let name: string | undefined;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file === undefined) continue;
    const rel = file.webkitRelativePath;
    const cut = rel.indexOf('/');
    if (cut <= 0) continue;
    name ??= rel.slice(0, cut);
    if (rel.slice(0, cut) !== name) continue;
    map.set(rel.slice(cut + 1), file);
  }
  return name === undefined ? undefined : { name, files: map };
}

/** Directory batches arrive ~100 entries per `readEntries` call, so drain until an empty batch. */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const step = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        step();
      }, reject);
    };
    step();
  });
}

function fileOfEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  files: Map<string, SnapshotFile>,
): Promise<void> {
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
      await walkEntry(child, path, files);
    }
  } else if (entry.isFile) {
    files.set(path, await fileOfEntry(entry as FileSystemFileEntry));
  }
}

/** `getAsFileSystemHandle` is the Chromium path and keeps the folder lazy; the legacy entry walk is
 *  the fallback everywhere else. */
interface HandleDataTransferItem extends DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

async function folderOfEntry(entry: FileSystemEntry): Promise<PickedFolder> {
  const files = new Map<string, SnapshotFile>();
  for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
    await walkEntry(child, '', files);
  }
  return { name: entry.name, files };
}

/**
 * The dropped game folder, or undefined when the drop carries no directory. A single dropped
 * directory becomes the snapshot root, so its own name never prefixes the keys.
 */
export function snapshotDrop(transfer: DataTransfer): Promise<PickedFolder | undefined> {
  // A DataTransfer's items are only readable while the drop event dispatches, so every accessor
  // runs before the first await.
  const handles: Promise<FileSystemHandle | null>[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of transfer.items) {
    const asHandle = (item as HandleDataTransferItem).getAsFileSystemHandle?.();
    if (asHandle !== undefined) {
      handles.push(asHandle);
      continue;
    }
    const entry = item.webkitGetAsEntry();
    if (entry !== null) entries.push(entry);
  }
  return firstPickedFolder(handles, entries);
}

async function firstPickedFolder(
  handles: readonly Promise<FileSystemHandle | null>[],
  entries: readonly FileSystemEntry[],
): Promise<PickedFolder | undefined> {
  for (const pending of handles) {
    const handle = await pending;
    if (handle?.kind === 'directory') return snapshotDirectoryHandle(handle as FileSystemDirectoryHandle);
  }
  for (const entry of entries) {
    if (entry.isDirectory) return folderOfEntry(entry);
  }
  return undefined;
}
