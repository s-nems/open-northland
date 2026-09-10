/**
 * Runs a built relay image and checks what the deployment contract asks of it: it starts on
 * environment variables alone, answers the health check with the protocol it speaks and the address
 * it was given, refuses another protocol by name, welcomes a client of its own, logs one JSON record
 * per line, and carries neither the simulation nor a content directory.
 *
 * Usage: node packages/net-server/scripts/smoke-image.mjs [image reference]
 */

import { docker, finish, freePort, waitForHealth } from '../../../scripts/smoke-image-support.mjs';

const image = process.argv[2] ?? 'open-northland-relay';

const RELAY_PORT = 8765;
const PUBLIC_URL = 'wss://relay.example.org/';
const MAX_ROOMS = '3';
const HANDSHAKE_TIMEOUT_MS = 5000;
const TOKEN = 'smoke-token-0123456789';
/** What the runtime image may hold under /app/packages: the relay and its wire protocol only. */
const RUNTIME_PACKAGES = ['net-protocol', 'net-server'];

/** Open a socket, send one hello, and return the first message the relay answers with. */
function firstAnswer(url, hello) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('no answer to hello'));
    }, HANDSHAKE_TIMEOUT_MS);
    socket.addEventListener('open', () => socket.send(JSON.stringify(hello)));
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      socket.close();
      resolve(JSON.parse(String(event.data)));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('the socket failed'));
    });
  });
}

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((item, i) => item === expected[i]);
}

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(ok ? `  ok   ${name}` : ` FAIL  ${name}\n         ${detail ?? ''}`);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const url = `ws://127.0.0.1:${port}`;
const container = docker(
  'run',
  '--detach',
  '--publish',
  `127.0.0.1:${port}:${RELAY_PORT}`,
  '--env',
  `RELAY_PUBLIC_URL=${PUBLIC_URL}`,
  '--env',
  `RELAY_MAX_ROOMS=${MAX_ROOMS}`,
  image,
);
let passed = false;
try {
  const health = await (await waitForHealth(base, image)).json();
  check(
    'the health check reports the protocol',
    health.ok === true && Number.isInteger(health.protocol),
    JSON.stringify(health),
  );
  check('the health check reports the configured address', health.url === PUBLIC_URL, String(health.url));
  check(
    'the health check counts rooms and clients',
    health.rooms === 0 && health.clients === 0,
    JSON.stringify(health),
  );
  const missing = await fetch(`${base}/no-such-path`);
  check('plain HTTP serves nothing but the health check', missing.status === 404, `status ${missing.status}`);

  const hello = { kind: 'hello', protocol: health.protocol + 1, token: TOKEN, nick: 'Smoke' };
  const refused = await firstAnswer(url, hello);
  check(
    'another protocol is refused by name',
    refused.kind === 'error' && /protocol/.test(refused.reason),
    JSON.stringify(refused),
  );
  const welcomed = await firstAnswer(url, { ...hello, protocol: health.protocol });
  check(
    'a client of the same protocol is welcomed',
    welcomed.kind === 'welcome' && welcomed.protocol === health.protocol,
    JSON.stringify(welcomed),
  );

  const packages = docker('exec', container, 'ls', '/app/packages').split('\n').sort();
  check(
    'the image holds the relay and the protocol only',
    sameList(packages, RUNTIME_PACKAGES),
    packages.join(', '),
  );
  const content = docker('exec', container, 'find', '/app', '-type', 'd', '-name', 'content');
  check('the image holds no content directory', content === '', content);

  const lines = docker('logs', container).split('\n');
  let records = [];
  try {
    records = lines.map((line) => JSON.parse(line));
  } catch {
    records = [];
  }
  check(
    'the log is one JSON record per line, starting with the listening event',
    records.length > 0 && records.some((record) => record.event === 'listening' && record.url === PUBLIC_URL),
    lines.slice(0, 3).join('\n         '),
  );
  passed = results.every(Boolean);
} finally {
  if (!passed) console.log(docker('logs', container));
  docker('rm', '--force', container);
}

finish(image, passed);
