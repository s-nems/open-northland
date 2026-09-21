import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { obtainPinnedArchive, obtainPinnedModRoot } from '../build-content.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('prints stage logs to stderr before rejecting a non-pinned archive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const archive = join(dir, 'fake.zip');
  await writeFile(archive, 'definitely not the pinned CulturesNation archive');

  const result = spawnSync(process.execPath, ['scripts/build-content.mjs', '--zip', archive], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\[build-content\] \+\d+\.\d+s starting content build/);
  assert.match(result.stderr, new RegExp(`using local archive .*${basename(archive)}`));
  assert.match(result.stderr, new RegExp(`verifying sha256 of .*${basename(archive)}`));
  assert.match(result.stderr, /failed: .*is not the pinned CulturesNation archive: sha256 /);
});

test('caches the downloaded archive in content and reports progress', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(payload.length));
    res.write(payload.subarray(0, 7));
    setTimeout(() => res.end(payload.subarray(7)), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const archiveUrl = `http://127.0.0.1:${server.address().port}/cnmod-test.zip`;
  const firstLogs = [];
  const archive = await obtainPinnedArchive(undefined, (message) => firstLogs.push(message), {
    outDir: dir,
    archiveUrl,
    expectedDigest,
  });

  assert.equal(archive, join(dir, 'cnmod-test.zip'));
  assert.equal(requests, 1);
  assert.match(firstLogs.join('\n'), /cached archive missing, downloading /);
  assert.match(firstLogs.join('\n'), new RegExp(`download progress: 0 B / ${payload.length} B \\(0\\.0%\\)`));
  assert.match(
    firstLogs.join('\n'),
    new RegExp(`download progress: ${payload.length} B / ${payload.length} B \\(100\\.0%\\)`),
  );

  const secondLogs = [];
  const cached = await obtainPinnedArchive(undefined, (message) => secondLogs.push(message), {
    outDir: dir,
    archiveUrl,
    expectedDigest,
  });

  assert.equal(cached, archive);
  assert.equal(requests, 1);
  assert.match(secondLogs.join('\n'), /using cached archive /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached archive missing, downloading /);
});

test('reuses the unpacked mod cache under content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-unpacked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const archive = join(dir, 'cnmod.zip');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  await writeFile(archive, payload);

  let extracts = 0;
  const extractImpl = async (_archive, outDir) => {
    extracts++;
    await mkdir(join(outDir, 'CnMod 1.3.2', 'DataCnmd'), { recursive: true });
  };

  const firstLogs = [];
  const firstRoot = await obtainPinnedModRoot(archive, (message) => firstLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(firstRoot, join(dir, '.cnmod-unpacked', 'CnMod 1.3.2'));
  assert.equal(extracts, 1);
  assert.match(firstLogs.join('\n'), /cached unpacked mod missing or stale, extracting /);
  assert.match(firstLogs.join('\n'), /cached unpacked mod at /);

  const secondLogs = [];
  const secondRoot = await obtainPinnedModRoot(archive, (message) => secondLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(secondRoot, firstRoot);
  assert.equal(extracts, 1);
  assert.match(secondLogs.join('\n'), /using cached unpacked mod /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached unpacked mod missing or stale, extracting /);
});
