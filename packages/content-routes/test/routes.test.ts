import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveContentRequest } from '../src/routes.js';

/**
 * The shared content-route resolver (`src/routes.ts`) both hosts (Vite dev middleware, desktop
 * protocol handler) sit on. Invariants: each route serves only its subtree and extension allowlist,
 * traversal cannot escape a route's root, and unmatched/absent paths resolve to `undefined` (the
 * host's 404 fall-through) instead of throwing.
 */
describe('resolveContentRequest', () => {
  let contentRoot: string;

  beforeEach(async () => {
    contentRoot = await mkdtemp(join(tmpdir(), 'opennorthland-content-routes-'));
  });

  afterEach(async () => {
    await rm(contentRoot, { recursive: true, force: true });
  });

  async function put(rel: string, body = 'x'): Promise<string> {
    const file = join(contentRoot, rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, body);
    return file;
  }

  it('serves each file route from its own subtree with the right content type', async () => {
    const map = await put('maps/campaign01.json');
    const minimap = await put('maps/campaign01.png');
    const atlas = await put('Data/engine2d/bin/bobs/ls_trees.tree01.atlas.json');
    const sheet = await put('Data/engine2d/bin/bobs/ls_trees.tree01.png');
    const texture = await put('Data/engine2d/bin/textures/text_000.png');
    const sound = await put('Data/engine2d/bin/sounds/axe01.wav');
    const strings = await put('gui/strings.eng.json');
    const cursor = await put('gui/cursors/normal.cur');
    const bitmap = await put('Data/gui/bitmaps/bg01.png');
    const goods = await put('goods/manifest.json');

    expect(resolveContentRequest('/maps/campaign01.json', contentRoot)).toEqual({
      kind: 'file',
      path: map,
      contentType: 'application/json',
    });
    expect(resolveContentRequest('/maps/campaign01.png', contentRoot)).toMatchObject({ path: minimap });
    expect(resolveContentRequest('/bobs/ls_trees.tree01.atlas.json', contentRoot)).toMatchObject({
      path: atlas,
      contentType: 'application/json',
    });
    expect(resolveContentRequest('/bobs/ls_trees.tree01.png', contentRoot)).toMatchObject({ path: sheet });
    expect(resolveContentRequest('/textures/text_000.png', contentRoot)).toMatchObject({ path: texture });
    expect(resolveContentRequest('/sounds/axe01.wav', contentRoot)).toMatchObject({
      path: sound,
      contentType: 'audio/wav',
    });
    expect(resolveContentRequest('/gui/strings.eng.json', contentRoot)).toMatchObject({ path: strings });
    expect(resolveContentRequest('/gui/cursors/normal.cur', contentRoot)).toMatchObject({
      path: cursor,
      contentType: 'image/x-icon',
    });
    expect(resolveContentRequest('/gui-bitmaps/bg01.png', contentRoot)).toMatchObject({ path: bitmap });
    expect(resolveContentRequest('/goods/manifest.json', contentRoot)).toMatchObject({ path: goods });
  });

  it('serves /ir.json as the one whole file and nothing else at the top level', async () => {
    const ir = await put('ir.json');
    await put('secret.json');
    expect(resolveContentRequest('/ir.json', contentRoot)).toMatchObject({ path: ir });
    expect(resolveContentRequest('/secret.json', contentRoot)).toBeUndefined();
  });

  it('builds the index payloads only when their roots exist', async () => {
    expect(resolveContentRequest('/maps-index', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/bobs-index', contentRoot)).toBeUndefined();

    await put('maps/campaign01.json');
    await put('Data/engine2d/bin/bobs/ls_trees.tree01.atlas.json');
    await put('Data/engine2d/bin/bobs/ls_trees.tree01.png');

    const maps = resolveContentRequest('/maps-index', contentRoot);
    expect(maps?.kind).toBe('json');
    expect(maps?.kind === 'json' ? maps.body() : undefined).toEqual([{ id: 'campaign01', minimap: false }]);
    const bobs = resolveContentRequest('/bobs-index', contentRoot);
    expect(bobs?.kind === 'json' ? bobs.body() : undefined).toEqual([
      { stem: 'ls_trees.tree01', base: 'ls_trees', variant: 'tree01' },
    ]);
  });

  it('rejects extensions outside a route allowlist (bare .json never rides /bobs)', async () => {
    await put('Data/engine2d/bin/bobs/notes.json');
    await put('maps/campaign01.wav');
    expect(resolveContentRequest('/bobs/notes.json', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/maps/campaign01.wav', contentRoot)).toBeUndefined();
  });

  it('rejects traversal out of a route root even toward served extensions', async () => {
    await put('maps/campaign01.json');
    await put('gui/strings.eng.json');
    expect(resolveContentRequest('/bobs/../../../../maps/campaign01.json', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/maps/../gui/strings.eng.json', contentRoot)).toBeUndefined();
  });

  it('resolves absent files and unmatched prefixes to undefined', async () => {
    expect(resolveContentRequest('/maps/missing.json', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/src/main.ts', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/maps', contentRoot)).toBeUndefined();
  });

  it('percent-decodes the raw pathname the same way for every host', async () => {
    const spaced = await put('maps/two words.json');
    expect(resolveContentRequest('/maps/two%20words.json', contentRoot)).toMatchObject({ path: spaced });
  });

  it('rejects encoded traversal and malformed percent sequences without throwing', async () => {
    await put('maps/campaign01.json');
    // Single-encoded dots decode to a real `..` and must still fail the containment check.
    expect(
      resolveContentRequest('/bobs/%2e%2e/%2e%2e/%2e%2e/%2e%2e/maps/campaign01.json', contentRoot),
    ).toBeUndefined();
    expect(resolveContentRequest('/maps/%zz.json', contentRoot)).toBeUndefined();
    expect(resolveContentRequest('/maps/%.json', contentRoot)).toBeUndefined();
  });
});
