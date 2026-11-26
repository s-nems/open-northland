#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { TRANSLATE_MODELS } from '../../packages/app/src/i18n/translate/model-files.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_DIR = resolve(ROOT, '.cache/translation-models');
const OUTPUT_DIR = resolve(ROOT, 'content/translate-models');
const MODEL_BUCKET_PREFIX = '/moz-fx-translations-data--303e-prod-translations-data/';
const DOWNLOAD_TIMEOUT_MS = 120_000;

function defaultLog(message) {
  process.stderr.write('[translate-models] ' + message + '\n');
}

function validateDefinition(file) {
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error('Invalid SHA-256 for translation model ' + file.name);
  }
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
    throw new Error('Invalid byte length for translation model ' + file.name);
  }
  const url = new URL(file.url);
  if (
    url.origin !== 'https://storage.googleapis.com' ||
    !url.pathname.startsWith(MODEL_BUCKET_PREFIX) ||
    !url.pathname.endsWith('/' + file.name + '.gz')
  ) {
    throw new Error('Untrusted translation model URL for ' + file.name);
  }
}

/** Collect each distinct uncompressed file once; shared vocabularies have one bundled copy. */
export function collectModelFiles(models = TRANSLATE_MODELS) {
  const unique = new Map();
  for (const model of Object.values(models)) {
    for (const file of [model.model, model.shortlist, ...model.vocabs]) {
      validateDefinition(file);
      const previous = unique.get(file.sha256);
      if (previous !== undefined && previous.bytes !== file.bytes) {
        throw new Error('Conflicting sizes for translation model hash ' + file.sha256);
      }
      if (previous === undefined) unique.set(file.sha256, file);
    }
  }
  return [...unique.values()].sort((a, b) => a.sha256.localeCompare(b.sha256));
}

/** Inflate one pinned gzip payload and prove that its uncompressed bytes match the registry. */
export function verifyCompressedModel(file, compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: file.bytes });
  if (bytes.byteLength !== file.bytes) {
    throw new Error(file.name + ': ' + bytes.byteLength + ' bytes, expected ' + file.bytes);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== file.sha256) {
    throw new Error(
      file.name + ': sha-256 ' + actual.slice(0, 16) + '…, expected ' + file.sha256.slice(0, 16) + '…',
    );
  }
  return bytes;
}

async function readCache(file, path, log) {
  let compressed;
  try {
    compressed = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    verifyCompressedModel(file, compressed);
    return compressed;
  } catch (error) {
    log('discarding invalid cache entry ' + file.sha256 + ': ' + String(error));
    await rm(path, { force: true });
    return null;
  }
}

async function writeAtomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.part-' + process.pid;
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function downloadModel(file, fetchImpl) {
  const response = await fetchImpl(file.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(file.url + ' answered HTTP ' + response.status + ' ' + response.statusText);
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  verifyCompressedModel(file, compressed);
  return compressed;
}

async function replaceOutput(staging, outputDir) {
  const current = await lstat(outputDir).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (current?.isSymbolicLink()) {
    throw new Error('Refusing to replace translation model output through a symlink');
  }

  const previous = outputDir + '.previous-' + process.pid;
  await rm(previous, { recursive: true, force: true });
  if (current !== null) await rename(outputDir, previous);
  try {
    await rename(staging, outputDir);
  } catch (error) {
    if (current !== null) await rename(previous, outputDir);
    throw error;
  }
  if (current !== null) await rm(previous, { recursive: true, force: true });
}

/**
 * Populate the ignored content tree from verified model gzip files. The cache keeps builds offline
 * after the first successful download; the staged output prevents a failed build leaving half a pack.
 */
export async function buildTranslationModels({
  models = TRANSLATE_MODELS,
  cacheDir = CACHE_DIR,
  outputDir = OUTPUT_DIR,
  fetchImpl = fetch,
  log = defaultLog,
} = {}) {
  const files = collectModelFiles(models);
  if (files.length === 0) throw new Error('No translation model files are configured');

  await mkdir(cacheDir, { recursive: true });
  await mkdir(dirname(outputDir), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputDir), '.translate-models-'));
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const cachedPath = join(cacheDir, file.sha256 + '.gz');
      let compressed = await readCache(file, cachedPath, log);
      if (compressed === null) {
        compressed = await downloadModel(file, fetchImpl);
        await writeAtomic(cachedPath, compressed);
        log('downloaded and verified ' + file.name + ' (' + (index + 1) + '/' + files.length + ')');
      } else {
        log('using cached ' + file.name + ' (' + (index + 1) + '/' + files.length + ')');
      }
      await copyFile(cachedPath, join(staging, file.sha256 + '.gz'));
    }

    await replaceOutput(staging, outputDir);
    return { fileCount: files.length, outputDir };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildTranslationModels();
    defaultLog('bundled ' + result.fileCount + ' unique files into ' + result.outputDir);
  } catch (error) {
    process.stderr.write('[translate-models] failed: ' + String(error) + '\n');
    process.exitCode = 1;
  }
}
