import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildTranslationModels, collectModelFiles } from '../translate-models/build.mjs';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'translation-models-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function fixture() {
  const bytes = Buffer.from('small pinned translation model');
  const file = {
    name: 'model.bin',
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/test/exported/model.bin.gz',
  };
  return { bytes, compressed: gzipSync(bytes), file };
}

test('collects shared model files once by their uncompressed SHA-256', () => {
  const { file } = fixture();
  const models = {
    first: { model: file, shortlist: file, vocabs: [file] },
    second: { model: file, shortlist: file, vocabs: [] },
  };
  assert.deepEqual(collectModelFiles(models), [file]);
});

test('downloads, verifies, caches and stages each unique gzip asset', async (t) => {
  const { bytes, compressed, file } = fixture();
  const root = await temporary(t);
  const cacheDir = join(root, 'cache');
  const outputDir = join(root, 'content', 'translate-models');
  const models = {
    'test-pair': { model: file, shortlist: file, vocabs: [file] },
  };
  let downloads = 0;
  const options = {
    models,
    cacheDir,
    outputDir,
    log: () => undefined,
    fetchImpl: async () => {
      downloads += 1;
      return new Response(compressed, { status: 200 });
    },
  };

  const first = await buildTranslationModels(options);
  assert.equal(first.fileCount, 1);
  assert.deepEqual(await readFile(join(outputDir, file.sha256 + '.gz')), compressed);
  assert.deepEqual(await readFile(join(cacheDir, file.sha256 + '.gz')), compressed);
  assert.equal(downloads, 1);

  await buildTranslationModels(options);
  assert.equal(downloads, 1);
  assert.deepEqual(await readFile(join(outputDir, file.sha256 + '.gz')), compressed);
  assert.equal(bytes.byteLength, file.bytes);
});

test('rejects a downloaded gzip whose uncompressed hash does not match the pin', async (t) => {
  const { compressed, file } = fixture();
  const root = await temporary(t);
  const models = { 'test-pair': { model: file, shortlist: file, vocabs: [] } };
  await assert.rejects(
    buildTranslationModels({
      models,
      cacheDir: join(root, 'cache'),
      outputDir: join(root, 'content', 'translate-models'),
      log: () => undefined,
      fetchImpl: async () => new Response(gzipSync(Buffer.from('tampered')), { status: 200 }),
    }),
    /sha-256/,
  );
});
