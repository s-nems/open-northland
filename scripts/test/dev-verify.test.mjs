import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { verifyPreview } from '../../packages/app/scripts/dev-verify.mjs';

const expected = { checkout: '/task', clientBuild: 'current' };

async function fixture(t) {
  const files = new Map([
    ['/__dev/checkout', expected],
    ['/ir.json', {}],
    ['/maps-index.json', [{ id: 'forest' }]],
    ['/bobs-index.json', [{ stem: 'worker' }]],
    ['/maps/forest.json', {}],
    ['/maps/forest.meta.json', {}],
    ['/bobs/worker.atlas.json', {}],
    ['/bobs/worker.png', 'png'],
  ]);
  const server = createServer((req, res) => {
    if (!files.has(req.url)) {
      // A Vite SPA fallback is HTTP 200 too; the verifier must reject HTML.
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>menu</html>');
      return;
    }
    res.setHeader('Content-Type', req.url.endsWith('.png') ? 'image/png' : 'application/json');
    res.end(JSON.stringify(files.get(req.url)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { files, url: new URL(`http://127.0.0.1:${server.address().port}/?map=forest`) };
}

test('accepts this checkout with current code, a generated map and sprites', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyPreview(f.url, expected), expected);
});

test('rejects another checkout even when its build hash matches', async (t) => {
  const f = await fixture(t);
  f.files.set('/__dev/checkout', { ...expected, checkout: '/main' });
  await assert.rejects(verifyPreview(f.url, expected), /different checkout/);
});

test('rejects an old server build in the correct checkout', async (t) => {
  const f = await fixture(t);
  f.files.set('/__dev/checkout', { ...expected, clientBuild: 'old' });
  await assert.rejects(verifyPreview(f.url, expected), /stale client build/);
});

test('rejects missing generated content even if the server answers HTTP 200', async (t) => {
  const f = await fixture(t);
  f.files.delete('/ir.json');
  await assert.rejects(verifyPreview(f.url, expected), /ir.json: expected application\/json/);
});

test('rejects an indexed map or sprite that was not actually generated', async (t) => {
  const f = await fixture(t);
  f.files.delete('/maps/forest.json');
  await assert.rejects(verifyPreview(f.url, expected), /forest.json/);
  f.files.set('/maps/forest.json', {});
  f.files.delete('/bobs/worker.png');
  await assert.rejects(verifyPreview(f.url, expected), /worker.png/);
});
