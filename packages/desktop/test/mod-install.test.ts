import { mkdir, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverInstalledMod,
  downloadCnModZip,
  findModRootUnder,
  installCnMod,
  parseDriveConfirmUrl,
  parseDriveFileId,
  zipMemberRelPath,
} from '../src/mod-install.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';
import { buildZip } from './support/zip-fixture.js';

describe('drive URL parsing', () => {
  it('extracts the file id from a drive file-page URL', () => {
    expect(
      parseDriveFileId(
        'https://drive.google.com/file/d/1m0m00ywvKjJwdHiOnPA77avuaM239-e_/view?usp=drive_link',
      ),
    ).toBe('1m0m00ywvKjJwdHiOnPA77avuaM239-e_');
    expect(parseDriveFileId('https://culturesnation.pl/news.php')).toBeUndefined();
  });

  it('replays the confirm form fields as query params on the form action', () => {
    // Shape observed on the live drive.usercontent.google.com interstitial (2026-07).
    const html =
      '<form action="https://drive.usercontent.google.com/download" method="get">' +
      '<input type="hidden" name="id" value="FILE"><input type="hidden" name="export" value="download">' +
      '<input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="U-1"></form>';
    expect(parseDriveConfirmUrl(html)).toBe(
      'https://drive.usercontent.google.com/download?id=FILE&export=download&confirm=t&uuid=U-1',
    );
    expect(parseDriveConfirmUrl('<html><body>quota exceeded</body></html>')).toBeUndefined();
  });
});

describe('zipMemberRelPath', () => {
  it('keeps normal member paths and rejects escapes', () => {
    expect(zipMemberRelPath('CnMod 1.3.1/DataCnmd/types/houses.ini')).toBe(
      ['CnMod 1.3.1', 'DataCnmd', 'types', 'houses.ini'].join(sep),
    );
    expect(zipMemberRelPath('../evil')).toBeUndefined();
    expect(zipMemberRelPath('/abs')).toBeUndefined();
    expect(zipMemberRelPath('')).toBeUndefined();
  });
});

describe('mod root discovery', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-discovery');
  });
  afterEach(() => tmp.cleanup());

  it('finds the root at the dir itself or one level below, else undefined', async () => {
    await mkdir(join(tmp.path, 'direct', 'DataCnmd'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'direct'))).toBe(join(tmp.path, 'direct'));
    await mkdir(join(tmp.path, 'wrapped', 'CnMod 1.3.1', 'DataCnmd'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'wrapped'))).toBe(join(tmp.path, 'wrapped', 'CnMod 1.3.1'));
    await mkdir(join(tmp.path, 'empty'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'empty'))).toBeUndefined();
  });

  it('discovers the newest installed mod under mods/ (lexicographically last)', async () => {
    const mods = join(tmp.path, 'mods');
    expect(await discoverInstalledMod(mods)).toBeUndefined(); // no mods/ dir yet
    await mkdir(join(mods, 'CnMod 1.3.1', 'DataCnmd'), { recursive: true });
    await mkdir(join(mods, 'CnMod 1.3.2', 'DataCnmd'), { recursive: true });
    await mkdir(join(mods, 'not-a-mod'), { recursive: true });
    expect(await discoverInstalledMod(mods)).toBe(join(mods, 'CnMod 1.3.2'));
  });
});

/** A fetch stub scripted per URL; unlisted URLs fail the test. */
function fetchStub(routes: Record<string, () => Response>): typeof fetch {
  return (input) => {
    const url = String(input);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch ${url}`);
    return Promise.resolve(route());
  };
}

const fileResponse = (bytes: Uint8Array, url: string): Response => {
  const response = new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
    headers: { 'content-type': 'application/zip', 'content-length': String(bytes.length) },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

const htmlResponse = (html: string, url: string): Response => {
  const response = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

describe('downloadCnModZip', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-download');
  });
  afterEach(() => tmp.cleanup());

  it('follows the culturesnation → drive-page → confirm-form → stream chain', async () => {
    const bytes = Uint8Array.from([80, 75, 3, 4]);
    const confirmHtml =
      '<form action="https://drive.usercontent.google.com/download">' +
      '<input type="hidden" name="id" value="FILE"><input type="hidden" name="confirm" value="t"></form>';
    const fetchFn = fetchStub({
      'https://cn.example/download': () =>
        htmlResponse('<html>drive page</html>', 'https://drive.google.com/file/d/FILE/view'),
      'https://drive.usercontent.google.com/download?id=FILE&export=download': () =>
        htmlResponse(confirmHtml, 'https://drive.usercontent.google.com/download'),
      'https://drive.usercontent.google.com/download?id=FILE&confirm=t': () =>
        fileResponse(bytes, 'https://drive.usercontent.google.com/download'),
    });
    const dest = join(tmp.path, 'mod.zip');
    const events: unknown[] = [];
    const sha = await downloadCnModZip(dest, (e) => events.push(e), {
      fetchFn,
      url: 'https://cn.example/download',
    });
    expect(Array.from(await readFile(dest))).toEqual(Array.from(bytes));
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(events.length).toBeGreaterThan(0);
  });

  it('short-circuits when a hop already answers with the file', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const fetchFn = fetchStub({
      'https://cn.example/direct': () => fileResponse(bytes, 'https://cn.example/direct'),
    });
    const dest = join(tmp.path, 'mod.zip');
    await downloadCnModZip(dest, () => undefined, { fetchFn, url: 'https://cn.example/direct' });
    expect(Array.from(await readFile(dest))).toEqual(Array.from(bytes));
  });

  it('reports a quota/changed-page failure as an actionable error', async () => {
    const fetchFn = fetchStub({
      'https://cn.example/download': () =>
        htmlResponse('<html>page</html>', 'https://drive.google.com/file/d/FILE/view'),
      'https://drive.usercontent.google.com/download?id=FILE&export=download': () =>
        htmlResponse('<html>quota exceeded</html>', 'https://drive.usercontent.google.com/download'),
    });
    await expect(
      downloadCnModZip(join(tmp.path, 'mod.zip'), () => undefined, {
        fetchFn,
        url: 'https://cn.example/download',
      }),
    ).rejects.toThrow(/quota exceeded, or the page changed/);
  });
});

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
