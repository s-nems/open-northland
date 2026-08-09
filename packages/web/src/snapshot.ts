import type { FolderSnapshot } from '@open-northland/vfs/opfs';

/**
 * Walks a picked or dropped game folder into a {@link FolderSnapshot}: keys are `/`-relative paths
 * inside the folder, values lazy `File` references. Only the listing happens eagerly; bytes are read
 * when the pipeline asks.
 */

export interface DroppedFolder {
  /** The folder's own name - the display identifier the setup page shows. */
  readonly name: string;
  readonly files: FolderSnapshot;
}

export async function snapshotDirectoryHandle(root: FileSystemDirectoryHandle): Promise<DroppedFolder> {
  const files = new Map<string, File>();
  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const handle of dir.values()) {
      const path = prefix === '' ? handle.name : `${prefix}/${handle.name}`;
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, path);
      } else {
        files.set(path, await (handle as FileSystemFileHandle).getFile());
      }
    }
  }
  await walk(root, '');
  return { name: root.name, files };
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

async function walkEntry(entry: FileSystemEntry, prefix: string, files: Map<string, File>): Promise<void> {
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
      await walkEntry(child, path, files);
    }
  } else if (entry.isFile) {
    files.set(path, await fileOfEntry(entry as FileSystemFileEntry));
  }
}

/**
 * A `webkitdirectory` file-input selection as a folder: `webkitRelativePath` spells
 * `FolderName/sub/file`, so the first segment names the folder and the rest keys the snapshot.
 */
export function snapshotFileList(files: ArrayLike<File>): DroppedFolder | undefined {
  const map = new Map<string, File>();
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

/**
 * The dropped game folder, or undefined when the drop carries no directory. A single dropped
 * directory becomes the snapshot root, so its own name never prefixes the keys.
 */
export async function snapshotDrop(transfer: DataTransfer): Promise<DroppedFolder | undefined> {
  for (const item of transfer.items) {
    const entry = item.webkitGetAsEntry();
    if (entry === null || !entry.isDirectory) continue;
    const files = new Map<string, File>();
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
      await walkEntry(child, '', files);
    }
    return { name: entry.name, files };
  }
  return undefined;
}
