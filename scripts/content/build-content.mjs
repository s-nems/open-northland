#!/usr/bin/env node
/** Download or reuse data.zip, validate it, and replace generated content after conversion succeeds. */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readDataPack, sha256File } from '../data-pack.mjs';
import { extractZip } from '../unzip.mjs';
import { primaryCheckoutRoot, repoRoot } from './dir.mjs';
import { localDataArchive } from './local-data-env.mjs';

const pin = JSON.parse(await readFile(new URL('../data-release.json', import.meta.url), 'utf8'));
const ARCHIVE_SHA256 = pin.sha256;
/** Every published pack stays downloadable under its own SHA-256; `data.zip` beside it is only the current one. */
const ARCHIVE_BASE_URL = 'https://opennorthland.org/data/';
const OUT_DIR = resolve(repoRoot, 'content');
const CACHE_DIR = resolve(repoRoot, '.cache', 'data');
/** A linked worktree's stand-ins for both: the primary checkout's trees, which it clones when they were
 *  built from the same inputs instead of keeping a converted copy of its own. */
const PRIMARY_ROOT = primaryCheckoutRoot();
const PRIMARY_OUT_DIR = PRIMARY_ROOT === repoRoot ? undefined : resolve(PRIMARY_ROOT, 'content');
const PRIMARY_CACHE_DIR = PRIMARY_ROOT === repoRoot ? undefined : resolve(PRIMARY_ROOT, '.cache', 'data');
const UNPACKED_DIR_NAME = 'unpacked';
const UNPACKED_STAMP_NAME = 'unpacked.sha256';
const CONTENT_STAGING_PREFIX = 'content-';
/** A staging tree untouched this long was left by an interrupted build: a copy or an extraction ends
 *  within minutes, and a build that stops between steps never runs its cleanup. */
const STALE_STAGING_MS = 60 * 60 * 1000;
/** Records which archive and IR version a content tree was converted from; `--if-stale` compares it. */
const BUILD_STAMP_NAME = 'build-stamp.json';
// Read from source: the pipeline compiles packages/data itself, so dist/ may not exist yet.
const IR_VERSION_SOURCE = resolve(repoRoot, 'packages/data/src/schema/content/ir-version.ts');
const IF_STALE_FLAG = '--if-stale';
/** Grants the download consent where no terminal can answer the prompt. */
const ACCEPT_ENV = 'ON_DATA_ACCEPT';
const HEAD_TIMEOUT_MS = 5000;
const LOG_PREFIX = '[build-content]';

