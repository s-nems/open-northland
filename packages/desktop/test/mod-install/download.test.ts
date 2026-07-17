import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadCnModZip, parseDriveConfirmUrl, parseDriveFileId } from '../../src/mod-install/download.js';
import { fetchStub, fileResponse, htmlResponse } from '../support/fetch-stub.js';
import { makeTempDir, type TempDir } from '../support/temp-dir.js';

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

  it('refuses a confirm form that submits anywhere but Google', () => {
    const html =
      '<form action="https://evil.example/download"><input type="hidden" name="id" value="FILE"></form>';
    expect(parseDriveConfirmUrl(html)).toBeUndefined();
    const lookalike =
      '<form action="https://notgoogle.com/download"><input type="hidden" name="id" value="FILE"></form>';
    expect(parseDriveConfirmUrl(lookalike)).toBeUndefined();
  });
});

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
