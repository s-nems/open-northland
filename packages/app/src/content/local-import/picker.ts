import { DEFAULT_IMPORT_LIMITS, MapImportError } from '@open-northland/map-import/input';
import { checkedLocalInput, type LocalMapFile, type LocalMapInput } from './input.js';

export class LocalPickError extends Error {}

export function pickedFolder(files: readonly File[]): LocalMapInput {
  const first = files[0];
  const name = first?.webkitRelativePath.split('/')[0];
  if (!name) throw new LocalPickError('empty');
  return checkedLocalInput({
    kind: 'folder',
    name,
    files: files.map((file) => ({
      path: file.webkitRelativePath.slice(name.length + 1),
      file,
    })),
  });
}

/** The picker must be clicked synchronously within the player's gesture. */
export function localFilePicker(
  folder: boolean,
  receive: (input: LocalMapInput) => void,
  failure: (error: unknown) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  if (folder) input.setAttribute('webkitdirectory', '');
  else input.accept = '.zip,.rar,.c2m,.exe';
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    try {
      const first = files[0];
      if (first === undefined) return;
      receive(
        folder ? pickedFolder(files) : checkedLocalInput({ kind: 'archive', name: first.name, file: first }),
      );
    } catch (error) {
      failure(error);
    }
  });
  return input;
}

/** Capture entries during the drop event; the data transfer is protected after that event returns. */
export async function droppedLocalInput(data: DataTransfer, signal: AbortSignal): Promise<LocalMapInput> {
  const items = Array.from(data.items).filter((item) => item.kind === 'file');
  if (items.length !== 1) throw new LocalPickError('one-input');
  const item = items[0];
  const entry = item?.webkitGetAsEntry?.();
  if (entry?.isDirectory) {
    const files: LocalMapFile[] = [];
    let count = 0;
    const visit = async (current: FileSystemEntry, path: string, depth: number): Promise<void> => {
      signal.throwIfAborted();
      if (++count > DEFAULT_IMPORT_LIMITS.entries || depth > DEFAULT_IMPORT_LIMITS.depth)
        throw new MapImportError('too-large', 'Dropped folder exceeds import limits');
      if (current.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (current as FileSystemFileEntry).file(resolve, reject),
        );
        files.push({ path, file });
        return;
      }
      const reader = (current as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await visit(child, path ? `${path}/${child.name}` : child.name, depth + 1);
      }
    };
    await visit(entry, '', 0);
    signal.throwIfAborted();
    return checkedLocalInput({ kind: 'folder', name: entry.name, files });
  }
  const file = item?.getAsFile();
  if (file === null || file === undefined) throw new LocalPickError('empty');
  return checkedLocalInput({ kind: 'archive', name: file.name, file });
}