function run(command, args, cwd) {
  return new Promise((done, fail) => {
    // npm is npm.cmd on Windows, which only a shell resolves.
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
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

/** The archive's HEAD response, or undefined when the server cannot be asked; the download reports that. */
async function remoteHead(url, fetchImpl) {
  try {
    return await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  } catch {
    return undefined;
  }
}

function remoteSize(head) {
  return head?.ok ? parseContentLength(head.headers.get('content-length')) : undefined;
}

/** The hashed URL answers 404 only when the pin is ahead of the publication. */
function unpublishedPackError(expectedDigest, archiveUrl) {
  return new Error(
    `the pinned data pack ${expectedDigest} is not published at ${archiveUrl}; ` +
      'scripts/data-release.json is ahead of the publication',
  );
}

function downloadNotice(archiveUrl, expectedDigest, sizeBytes) {
  const size = sizeBytes === undefined ? 'size unknown' : `about ${formatBytes(sizeBytes)}`;
  return `
The game needs converted content, which this repository does not contain. It is built
from the Open Northland source data pack:

  source    ${archiveUrl} (${size})
  sha256    ${expectedDigest}
  contents  game data derived from CNMod 1.3.2 for Cultures - 8th Wonder of the World:
            rules, graphics, sounds, music, maps and the campaigns with their films and
            translations. The files remain the property of their rights holders
            (docs/LEGAL.md); playing requires an installed original game.
  stored    .cache/data/ (archive) and content/ (converted), both ignored by Git

`;
}

/**
 * Asks before the first network download. Resolves to `accepted`, `declined` (answered no) or
 * `unattended` (no terminal to ask and no ON_DATA_ACCEPT=1).
 */
export async function askDownloadConsent({
  archiveUrl,
  expectedDigest,
  sizeOf,
  env = process.env,
  input = process.stdin,
  output = process.stderr,
}) {
  if (env[ACCEPT_ENV] === '1') return 'accepted';
  if (!input.isTTY || env.CI !== undefined) return 'unattended';
  output.write(downloadNotice(archiveUrl, expectedDigest, await sizeOf()));
  const rl = createInterface({ input, output, terminal: false });
  try {
    // End of input (Ctrl-D) closes the interface before any answer; that is a refusal, not a hang.
    const answer = await Promise.race([
      rl.question('Download it now? [Y/n] '),
      once(rl, 'close').then(() => null),
    ]);
    if (answer === null) return 'declined';
    return answer.trim() === '' || /^y(es)?$/i.test(answer.trim()) ? 'accepted' : 'declined';
  } finally {
    rl.close();
  }
}

class DownloadNotAccepted extends Error {
  constructor(reason) {
    super(
      reason === 'declined'
        ? 'download declined; the game has no content until a run accepts it or ON_DATA_ZIP names a local archive'
        : `downloading data.zip needs a terminal to confirm, ${ACCEPT_ENV}=1, or ON_DATA_ZIP`,
    );
    this.reason = reason;
  }
}

export function archiveUrlFor(digest) {
  return `${ARCHIVE_BASE_URL}${digest}.zip`;
}

async function download(url, target, log, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok || response.body === null) {
    throw Object.assign(new Error(`${url} answered ${response.status} ${response.statusText}`), {
      status: response.status,
    });
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

function createLogger(out = process.stderr) {
  const startedAt = Date.now();
  return (message) => {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    out.write(`${LOG_PREFIX} +${elapsedSeconds}s ${message}\n`);
  };
}

export async function currentIrVersion(source = IR_VERSION_SOURCE) {
  const match = /export const IR_VERSION = (\d+) as const;/.exec(await readFile(source, 'utf8'));
  if (match === null) throw new Error(`cannot read IR_VERSION from ${source}`);
  return Number(match[1]);
}

const TRANSLATIONS_DIR = resolve(repoRoot, 'translations');

/** One digest over every overlay file's path and bytes, so an edited or added overlay makes the tree stale. */
export async function translationsDigest(dir = TRANSLATIONS_DIR) {
  const hash = createHash('sha256');
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return hash.digest('hex');
  }
  // Translation overlays are JSON; film subtitles are SRT. Both live under translations/ and must
  // invalidate a stale content tree when added or edited.
  const files = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.srt')))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
  for (const file of files) {
    hash.update(file.slice(dir.length));
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}

/** True when the tree carries a stamp naming the pinned archive, the current IR version and the
 *  translation overlays it was built with. */
export async function contentIsCurrent(outDir, stamp) {
  if (!existsSync(join(outDir, 'ir.json'))) return false;
  try {
    const found = JSON.parse(await readFile(join(outDir, BUILD_STAMP_NAME), 'utf8'));
    return (
      found.archiveSha256 === stamp.archiveSha256 &&
      found.irVersion === stamp.irVersion &&
      found.translations === stamp.translations
    );
  } catch {
    return false;
  }
}

function runPipeline(dataRoot, out) {
  return run('npm', ['run', 'pipeline', '--', '--data-root', dataRoot, '--out', out], repoRoot);
}

/** The command that clones a tree: APFS `clonefile` through macOS `cp -c`, a reflink on Btrfs or XFS
 *  through GNU `cp --reflink=always`. Node's own forced clone is not implemented on macOS. */
function cloneCommand(source, target) {
  if (process.platform === 'darwin') return { file: 'cp', args: ['-c', '-R', source, target] };
  if (process.platform === 'linux') return { file: 'cp', args: ['-R', '--reflink=always', source, target] };
  return null;
}

/**
 * Copy `source` into the absent `target`: a clone that shares its bytes until either side changes them
 * where the file system can make one, else a plain copy, which still takes seconds where converting the
 * pack again takes many minutes. Says which it made, or false when both failed, leaving no partial tree.
 */
export async function cloneTree(source, target) {
  const command = cloneCommand(source, target);
  try {
    // macOS `cp -c` copies every byte across volumes instead of failing, so only one volume clones.
    if (command !== null && (await stat(source)).dev === (await stat(dirname(target))).dev) {
      await promisify(execFile)(command.file, command.args);
      return 'clone';
    }
  } catch {
    await rm(target, { recursive: true, force: true });
  }
  try {
    // Links stay as they are, as a clone keeps them, rather than pointing into `source`.
    await cp(source, target, { recursive: true, verbatimSymlinks: true });
    return 'copy';
  } catch {
    await rm(target, { recursive: true, force: true });
    return false;
  }
}

/** Clone another checkout's `source` with `clone`, discarding the result when that checkout swapped a new
 *  tree in meanwhile (both swaps rename a fresh tree into place), which would leave a mix of the two. */
export async function cloneSettledTree(source, target, clone) {
  const before = await stat(source);
  const made = await clone(source, target);
  if (!made) return false;
  const after = await stat(source).catch(() => undefined);
  if (after?.ino === before.ino) return made;
  await rm(target, { recursive: true, force: true });
  return false;
}

/** Remove the staging trees in `dir` named from `prefix` that an interrupted build left, keeping any a
 *  running build may still be filling. */
export async function sweepStaleStaging(dir, prefix, nowMs = Date.now()) {
  const names = await readdir(dir).catch(() => []);
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(dir, name);
    const info = await lstat(path).catch(() => undefined);
    if (info?.isDirectory() && nowMs - info.mtimeMs > STALE_STAGING_MS)
      await rm(path, { recursive: true, force: true });
  }
}

/** Fill a fresh staging tree beside `outDir` with `fill`, then swap it in for the previous tree. */
async function replaceContent(outDir, fill) {
  if (existsSync(outDir) && (await lstat(outDir)).isSymbolicLink())
    throw new Error('Refusing to replace content through a symlink');
  // Staged beside the output: a rename across drives (EXDEV) cannot swap the trees.
  const stagingRoot = join(dirname(resolve(outDir)), '.cache');
  await mkdir(stagingRoot, { recursive: true });
  await sweepStaleStaging(stagingRoot, CONTENT_STAGING_PREFIX);
  const staging = await mkdtemp(join(stagingRoot, CONTENT_STAGING_PREFIX));
  const previous = `${staging}-previous`;
  try {
    if (!(await fill(staging))) return false;
    if (existsSync(outDir)) await rename(outDir, previous);
    try {
      await rename(staging, outDir);
    } catch (error) {
      if (existsSync(previous)) await rename(previous, outDir);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
    return true;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function buildContent(zip, log, stamp, { outDir, dataRootOptions, convert = runPipeline }) {
  const dataRoot = await obtainPinnedDataRoot(zip, log, dataRootOptions);
  await replaceContent(outDir, async (staging) => {
    if (existsSync(join(outDir, 'music')))
      await cp(join(outDir, 'music'), join(staging, 'music'), { recursive: true });
    log(`running asset pipeline into ${staging}`);
    await convert(dataRoot, staging);
    await writeFile(join(staging, BUILD_STAMP_NAME), `${JSON.stringify(stamp, null, 2)}\n`);
    return true;
  });
  log(`${outDir} built from data.zip`);
}

/** Clone the primary checkout's content tree when its stamp matches this checkout's inputs. */
async function clonePrimaryContent(primaryOutDir, outDir, stamp, log, clone) {
  if (!(await contentIsCurrent(primaryOutDir, stamp))) return false;
  let made = false;
  const replaced = await replaceContent(outDir, async (staging) => {
    await rm(staging, { recursive: true, force: true });
    made = await cloneSettledTree(primaryOutDir, staging, clone);
    return made !== false;
  });
  if (replaced)
    log(
      `${outDir} ${made === 'clone' ? 'cloned' : 'copied'} from ${primaryOutDir}, built from the same inputs`,
    );
  return replaced;
}

function cachedArchivePath(outDir, archiveUrl) {
  const archiveName = basename(new URL(archiveUrl).pathname);
  if (archiveName === '') throw new Error(`cannot derive an archive name from ${archiveUrl}`);
  return join(outDir, archiveName);
}

async function downloadPinnedArchive(archiveUrl, archive, expectedDigest, log, fetchImpl) {
  try {
    await download(archiveUrl, archive, log, fetchImpl);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404)
      throw unpublishedPackError(expectedDigest, archiveUrl);
    throw error;
  }
}

function sha256MismatchError(path, actualDigest, expectedDigest) {
  return new Error(
    `${path} is not the pinned data archive: sha256 ${actualDigest}, expected ${expectedDigest}`,
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

async function cachedDataRoot(outDir, expectedDigest) {
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  if (!existsSync(unpackedDir) || !existsSync(stampPath)) return undefined;

  const actualDigest = (await readFile(stampPath, 'utf8')).trim();
  if (actualDigest !== expectedDigest) return undefined;

  try {
    await readDataPack(unpackedDir);
  } catch {
    return undefined;
  }
  return unpackedDir;
}

export async function obtainPinnedArchive(
  zip,
  log,
  {
    outDir = CACHE_DIR,
    expectedDigest = ARCHIVE_SHA256,
    archiveUrl = archiveUrlFor(expectedDigest),
    fetchImpl = fetch,
    consent = askDownloadConsent,
  } = {},
) {
  if (zip !== undefined) {
    log(`using local archive ${zip}`);
    await verifyArchiveSha256(zip, expectedDigest, log);
    return zip;
  }

  const downloadWithConsent = async (archive, why) => {
    // Nobody is asked to download a pack that does not exist yet.
    const head = await remoteHead(archiveUrl, fetchImpl);
    if (head?.status === 404) throw unpublishedPackError(expectedDigest, archiveUrl);
    const verdict = await consent({ archiveUrl, expectedDigest, sizeOf: () => remoteSize(head) });
    if (verdict !== 'accepted') throw new DownloadNotAccepted(verdict);
    log(`${why}, downloading ${archiveUrl} into ${archive}`);
    await downloadPinnedArchive(archiveUrl, archive, expectedDigest, log, fetchImpl);
  };

  const archive = cachedArchivePath(outDir, archiveUrl);
  await mkdir(outDir, { recursive: true });
  const cached = existsSync(archive);
  if (cached) log(`using cached archive ${archive}`);
  else await downloadWithConsent(archive, 'cached archive missing');

  try {
    await verifyArchiveSha256(archive, expectedDigest, log);
  } catch (error) {
    // The URL names the digest, so a fresh download that fails the pin would fail again; only a
    // stale cache earns a retry.
    if (!cached) throw error;
    await downloadWithConsent(archive, 'cached archive failed verification');
    await verifyArchiveSha256(archive, expectedDigest, log);
  }
  return archive;
}

export async function obtainPinnedDataRoot(
  zip,
  log,
  {
    outDir = CACHE_DIR,
    primaryOutDir = outDir === CACHE_DIR ? PRIMARY_CACHE_DIR : undefined,
    expectedDigest = ARCHIVE_SHA256,
    archiveUrl = archiveUrlFor(expectedDigest),
    fetchImpl = fetch,
    extractImpl = extractZip,
    clone = cloneTree,
    consent = askDownloadConsent,
  } = {},
) {
  const archive = await obtainPinnedArchive(zip, log, {
    outDir,
    archiveUrl,
    expectedDigest,
    fetchImpl,
    consent,
  });
  const cached = await cachedDataRoot(outDir, expectedDigest);
  if (cached !== undefined) {
    log(`using cached unpacked data ${cached}`);
    return cached;
  }

  await mkdir(outDir, { recursive: true });
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  const partialPrefix = `${UNPACKED_DIR_NAME}.part-`;
  await sweepStaleStaging(outDir, partialPrefix);
  const partialDir = await mkdtemp(join(outDir, partialPrefix));
  const primary =
    primaryOutDir === undefined ? undefined : await cachedDataRoot(primaryOutDir, expectedDigest);
  try {
    await rm(partialDir, { recursive: true, force: true });
    const made = primary === undefined ? false : await cloneSettledTree(primary, partialDir, clone);
    if (made) {
      log(
        `cached unpacked data missing or stale, ${made === 'clone' ? 'cloned' : 'copied'} ${primary} into ${unpackedDir}`,
      );
    } else {
      log(`cached unpacked data missing or stale, extracting ${archive} into ${unpackedDir}`);
      await mkdir(partialDir, { recursive: true });
      await extractImpl(archive, partialDir);
    }
    await readDataPack(partialDir);
    await rm(unpackedDir, { recursive: true, force: true });
    await rename(partialDir, unpackedDir);
    await writeFile(stampPath, `${expectedDigest}\n`);
    const cachedRoot = unpackedDir;
    log(`cached unpacked data at ${cachedRoot}`);
    return cachedRoot;
  } catch (error) {
    await rm(partialDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Builds `content/`. With `--if-stale` a current tree is kept, a linked worktree clones the primary
 * checkout's tree when it was built from the same inputs, and a download that is declined or cannot be
 * asked for ends with a note instead of an error, so CI and agent builds stay offline.
 */
export async function main({
  args = process.argv.slice(2),
  env = process.env,
  log = createLogger(),
  outDir = OUT_DIR,
  cacheDir = CACHE_DIR,
  primaryOutDir = outDir === OUT_DIR ? PRIMARY_OUT_DIR : undefined,
  primaryCacheDir = cacheDir === CACHE_DIR ? PRIMARY_CACHE_DIR : undefined,
  fetchImpl = fetch,
  consent = (request) => askDownloadConsent({ ...request, env }),
  convert = runPipeline,
  clone = cloneTree,
} = {}) {
  const ifStale = args.includes(IF_STALE_FLAG);
  if (args.some((arg) => arg !== IF_STALE_FLAG))
    throw new Error(`build:content takes only ${IF_STALE_FLAG}; set ON_DATA_ZIP in .env for local data`);
  const stamp = {
    archiveSha256: ARCHIVE_SHA256,
    irVersion: await currentIrVersion(),
    translations: await translationsDigest(),
  };
  if (ifStale && (await contentIsCurrent(outDir, stamp))) {
    log(`${outDir} is current`);
    return;
  }
  if (
    ifStale &&
    primaryOutDir !== undefined &&
    (await clonePrimaryContent(primaryOutDir, outDir, stamp, log, clone))
  )
    return;
  log('starting content build');
  try {
    await buildContent(localDataArchive(repoRoot, env), log, stamp, {
      outDir,
      // Only a development build clones the primary's unpacked pack; an explicit build, such as a
      // release's, extracts the archive it verified.
      dataRootOptions: {
        outDir: cacheDir,
        primaryOutDir: ifStale ? primaryCacheDir : undefined,
        fetchImpl,
        consent,
        clone,
      },
      convert,
    });
  } catch (error) {
    if (ifStale && error instanceof DownloadNotAccepted) {
      log(`content build skipped: ${error.message}`);
      return;
    }
    throw error;
  }
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
