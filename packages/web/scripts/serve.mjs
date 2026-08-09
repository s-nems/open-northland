/**
 * Local verification server for the assembled site: serves dist/site at /game, redirects / there,
 * and optionally serves a local mod archive at /cnmod/cnmod.zip (OPEN_NORTHLAND_CNMOD_ZIP=<path>).
 * Production hosting is a static server with the same layout; this script never deploys anything.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist/site');
const port = Number.parseInt(process.env.PORT ?? '8788', 10);
const cnmodZip = process.env.OPEN_NORTHLAND_CNMOD_ZIP;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

function send(res, status, body, type = 'text/plain') {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.end(body);
}

function serveFile(res, file) {
  res.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('content-length', statSync(file).size);
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (pathname === '/' || pathname === '/game') {
    res.statusCode = 302;
    res.setHeader('location', '/game/');
    res.end();
    return;
  }
  if (pathname === '/cnmod/cnmod.zip') {
    if (cnmodZip === undefined || !existsSync(cnmodZip)) {
      send(res, 404, 'set OPEN_NORTHLAND_CNMOD_ZIP=<path to CnMod zip> to serve the mod locally');
      return;
    }
    serveFile(res, cnmodZip);
    return;
  }
  if (!pathname.startsWith('/game/')) {
    send(res, 404, 'not found');
    return;
  }
  const rel = normalize(pathname.slice('/game/'.length)).replace(/^([/\\]|\.\.)+/, '');
  let file = join(site, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(site)) {
    send(res, 404, 'not found');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    send(res, 404, 'not found');
    return;
  }
  serveFile(res, file);
}).listen(port, '127.0.0.1', () => {
  console.log(`[web] serving dist/site at http://127.0.0.1:${port}/game/`);
  if (cnmodZip !== undefined) console.log(`[web] serving ${cnmodZip} at /cnmod/cnmod.zip`);
});
