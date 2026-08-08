import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vjoin } from '@open-northland/vfs';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isContentRoute, resolveContentRequest } from '../src/routes.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

describe('resolveContentRequest', () => {
  const fs = nodeVfs();
  let tmp: TempDir;
  let contentRoot: string;

  beforeEach(async () => {
    tmp = await makeTempDir('content-resolver');
    contentRoot = tmp.path;
  });

  afterEach(() => tmp.cleanup());

  async function put(rel: string, body = 'x'): Promise<string> {
    const file = join(contentRoot, rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, body);
    return vjoin(contentRoot, rel);
  }

  it('serves each file route from its own subtree with the right content type', async () => {
    const map = await put('maps/campaign01.json');
    const minimap = await put('maps/campaign01.png');
    const atlas = await put('Data/engine2d/bin/bobs/ls_trees.tree01.atlas.json');
    const sheet = await put('Data/engine2d/bin/bobs/ls_trees.tree01.png');
    const texture = await put('Data/engine2d/bin/textures/text_000.png');
    const sound = await put('Data/engine2d/bin/sounds/axe01.wav');
    const track = await put('music/theme_viking_neutral.ogg');
    const musicManifest = await put('music/manifest.json');
    const strings = await put('gui/strings.eng.json');
    const cursor = await put('gui/cursors/normal.cur');
    const bitmap = await put('Data/gui/bitmaps/bg01.png');
    const goods = await put('goods/manifest.json');
    const backdrop = await put('backdrops/01-demo.jpg');

    expect(await resolveContentRequest(fs, '/maps/campaign01.json', contentRoot)).toEqual({
      kind: 'file',
      path: map,
      contentType: 'application/json',
    });
    expect(await resolveContentRequest(fs, '/maps/campaign01.png', contentRoot)).toMatchObject({
      path: minimap,
    });
    expect(await resolveContentRequest(fs, '/bobs/ls_trees.tree01.atlas.json', contentRoot)).toMatchObject({
      path: atlas,
      contentType: 'application/json',
    });
    expect(await resolveContentRequest(fs, '/bobs/ls_trees.tree01.png', contentRoot)).toMatchObject({
      path: sheet,
    });
    expect(await resolveContentRequest(fs, '/textures/text_000.png', contentRoot)).toMatchObject({
      path: texture,
    });
    expect(await resolveContentRequest(fs, '/sounds/axe01.wav', contentRoot)).toMatchObject({
      path: sound,
      contentType: 'audio/wav',
    });
    expect(await resolveContentRequest(fs, '/music/theme_viking_neutral.ogg', contentRoot)).toMatchObject({
      path: track,
      contentType: 'audio/ogg',
    });
    expect(await resolveContentRequest(fs, '/music/manifest.json', contentRoot)).toMatchObject({
      path: musicManifest,
      contentType: 'application/json',
    });
    expect(await resolveContentRequest(fs, '/gui/strings.eng.json', contentRoot)).toMatchObject({
      path: strings,
    });
    expect(await resolveContentRequest(fs, '/gui/cursors/normal.cur', contentRoot)).toMatchObject({
      path: cursor,
      contentType: 'image/x-icon',
    });
    expect(await resolveContentRequest(fs, '/gui-bitmaps/bg01.png', contentRoot)).toMatchObject({
      path: bitmap,
    });
    expect(await resolveContentRequest(fs, '/goods/manifest.json', contentRoot)).toMatchObject({
      path: goods,
    });
    expect(await resolveContentRequest(fs, '/backdrops/01-demo.jpg', contentRoot)).toMatchObject({
      path: backdrop,
      contentType: 'image/jpeg',
    });
  });

  it('serves /ir.json as the one whole file and nothing else at the top level', async () => {
    const ir = await put('ir.json');
    await put('secret.json');
    expect(await resolveContentRequest(fs, '/ir.json', contentRoot)).toMatchObject({ path: ir });
    expect(await resolveContentRequest(fs, '/secret.json', contentRoot)).toBeUndefined();
  });

  it('builds the index payloads only when their roots exist', async () => {
    expect(await resolveContentRequest(fs, '/maps-index', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/bobs-index', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/backdrops-index', contentRoot)).toBeUndefined();

    await put('maps/campaign01.json');
    await put('Data/engine2d/bin/bobs/ls_trees.tree01.atlas.json');
    await put('Data/engine2d/bin/bobs/ls_trees.tree01.png');
    await put('backdrops/02-second.jpg');
    await put('backdrops/01-first.jpg');
    await put('backdrops/notes.txt');

    const maps = await resolveContentRequest(fs, '/maps-index', contentRoot);
    expect(maps?.kind).toBe('json');
    expect(maps?.kind === 'json' ? await maps.body() : undefined).toEqual([
      { id: 'campaign01', minimap: false },
    ]);
    const bobs = await resolveContentRequest(fs, '/bobs-index', contentRoot);
    expect(bobs?.kind === 'json' ? await bobs.body() : undefined).toEqual([
      { stem: 'ls_trees.tree01', base: 'ls_trees', variant: 'tree01' },
    ]);
    const backdrops = await resolveContentRequest(fs, '/backdrops-index', contentRoot);
    expect(backdrops?.kind === 'json' ? await backdrops.body() : undefined).toEqual([
      '01-first.jpg',
      '02-second.jpg',
    ]);
  });

  it('rejects extensions outside a route allowlist (bare .json never rides /bobs)', async () => {
    await put('Data/engine2d/bin/bobs/notes.json');
    await put('maps/campaign01.wav');
    expect(await resolveContentRequest(fs, '/bobs/notes.json', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/maps/campaign01.wav', contentRoot)).toBeUndefined();
  });

  it('rejects traversal out of a route root even toward served extensions', async () => {
    await put('maps/campaign01.json');
    await put('gui/strings.eng.json');
    expect(
      await resolveContentRequest(fs, '/bobs/../../../../maps/campaign01.json', contentRoot),
    ).toBeUndefined();
    expect(await resolveContentRequest(fs, '/maps/../gui/strings.eng.json', contentRoot)).toBeUndefined();
  });

  it('resolves absent files and unmatched prefixes to undefined', async () => {
    expect(await resolveContentRequest(fs, '/maps/missing.json', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/src/main.ts', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/maps', contentRoot)).toBeUndefined();
  });

  it('percent-decodes the raw pathname the same way for every host', async () => {
    const spaced = await put('maps/two words.json');
    expect(await resolveContentRequest(fs, '/maps/two%20words.json', contentRoot)).toMatchObject({
      path: spaced,
    });
  });

  it('rejects encoded traversal and malformed percent sequences without throwing', async () => {
    await put('maps/campaign01.json');
    // Single-encoded dots decode to a real `..` and must still fail the containment check.
    expect(
      await resolveContentRequest(fs, '/bobs/%2e%2e/%2e%2e/%2e%2e/%2e%2e/maps/campaign01.json', contentRoot),
    ).toBeUndefined();
    expect(await resolveContentRequest(fs, '/maps/%zz.json', contentRoot)).toBeUndefined();
    expect(await resolveContentRequest(fs, '/maps/%.json', contentRoot)).toBeUndefined();
  });

  it('claims every pathname it can resolve, so no hit is left to a host catch-all', async () => {
    await put('ir.json');
    await put('maps/campaign01.json');
    await put('maps/two words.json');
    await put('Data/engine2d/bin/bobs/ls_trees.tree01.atlas.json');
    const probed = [
      '/ir.json',
      '/maps-index',
      '/bobs-index',
      '/maps/campaign01.json',
      '/maps/two%20words.json',
      '/bobs/ls_trees.tree01.atlas.json',
      '/maps/missing.json',
      '/bobs/notes.json',
      '/bobs/%2e%2e/maps/campaign01.json',
      '/maps/%zz.json',
      '/',
      '/maps',
      '/src/main.ts',
      '/secret.json',
    ];
    const resolvable: string[] = [];
    for (const p of probed) {
      if ((await resolveContentRequest(fs, p, contentRoot)) !== undefined) resolvable.push(p);
    }
    expect(resolvable).toEqual([
      '/ir.json',
      '/maps-index',
      '/bobs-index',
      '/maps/campaign01.json',
      '/maps/two%20words.json',
      '/bobs/ls_trees.tree01.atlas.json',
    ]);
    for (const pathname of resolvable) expect(isContentRoute(pathname)).toBe(true);
  });
});

describe('isContentRoute', () => {
  it('claims every content-namespace path even when nothing resolves there', () => {
    expect(isContentRoute('/ir.json')).toBe(true);
    expect(isContentRoute('/maps-index')).toBe(true);
    expect(isContentRoute('/bobs-index')).toBe(true);
    expect(isContentRoute('/backdrops-index')).toBe(true);
    expect(isContentRoute('/backdrops/01-demo.jpg')).toBe(true);
    expect(isContentRoute('/bobs/cr_hum_body_00.atlas.json')).toBe(true);
    expect(isContentRoute('/textures/text_001.png')).toBe(true);
    expect(isContentRoute('/maps/missing.json')).toBe(true);
    expect(isContentRoute('/bobs/../escape.json')).toBe(true); // in-namespace junk stays a 404, not a page
  });

  it('leaves off-namespace and malformed paths to the host', () => {
    expect(isContentRoute('/')).toBe(false);
    expect(isContentRoute('/src/main.ts')).toBe(false);
    expect(isContentRoute('/maps')).toBe(false); // the file routes own only their `/maps/…` subtree
    expect(isContentRoute('/maps/%zz.json')).toBe(false);
  });
});
