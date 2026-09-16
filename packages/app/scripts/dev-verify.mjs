import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

export async function verifyPreview(url, expected) {
  async function get(path, type = 'application/json', method = 'GET') {
    const response = await fetch(new URL(path, url), { method, signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `${path}: HTTP ${response.status}; prepare generated content before handoff`);
    assert.ok(response.headers.get('content-type')?.startsWith(type), `${path}: expected ${type}`);
    return response;
  }
  const identity = await (await get('/__dev/checkout')).json();
  assert.equal(identity.checkout, expected.checkout, 'Preview serves a different checkout');
  assert.equal(identity.clientBuild, expected.clientBuild, 'Preview has a stale client build; restart it');

  await get('/ir.json', 'application/json', 'HEAD');
  const maps = await (await get('/maps-index.json')).json();
  const bobs = await (await get('/bobs-index.json')).json();
  assert.ok(Array.isArray(maps) && maps.length > 0, 'Generated maps index is empty');
  assert.ok(Array.isArray(bobs) && bobs.length > 0, 'Generated sprites index is empty');
  const map = url.searchParams.get('map') ?? maps[0].id;
  assert.ok(
    maps.some((entry) => entry.id === map),
    `Map ${map} is absent from generated content`,
  );
  const mapPath = `/maps/${encodeURIComponent(map)}`;
  for (const suffix of ['.json', '.meta.json']) await get(`${mapPath}${suffix}`, 'application/json', 'HEAD');
  const sprite = `/bobs/${encodeURIComponent(bobs[0].stem)}`;
  await get(`${sprite}.atlas.json`, 'application/json', 'HEAD');
  await get(`${sprite}.png`, 'image/png', 'HEAD');
  return identity;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: npm run dev:verify -- http://127.0.0.1:PORT/?map=MAP');
    const url = new URL(process.argv[2]);
    const app = fileURLToPath(new URL('../', import.meta.url));
    const checkout = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, app);
    assert.ok(loaded, 'Cannot load this checkout’s Vite config');
    const identity = await verifyPreview(url, {
      checkout,
      clientBuild: JSON.parse(loaded.config.define.__CLIENT_BUILD__),
    });
    console.log(
      `Verified checkout, client build and generated content: ${url.href}\nCheckout: ${checkout}\nBranch at startup: ${identity.branch}\nPID: ${identity.pid}\nContent: ${identity.contentRoot}`,
    );
  } catch (error) {
    console.error(`Preview verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
