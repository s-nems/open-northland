#!/usr/bin/env node
/**
 * Builds `content/` from the CulturesNation archive a release ships: reuses `content/cnmod.zip` or
 * downloads it there (or takes a local copy with `--zip <file>`), verifies the SHA-256 that pins the
 * release, reuses an unpacked cache under `content/` when present, and runs the pipeline into
 * `content/`, which is emptied first except for the rendered music and the cached source data.
 *
 * Usage: node scripts/build-content.mjs [--zip <file>]
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { repoRoot } from './content-dir.mjs';
import { extractZip } from './unzip.mjs';

const ARCHIVE_URL = 'https://game.opennorthland.org/cnmod.zip';
/** The archive's SHA-256 pins the mod release. */
const ARCHIVE_SHA256 = '68537a89a972621f5dc400912e0c660bd875f649b693f3dad70d26f49465f043';
const OUT_DIR = resolve(repoRoot, 'content');
const ARCHIVE_NAME = basename(new URL(ARCHIVE_URL).pathname);
const UNPACKED_DIR_NAME = '.cnmod-unpacked';
const UNPACKED_STAMP_NAME = '.cnmod-unpacked.sha256';
const MOD_ROOT_MARKER = 'DataCnmd';
/**
 * Rendering the soundtrack is most of a pipeline run, so its output stays; the music stage re-renders
 * every track whose source sizes or render version no longer match its own manifest.
 */
const KEPT_DIR = 'music';
const KEPT_ENTRIES = new Set([KEPT_DIR, ARCHIVE_NAME, UNPACKED_DIR_NAME, UNPACKED_STAMP_NAME]);
const LOG_PREFIX = '[build-content]';

function run(command, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`${command} ${args[0]} exited with ${signal ?? `status ${String(code)}`}`));
    });
  });
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function parseContentLength(value) {
  if (value === null) return undefined;
  const bytes = Number.parseInt(value, 10);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
}

function formatDownloadProgress(receivedBytes, totalBytes) {
  if (totalBytes === undefined) return `downloaded ${formatBytes(receivedBytes)}`;
  const percent = totalBytes === 0 ? 100 : (receivedBytes / totalBytes) * 100;
  return `download progress: ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)} (${percent.toFixed(1)}%)`;
}

