/**
 * Runs a built web image and checks what the demo host must serve: the app at the origin root, the
 * content listings and the files they point at, a long cache only for the hashed app assets, and a
 * plain 404 for a content path that does not exist.
 *
 * Usage: node deploy/web/smoke-image.mjs [image reference]
 */

import { docker, finish, freePort, waitForHealth } from '../../scripts/smoke-image-support.mjs';

const image = process.argv[2] ?? 'open-northland-web';
const HTTP_PORT = 80;

const HTML = /text\/html/;
const JSON_TYPE = /application\/json/;
const NO_CACHE = /no-cache/;

async function listing(base, path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/** The first file each listing names, so the check follows the content rather than a fixed id. */
async function listedFiles(base) {
  const maps = await listing(base, '/maps-index.json');
  const bobs = await listing(base, '/bobs-index.json');
  const map = maps[0]?.id;
  const bob = bobs[0]?.stem;
  if (map === undefined || bob === undefined) throw new Error('the listings name no map or no atlas');
  return { map: `/maps/${map}.json`, bob: `/bobs/${bob}.atlas.json` };
}

/** The one asset name the app build hashes, taken from the page that actually references it. */
async function hashedAsset(base) {
  const markup = await (await fetch(`${base}/`)).text();
  const found = markup.match(/\/assets\/[\w.-]+/)?.[0];
  if (found === undefined) throw new Error('the app page references no hashed asset');
  return found;
}

async function check(base, { path, status, type, cache }) {
  const response = await fetch(`${base}${path}`);
  const failures = [];
  if (response.status !== status) failures.push(`status ${response.status}, want ${status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (type !== undefined && !type.test(contentType)) failures.push(`content-type ${contentType}`);
  if (status === 404 && HTML.test(contentType) && (await response.text()).includes('<canvas')) {
    failures.push('the miss came back as the app page');
  }
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (cache !== undefined && !cache.test(cacheControl)) failures.push(`cache-control ${cacheControl}`);
  const label = failures.length === 0 ? '  ok  ' : ' FAIL ';
  console.log([`${label} ${path}`, ...failures.map((reason) => `         ${reason}`)].join('\n'));
  return failures.length === 0;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const container = docker('run', '--detach', '--publish', `127.0.0.1:${port}:${HTTP_PORT}`, image);
let passed = false;
try {
  await waitForHealth(base, image);
  const { map, bob } = await listedFiles(base);
  const checks = [
    { path: '/', status: 200, type: HTML, cache: NO_CACHE },
    { path: await hashedAsset(base), status: 200, cache: /immutable/ },
    { path: '/ir.json', status: 200, type: JSON_TYPE, cache: NO_CACHE },
    { path: '/maps-index.json', status: 200, type: JSON_TYPE, cache: NO_CACHE },
    { path: map, status: 200, type: JSON_TYPE, cache: NO_CACHE },
    { path: bob, status: 200, type: JSON_TYPE, cache: NO_CACHE },
    { path: '/healthz', status: 200 },
    { path: '/maps/no-such-map.json', status: 404 },
    { path: '/no-such-file', status: 404 },
  ];
  const results = [];
  for (const one of checks) results.push(await check(base, one));
  passed = results.every(Boolean);
} finally {
  if (!passed) console.log(docker('logs', container));
  docker('rm', '--force', container);
}

finish(image, passed);
