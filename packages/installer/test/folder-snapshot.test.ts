import { describe, expect, it } from 'vitest';
import { snapshotDirectoryHandle, snapshotDrop, snapshotFileList } from '../src/folder-snapshot.js';

function fakeDirFile(webkitRelativePath: string): File {
  const name = webkitRelativePath.split('/').at(-1) ?? webkitRelativePath;
  const file = new File([Uint8Array.of(1)], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath });
  return file;
}

describe('snapshotFileList', () => {
  it('strips the picked folder name off every key', () => {
    const folder = snapshotFileList([
      fakeDirFile('Cultures 8th Wonder/Game.exe'),
      fakeDirFile('Cultures 8th Wonder/DataX/Libs/data0001.lib'),
    ]);
    expect(folder?.name).toBe('Cultures 8th Wonder');
    expect([...(folder?.files.keys() ?? [])]).toEqual(['Game.exe', 'DataX/Libs/data0001.lib']);
  });

  it('ignores stray files outside the first folder and empty selections', () => {
    const folder = snapshotFileList([
      fakeDirFile('GameDir/a.txt'),
      fakeDirFile('OtherDir/b.txt'),
      fakeDirFile('loose.txt'),
    ]);
    expect(folder?.name).toBe('GameDir');
    expect([...(folder?.files.keys() ?? [])]).toEqual(['a.txt']);
    expect(snapshotFileList([])).toBeUndefined();
  });
});

interface FakeTree {
  readonly [name: string]: FakeTree | 'file';
}

function fakeDirHandle(name: string, tree: FakeTree, opened: string[]): FileSystemDirectoryHandle {
  const children = Object.entries(tree).map(([child, value]) =>
    value === 'file'
      ? ({
          kind: 'file',
          name: child,
          getFile: () => {
            opened.push(child);
            return Promise.resolve(new File([Uint8Array.of(1)], child));
          },
        } as unknown as FileSystemFileHandle)
      : fakeDirHandle(child, value, opened),
  );
  return {
    kind: 'directory',
    name,
    values: (): AsyncIterableIterator<FileSystemHandle> => {
      const iterator = children[Symbol.iterator]();
      return {
        next: (): Promise<IteratorResult<FileSystemHandle>> => Promise.resolve(iterator.next()),
        [Symbol.asyncIterator](): AsyncIterableIterator<FileSystemHandle> {
          return this;
        },
      } as AsyncIterableIterator<FileSystemHandle>;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('snapshotDirectoryHandle', () => {
  it('keys the tree by folder-relative path without materializing any file', async () => {
    const opened: string[] = [];
    const handle = fakeDirHandle(
      'Cultures 8th Wonder',
      { 'Game.exe': 'file', DataX: { Libs: { 'data0001.lib': 'file' } } },
      opened,
    );
    const folder = await snapshotDirectoryHandle(handle);
    expect(folder.name).toBe('Cultures 8th Wonder');
    expect([...folder.files.keys()].sort()).toEqual(['DataX/Libs/data0001.lib', 'Game.exe']);
    expect(opened).toEqual([]);
  });
});

describe('snapshotDrop', () => {
  /** A drop's items stop being readable once the event finishes dispatching, which the first await
   *  models here: an implementation that awaits mid-loop loses the later items. */
  function fakeTransfer(handles: readonly (FileSystemHandle | null)[]): DataTransfer {
    let dispatched = true;
    const items = handles.map((handle) => ({
      getAsFileSystemHandle: (): Promise<FileSystemHandle | null> => {
        if (!dispatched) throw new Error('DataTransferItem read after the drop event');
        return Promise.resolve(handle).then((value) => {
          dispatched = false;
          return value;
        });
      },
    }));
    return { items } as unknown as DataTransfer;
  }

  it('takes the first dropped directory, reading every item before it awaits', async () => {
    const opened: string[] = [];
    const file = { kind: 'file', name: 'notes.txt' } as unknown as FileSystemHandle;
    const dir = fakeDirHandle('Game', { 'Game.exe': 'file' }, opened);
    const folder = await snapshotDrop(fakeTransfer([file, dir]));
    expect(folder?.name).toBe('Game');
    expect([...(folder?.files.keys() ?? [])]).toEqual(['Game.exe']);
  });

  it('is undefined when the drop carries no directory', async () => {
    const file = { kind: 'file', name: 'notes.txt' } as unknown as FileSystemHandle;
    expect(await snapshotDrop(fakeTransfer([file]))).toBeUndefined();
  });
});