async function download(url, target, log, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  const totalBytes = parseContentLength(response.headers.get('content-length'));
  const partial = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await rm(partial, { force: true });

  let receivedBytes = 0;
  let lastReportAt = 0;
  let lastReportedBytes = -1;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportAt < 1000) return;
    if (!force && receivedBytes === lastReportedBytes) return;
    lastReportAt = now;
    lastReportedBytes = receivedBytes;
    log(formatDownloadProgress(receivedBytes, totalBytes));
  };
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      reportProgress(false);
      callback(null, chunk);
    },
    flush(callback) {
      reportProgress(true);
      callback();
    },
  });

  reportProgress(true);
  try {
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** The archive wraps the mod in one top-level directory; the pipeline checks that it is a mod root. */
async function unpackedRoot(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const [only] = entries;
  return entries.length === 1 && only.isDirectory() ? join(dir, only.name) : dir;
}

async function emptyOutDir() {
  if (!existsSync(OUT_DIR)) return;
  for (const entry of await readdir(OUT_DIR)) {
    if (!KEPT_ENTRIES.has(entry)) await rm(join(OUT_DIR, entry), { recursive: true, force: true });
  }
}

function createLogger(out = process.stderr) {
  const startedAt = Date.now();
  return (message) => {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    out.write(`${LOG_PREFIX} +${elapsedSeconds}s ${message}\n`);
  };
}

async function buildContent(zip, log) {
  const modRoot = await obtainPinnedModRoot(zip, log);
  log(`replacing ${OUT_DIR}, keeping ${[...KEPT_ENTRIES].join(', ')}`);
  await emptyOutDir();
  log(`running asset pipeline for ${basename(modRoot)} into ${OUT_DIR}`);
  await run('npm', ['run', 'pipeline', '--', '--mod-root', modRoot, '--out', OUT_DIR], repoRoot);
  log(`${OUT_DIR} built from ${basename(modRoot)}`);
}

function cachedArchivePath(outDir, archiveUrl) {
  const archiveName = basename(new URL(archiveUrl).pathname);
  if (archiveName === '') throw new Error(`cannot derive an archive name from ${archiveUrl}`);
  return join(outDir, archiveName);
}

function sha256MismatchError(path, actualDigest, expectedDigest) {
  return new Error(
    `${path} is not the pinned CulturesNation archive: sha256 ${actualDigest}, expected ${expectedDigest}`,
  );
}

async function verifyArchiveSha256(path, expectedDigest, log) {
  log(`verifying sha256 of ${path}`);
  const actualDigest = await sha256File(path);
  if (actualDigest !== expectedDigest) throw sha256MismatchError(path, actualDigest, expectedDigest);
}

function unpackedCachePath(outDir) {
  return join(outDir, UNPACKED_DIR_NAME);
}

function unpackedStampPath(outDir) {
  return join(outDir, UNPACKED_STAMP_NAME);
}

async function cachedModRoot(outDir, expectedDigest) {
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  if (!existsSync(unpackedDir) || !existsSync(stampPath)) return undefined;

  const actualDigest = (await readFile(stampPath, 'utf8')).trim();
  if (actualDigest !== expectedDigest) return undefined;

  const modRoot = await unpackedRoot(unpackedDir);
  return existsSync(join(modRoot, MOD_ROOT_MARKER)) ? modRoot : undefined;
}

export async function obtainPinnedArchive(
  zip,
  log,
  { outDir = OUT_DIR, archiveUrl = ARCHIVE_URL, expectedDigest = ARCHIVE_SHA256, fetchImpl = fetch } = {},
) {
  if (zip !== undefined) {
    log(`using local archive ${zip}`);
    await verifyArchiveSha256(zip, expectedDigest, log);
    return zip;
  }

  const archive = cachedArchivePath(outDir, archiveUrl);
  await mkdir(outDir, { recursive: true });
  if (!existsSync(archive)) {
    log(`cached archive missing, downloading ${archiveUrl} into ${archive}`);
    await download(archiveUrl, archive, log, fetchImpl);
  } else {
    log(`using cached archive ${archive}`);
  }

  try {
    await verifyArchiveSha256(archive, expectedDigest, log);
  } catch (_error) {
    log(`cached archive failed verification, re-downloading ${archiveUrl}`);
    await download(archiveUrl, archive, log, fetchImpl);
    await verifyArchiveSha256(archive, expectedDigest, log);
  }
  return archive;
}

export async function obtainPinnedModRoot(
  zip,
  log,
  {
    outDir = OUT_DIR,
    archiveUrl = ARCHIVE_URL,
    expectedDigest = ARCHIVE_SHA256,
    fetchImpl = fetch,
    extractImpl = extractZip,
  } = {},
) {
  const archive = await obtainPinnedArchive(zip, log, { outDir, archiveUrl, expectedDigest, fetchImpl });
  const cached = await cachedModRoot(outDir, expectedDigest);
  if (cached !== undefined) {
    log(`using cached unpacked mod ${cached}`);
    return cached;
  }

  await mkdir(outDir, { recursive: true });
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  const partialDir = await mkdtemp(join(outDir, `${UNPACKED_DIR_NAME}.part-`));
  log(`cached unpacked mod missing or stale, extracting ${archive} into ${unpackedDir}`);
  try {
    await extractImpl(archive, partialDir);
    const modRoot = await unpackedRoot(partialDir);
    if (!existsSync(join(modRoot, MOD_ROOT_MARKER))) {
      throw new Error(
        `${archive} did not unpack into a mod root: missing ${MOD_ROOT_MARKER}/ under ${modRoot}`,
      );
    }
    await rm(unpackedDir, { recursive: true, force: true });
    await rename(partialDir, unpackedDir);
    await writeFile(stampPath, `${expectedDigest}\n`);
    const cachedRoot = await unpackedRoot(unpackedDir);
    log(`cached unpacked mod at ${cachedRoot}`);
    return cachedRoot;
  } catch (error) {
    await rm(partialDir, { recursive: true, force: true });
    throw error;
  }
}

export async function main({ args = process.argv.slice(2), env = process.env, log = createLogger() } = {}) {
  const { values } = parseArgs({ args, options: { zip: { type: 'string' } } });
  // npm runs a root script with cwd set to the checkout; INIT_CWD is where the user typed the command.
  const invokedFrom = env.INIT_CWD ?? process.cwd();
  log('starting content build');
  await buildContent(values.zip === undefined ? undefined : resolve(invokedFrom, values.zip), log);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const log = createLogger();
  try {
    await main({ log });
  } catch (err) {
    log(`failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
