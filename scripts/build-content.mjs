#!/usr/bin/env node
/**
 * Builds `content/` from the CulturesNation archive a release ships: downloads it (or takes a local
 * copy with `--zip <file>`), verifies the SHA-256 that pins the release, unpacks it into a temporary
 * directory and runs the pipeline into a fresh `content/`. An existing `content/` is removed first.
 *
 * Usage: node scripts/build-content.mjs [--zip <file>]
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { repoRoot } from './content-dir.mjs';
import { extractZip } from './unzip.mjs';

const ARCHIVE_URL = 'https://game.opennorthland.org/cnmod.zip';
/** The archive's SHA-256 pins the mod release; the label is what that release calls itself. */
const ARCHIVE_SHA256 = '68537a89a972621f5dc400912e0c660bd875f649b693f3dad70d26f49465f043';
const MOD_VERSION = '1.3.2';
const OUT_DIR = resolve(repoRoot, 'content');

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

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
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

async function buildContent(zip) {
  const scratch = await mkdtemp(join(tmpdir(), 'cnmod-'));
  try {
    const archive = zip ?? join(scratch, 'cnmod.zip');
    if (zip === undefined) {
      console.log(`[build-content] downloading ${ARCHIVE_URL}`);
      await download(ARCHIVE_URL, archive);
    }
    const digest = await sha256File(archive);
    if (digest !== ARCHIVE_SHA256) {
      throw new Error(
        `${archive} is not the pinned CulturesNation archive: sha256 ${digest}, expected ${ARCHIVE_SHA256}`,
      );
    }
    console.log(`[build-content] sha256 verified, unpacking into ${scratch}`);
    const unpacked = join(scratch, 'mod');
    await extractZip(archive, unpacked);
    const modRoot = await unpackedRoot(unpacked);

    console.log(`[build-content] replacing ${OUT_DIR}`);
    await rm(OUT_DIR, { recursive: true, force: true });
    await run(
      'npm',
      ['run', 'pipeline', '--', '--mod-root', modRoot, '--mod-version', MOD_VERSION, '--out', OUT_DIR],
      repoRoot,
    );
    console.log(`[build-content] ${OUT_DIR} built from CulturesNation ${MOD_VERSION}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const { values } = parseArgs({ options: { zip: { type: 'string' } } });
// npm runs a root script with cwd set to the checkout; INIT_CWD is where the user typed the command.
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
try {
  await buildContent(values.zip === undefined ? undefined : resolve(invokedFrom, values.zip));
} catch (err) {
  console.error(`[build-content] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
