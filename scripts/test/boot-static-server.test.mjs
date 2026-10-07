import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startStaticServer } from '../boot-check/static-server.mjs';

test('serves content over the app build, the index at the root, and nothing outside either', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const content = join(dir, 'content');
  const dist = join(dir, 'dist');
  await mkdir(join(content, 'maps'), { recursive: true });
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), '<p>app</p>');
  await writeFile(join(dist, 'shared.json'), '"from dist"');
  await writeFile(join(content, 'shared.json'), '"from content"');
  await writeFile(join(content, 'maps', 'a b.json'), '{}');
  await writeFile(join(dir, 'secret.txt'), 'outside');

  const server = await startStaticServer([content, dist]);
  t.after(() => server.close());
  const get = (path) => fetch(`${server.origin}${path}`);

  const index = await get('/?map=x');
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await index.text(), '<p>app</p>');
  assert.equal(await (await get('/shared.json')).text(), '"from content"');
  assert.equal((await get('/maps/a%20b.json')).status, 200);
  assert.equal((await get('/missing.json')).status, 404);
  assert.equal((await get('/..%2fsecret.txt')).status, 404);
});
