import { readText, vjoin } from '@open-northland/vfs';
import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { discoverInstalledMod } from '../src/mod-install/discover.js';
import { installCnMod, type ModZipDownload } from '../src/mod-install/install.js';
import type { ModEvent } from '../src/shell-api.js';
import { buildZip } from './support/zip-fixture.js';

describe('installCnMod', () => {
  const MODS_DIR = 'mods';
  const HOUSES_INI = 'DataCnmd/types/houses.ini';

  const downloadOf =
    (fs: ReturnType<typeof memoryVfs>, zipBytes: Uint8Array, sha256: string | undefined): ModZipDownload =>
    async (destZip, onEvent) => {
      onEvent({ kind: 'mod-download', received: zipBytes.length, total: zipBytes.length });
      await fs.writeFile(destZip, zipBytes);
      return sha256;
    };

  // The CnMod zip's shape in miniature: one wrapping version folder holding DataCnmd/.
  const wrappedZip = (version: string): Uint8Array =>
    buildZip([{ name: `CnMod ${version}/${HOUSES_INI}`, data: new TextEncoder().encode('[housetype]\n') }]);

  it('downloads, warns on an unknown hash, and unpacks the wrapped mod root into mods/', async () => {
    const fs = memoryVfs();
    const events: ModEvent[] = [];
    const root = await installCnMod(
      fs,
      MODS_DIR,
      downloadOf(fs, wrappedZip('9.9.9'), 'not-the-pinned-hash'),
      (e) => events.push(e),
    );
    expect(root).toBe(vjoin(MODS_DIR, 'CnMod 9.9.9'));
    expect(await readText(fs, vjoin(root, HOUSES_INI))).toBe('[housetype]\n');
    // Not the pinned 1.3.1 bytes → the unverified-version warning fired, but the install succeeded.
    expect(events.some((e) => e.kind === 'mod-warning')).toBe(true);
    expect(await discoverInstalledMod(fs, MODS_DIR)).toBe(root);
    // No staging copy survives, and the archive is gone.
    expect((await fs.readdir(MODS_DIR)).map((e) => e.name)).toEqual(['CnMod 9.9.9']);
  });

  it('skips hash verification when the transport cannot hash, without warning', async () => {
    const fs = memoryVfs();
    const events: ModEvent[] = [];
    const root = await installCnMod(fs, MODS_DIR, downloadOf(fs, wrappedZip('1.0'), undefined), (e) =>
      events.push(e),
    );
    expect(root).toBe(vjoin(MODS_DIR, 'CnMod 1.0'));
    expect(events.some((e) => e.kind === 'mod-warning')).toBe(false);
  });

  it('installs an archive whose mod root is not wrapped in a version folder', async () => {
    const fs = memoryVfs();
    const zipBytes = buildZip([{ name: HOUSES_INI, data: new TextEncoder().encode('[housetype]\n') }]);
    const root = await installCnMod(fs, MODS_DIR, downloadOf(fs, zipBytes, undefined), () => {});
    expect(root).toBe(vjoin(MODS_DIR, 'CnMod'));
    expect(await readText(fs, vjoin(root, HOUSES_INI))).toBe('[housetype]\n');
  });

  it('leaves nothing discoverable when the archive carries no mod', async () => {
    const fs = memoryVfs();
    const zipBytes = buildZip([{ name: 'readme.txt', data: Uint8Array.of(1) }]);
    await expect(installCnMod(fs, MODS_DIR, downloadOf(fs, zipBytes, undefined), () => {})).rejects.toThrow(
      /no DataCnmd\//,
    );
    expect(await discoverInstalledMod(fs, MODS_DIR)).toBeUndefined();
    expect(await fs.readdir(MODS_DIR)).toEqual([]);
  });

  it('discards a half-written tree when extraction is aborted', async () => {
    const fs = memoryVfs();
    const controller = new AbortController();
    const zipBytes = buildZip([
      { name: `CnMod 1.0/${HOUSES_INI}`, data: new TextEncoder().encode('[housetype]\n') },
      { name: 'CnMod 1.0/DataCnmd/types/goods.ini', data: new TextEncoder().encode('[goodtype]\n') },
    ]);
    await expect(
      installCnMod(
        fs,
        MODS_DIR,
        downloadOf(fs, zipBytes, undefined),
        (event) => {
          if (event.kind === 'mod-extract') controller.abort();
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(await discoverInstalledMod(fs, MODS_DIR)).toBeUndefined();
    expect(await fs.readdir(MODS_DIR)).toEqual([]);
  });
});
