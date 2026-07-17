import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverInstalledMod } from '../../src/mod-install/discover.js';
import { installCnMod } from '../../src/mod-install/install.js';
import { fetchStub, fileResponse } from '../support/fetch-stub.js';
import { makeTempDir, type TempDir } from '../support/temp-dir.js';
import { buildZip } from '../support/zip-fixture.js';

describe('installCnMod', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-install');
  });
  afterEach(() => tmp.cleanup());

  it('downloads, warns on an unknown hash, extracts, and moves the wrapped mod root into mods/', async () => {
    // The CnMod zip's shape in miniature: one wrapping version folder holding DataCnmd/.
    const zipBytes = buildZip([
      { name: 'CnMod 9.9.9/DataCnmd/types/houses.ini', data: new TextEncoder().encode('[housetype]\n') },
    ]);

    const fetchFn = fetchStub({
      'https://cn.example/download': () => fileResponse(zipBytes, 'https://cn.example/download'),
    });
    const modsDir = join(tmp.path, 'mods');
    const events: { kind: string }[] = [];
    const root = await installCnMod(modsDir, (e) => events.push(e), {
      fetchFn,
      url: 'https://cn.example/download',
    });
    expect(root).toBe(join(modsDir, 'CnMod 9.9.9'));
    expect(
      (await readFile(join(root, 'DataCnmd', 'types', 'houses.ini'), 'utf8')).startsWith('[housetype]'),
    ).toBe(true);
    // Not the pinned 1.3.1 bytes → the unverified-version warning fired, but the install succeeded.
    expect(events.some((e) => e.kind === 'mod-warning')).toBe(true);
    expect(await discoverInstalledMod(modsDir)).toBe(root);
  });
});
