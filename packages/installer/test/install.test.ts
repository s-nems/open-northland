import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vjoin } from '@open-northland/vfs';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverInstalledMod } from '../src/mod-install/discover.js';
import { installCnMod, type ModZipDownload } from '../src/mod-install/install.js';
import type { ModEvent } from '../src/shell-api.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';
import { buildZip } from './support/zip-fixture.js';

describe('installCnMod', () => {
  const fs = nodeVfs();
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-install');
  });
  afterEach(() => tmp.cleanup());

  const downloadOf =
    (zipBytes: Uint8Array, sha256: string | undefined): ModZipDownload =>
    async (destZip, onEvent) => {
      onEvent({ kind: 'mod-download', received: zipBytes.length, total: zipBytes.length });
      await fs.writeFile(destZip, zipBytes);
      return sha256;
    };

  it('downloads, warns on an unknown hash, extracts, and moves the wrapped mod root into mods/', async () => {
    // The CnMod zip's shape in miniature: one wrapping version folder holding DataCnmd/.
    const zipBytes = buildZip([
      { name: 'CnMod 9.9.9/DataCnmd/types/houses.ini', data: new TextEncoder().encode('[housetype]\n') },
    ]);
    const modsDir = join(tmp.path, 'mods');
    const events: ModEvent[] = [];
    const root = await installCnMod(fs, modsDir, downloadOf(zipBytes, 'not-the-pinned-hash'), (e) =>
      events.push(e),
    );
    expect(root).toBe(vjoin(modsDir, 'CnMod 9.9.9'));
    expect(
      (await readFile(join(root, 'DataCnmd', 'types', 'houses.ini'), 'utf8')).startsWith('[housetype]'),
    ).toBe(true);
    // Not the pinned 1.3.1 bytes → the unverified-version warning fired, but the install succeeded.
    expect(events.some((e) => e.kind === 'mod-warning')).toBe(true);
    expect(await discoverInstalledMod(fs, modsDir)).toBe(root);
  });

  it('skips hash verification when the transport cannot hash, without warning', async () => {
    const zipBytes = buildZip([
      { name: 'CnMod 1.0/DataCnmd/types/houses.ini', data: new TextEncoder().encode('[housetype]\n') },
    ]);
    const modsDir = join(tmp.path, 'mods');
    const events: ModEvent[] = [];
    const root = await installCnMod(fs, modsDir, downloadOf(zipBytes, undefined), (e) => events.push(e));
    expect(root).toBe(vjoin(modsDir, 'CnMod 1.0'));
    expect(events.some((e) => e.kind === 'mod-warning')).toBe(false);
  });
});
