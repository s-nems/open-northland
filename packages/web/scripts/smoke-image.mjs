/**
 * Runs a built web image and checks what the deployment contract asks of the host: the site at the
 * origin root, the app under /play/, a long cache only for hashed assets, and a plain miss for the
 * paths the service worker and the proxy own.
 *
 * Usage: node packages/web/scripts/smoke-image.mjs [image reference]
 */

import { docker, finish, freePort, waitForHealth } from '../../../scripts/smoke-image-support.mjs';
import { CONTENT_ROUTES } from './contract-routes.mjs';

const image = process.argv[2] ?? 'open-northland-web';

const CHECKS = [
  { path: '/', status: 200, type: /text\/html/, cache: /no-cache/ },
  { path: '/setup.js', status: 200, type: /javascript/, cache: /no-cache/ },
  { path: '/sw.js', status: 200, type: /javascript/, cache: /no-cache/ },
  { path: '/pipeline-worker.js', status: 200, type: /javascript/, cache: /no-cache/ },
  { path: '/play/', status: 200, type: /text\/html/, cache: /no-cache/ },
  { path: '/healthz', status: 200 },
  // The proxy in front of the container serves the mod archive; the image must not pretend to.
  { path: '/cnmod.zip', status: 404 },
  // Every content route belongs to the service worker, answered from origin-private storage. A
  // static file at one of them would shadow the route and hide the clash.
  ...CONTENT_ROUTES.map((route) => ({ path: `/play${route}`, status: 404 })),
  { path: '/no-such-file', status: 404 },
];

/** The one asset name the app build hashes, taken from the page that actually references it. */
async function hashedAsset(base) {
  const markup = await (await fetch(`${base}/play/`)).text();
  const found = markup.match(/\/play\/assets\/[\w.-]+/)?.[0];
  if (found === undefined) throw new Error('the app build under /play/ references no hashed asset');
  return found;
}

async function check(base, { path, status, type, cache }) {
  const response = await fetch(`${base}${path}`);
  const failures = [];
  if (response.status !== status) failures.push(`status ${response.status}, want ${status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (type !== undefined && !type.test(contentType)) failures.push(`content-type ${contentType}`);
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (cache !== undefined && !cache.test(cacheControl)) failures.push(`cache-control ${cacheControl}`);
  const label = failures.length === 0 ? '  ok  ' : ' FAIL ';
  console.log([`${label} ${path}`, ...failures.map((reason) => `         ${reason}`)].join('\n'));
  return failures.length === 0;
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const container = docker('run', '--detach', '--publish', `127.0.0.1:${port}:80`, image);
let passed = false;
try {
  await waitForHealth(base, image);
  const asset = await hashedAsset(base);
  const checks = [...CHECKS, { path: asset, status: 200, cache: /immutable/ }];
  const results = [];
  for (const one of checks) results.push(await check(base, one));
  passed = results.every(Boolean);
} finally {
  if (!passed) console.log(docker('logs', container));
  docker('rm', '--force', container);
}

finish(image, passed);
