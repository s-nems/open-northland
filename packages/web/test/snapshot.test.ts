import { describe, expect, it } from 'vitest';
import { snapshotFileList } from '../src/snapshot.js';

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
