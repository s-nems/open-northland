import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  archiveUrlFor,
  askDownloadConsent,
  buildContent,
  cloneSettledTree,
  cloneTree,
  contentIsCurrent,
  currentIrVersion,
  main,
  obtainPinnedArchive,
  obtainPinnedDataRoot,
  sweepStaleStaging,
  translationsDigest,
} from '../../content/build-content.mjs';
import { hash, syntheticPack } from '../support/data-pack.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pinnedSha256 = JSON.parse(await readFile(join(repoRoot, 'scripts/data-release.json'), 'utf8')).sha256;

test('prints stage logs to stderr before rejecting a non-pinned archive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const archive = join(dir, 'fake.zip');
  await writeFile(archive, 'definitely not the pinned data archive');

  const result = spawnSync(process.execPath, ['scripts/content/build-content.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, ON_DATA_ZIP: archive },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\[build-content\] \+\d+\.\d+s starting content build/);
  assert.match(result.stderr, new RegExp(`using local archive .*${basename(archive)}`));
  assert.match(result.stderr, new RegExp(`verifying sha256 of .*${basename(archive)}`));
  assert.match(result.stderr, /failed: .*is not the pinned data archive: sha256 /);
});

test('downloads the pinned digest from its own URL and names the cache after it', () => {
  const digest = 'a'.repeat(64);
  assert.equal(archiveUrlFor(digest), `https://opennorthland.org/data/${digest}.zip`);
});

test('fails before downloading when the pinned pack is not published', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-unpublished-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const expectedDigest = 'b'.repeat(64);
  const fetchImpl = async () => new Response('not found', { status: 404, statusText: 'Not Found' });

  await assert.rejects(
    obtainPinnedArchive(undefined, () => {}, { outDir: dir, expectedDigest, fetchImpl }),
    new RegExp(`pinned data pack ${expectedDigest} is not published at ${archiveUrlFor(expectedDigest)}`),
  );
  await assert.rejects(
    obtainPinnedArchive(undefined, () => {}, { outDir: dir, expectedDigest, fetchImpl }),
    /scripts\/data-release\.json is ahead of the publication/,
  );
});

test('caches the downloaded archive in content and reports progress', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  let requests = 0;
  const server = createServer((req, res) => {
    // The HEAD before the consent prompt is not a download.
    if (req.method === 'GET') requests++;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(payload.length));
    res.write(payload.subarray(0, 7));
    setTimeout(() => res.end(payload.subarray(7)), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const archiveUrl = `http://127.0.0.1:${server.address().port}/data-test.zip`;
  const firstLogs = [];
  let consents = 0;
  const consent = async () => {
    consents++;
    return 'accepted';
  };
  const archive = await obtainPinnedArchive(undefined, (message) => firstLogs.push(message), {
    outDir: dir,
    archiveUrl,
    expectedDigest,
    consent,
  });

  assert.equal(archive, join(dir, 'data-test.zip'));
  assert.equal(requests, 1);
  assert.equal(consents, 1);
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
    consent,
  });

  assert.equal(cached, archive);
  assert.equal(requests, 1);
  assert.equal(consents, 1);
  assert.match(secondLogs.join('\n'), /using cached archive /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached archive missing, downloading /);
});

test('reuses the unpacked data cache under content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-unpacked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const archive = join(dir, 'data.zip');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  await writeFile(archive, payload);

  let extracts = 0;
  const extractImpl = async (_archive, outDir) => {
    extracts++;
    await syntheticPack(outDir);
  };

  const firstLogs = [];
  const firstRoot = await obtainPinnedDataRoot(archive, (message) => firstLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(firstRoot, join(dir, 'unpacked'));
  assert.equal(extracts, 1);
  assert.match(firstLogs.join('\n'), /cached unpacked data missing or stale, extracting /);
  assert.match(firstLogs.join('\n'), /cached unpacked data at /);

  const secondLogs = [];
  const secondRoot = await obtainPinnedDataRoot(archive, (message) => secondLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(secondRoot, firstRoot);
  assert.equal(extracts, 1);
  assert.match(secondLogs.join('\n'), /using cached unpacked data /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached unpacked data missing or stale, extracting /);
});

test('repairs a modified unpacked cache and rejects a mismatching explicit archive without network', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'data-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'data.zip');
  await writeFile(archive, 'source');
  const expectedDigest = createHash('sha256').update('source').digest('hex');
  let extracts = 0;
  const options = {
    outDir: dir,
    expectedDigest,
    extractImpl: async (_, root) => {
      extracts++;
      await syntheticPack(root);
    },
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
  };
  const root = await obtainPinnedDataRoot(archive, () => {}, options);
  await writeFile(join(root, 'base/rules/types/example.ini'), 'tampered');
  await obtainPinnedDataRoot(archive, () => {}, options);
  assert.equal(extracts, 2);
  await writeFile(archive, 'bad');
  await assert.rejects(
    obtainPinnedDataRoot(archive, () => {}, options),
    /not the pinned data archive/,
  );
});

function ttyInput(answer) {
  const input = Readable.from([`${answer}\n`]);
  input.isTTY = true;
  return input;
}

function memoryOutput() {
  const chunks = [];
  return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join('') };
}

const consentRequest = {
  archiveUrl: 'https://example.invalid/data.zip',
  expectedDigest: 'abc123',
  sizeOf: async () => 2 * 1024 ** 3,
};

test('asks before a download and treats Enter as yes', async () => {
  const output = memoryOutput();
  const verdict = await askDownloadConsent({ ...consentRequest, env: {}, input: ttyInput(''), output });
  assert.equal(verdict, 'accepted');
  assert.match(output.text(), /https:\/\/example\.invalid\/data\.zip \(about 2\.0 GiB\)/);
  assert.match(output.text(), /sha256\s+abc123/);
  assert.match(output.text(), /rights holders/);
  assert.match(output.text(), /Download it now\? \[Y\/n\]/);
  assert.equal(
    await askDownloadConsent({ ...consentRequest, env: {}, input: ttyInput('n'), output: memoryOutput() }),
    'declined',
  );
  const closed = Readable.from([]);
  closed.isTTY = true;
  assert.equal(
    await askDownloadConsent({ ...consentRequest, env: {}, input: closed, output: memoryOutput() }),
    'declined',
  );
});

test('skips the prompt with ON_DATA_ACCEPT and reports an unattended run', async () => {
  const silent = ttyInput('n');
  const output = memoryOutput();
  assert.equal(
    await askDownloadConsent({ ...consentRequest, env: { ON_DATA_ACCEPT: '1' }, input: silent, output }),
    'accepted',
  );
  assert.equal(output.text(), '');
  const piped = Readable.from(['\n']);
  assert.equal(await askDownloadConsent({ ...consentRequest, env: {}, input: piped, output }), 'unattended');
  assert.equal(
    await askDownloadConsent({ ...consentRequest, env: { CI: 'true' }, input: ttyInput(''), output }),
    'unattended',
  );
  assert.equal(output.text(), '');
});

test('--if-stale keeps a tree stamped with the pinned archive and current IR version', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'content-stamp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outDir = join(dir, 'content');
  const stamp = {
    archiveSha256: pinnedSha256,
    irVersion: await currentIrVersion(),
    translations: await translationsDigest(),
  };
  assert.equal(await contentIsCurrent(outDir, stamp), false);
  await mkdir(outDir);
  await writeFile(join(outDir, 'ir.json'), '{}');
  await writeFile(join(outDir, 'build-stamp.json'), JSON.stringify(stamp));
  assert.equal(await contentIsCurrent(outDir, stamp), true);
  assert.equal(await contentIsCurrent(outDir, { ...stamp, irVersion: stamp.irVersion + 1 }), false);
  assert.equal(await contentIsCurrent(outDir, { ...stamp, translations: 'b'.repeat(64) }), false);

  const logs = [];
  const mustNotFetch = () => {
    throw new Error('must not fetch');
  };
  await main({
    args: ['--if-stale'],
    env: { ON_DATA_ZIP: '' },
    log: (message) => logs.push(message),
    outDir,
    cacheDir: join(dir, 'cache'),
    fetchImpl: mustNotFetch,
  });
  assert.match(logs.join('\n'), /is current$/);
  assert.doesNotMatch(logs.join('\n'), /starting content build/);
});

test('--if-stale skips the build when the download is declined or cannot be asked for', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'content-unattended-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    env: { ON_DATA_ZIP: '' },
    outDir: join(dir, 'content'),
    cacheDir: join(dir, 'cache'),
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
  };

  const logs = [];
  await main({
    ...options,
    args: ['--if-stale'],
    log: (message) => logs.push(message),
    consent: async () => 'unattended',
  });
  assert.match(logs.join('\n'), /content build skipped: downloading data\.zip needs a terminal/);
  assert.equal(existsSync(options.outDir), false);

  const declinedLogs = [];
  await main({
    ...options,
    args: ['--if-stale'],
    log: (message) => declinedLogs.push(message),
    consent: async () => 'declined',
  });
  assert.match(declinedLogs.join('\n'), /content build skipped: download declined/);

  await assert.rejects(
    main({ ...options, args: [], log: () => {}, consent: async () => 'declined' }),
    /download declined/,
  );
  await assert.rejects(
    main({ ...options, args: [], log: () => {}, consent: async () => 'unattended' }),
    /needs a terminal to confirm, ON_DATA_ACCEPT=1/,
  );
});

test('a fresh download that fails the pin is not downloaded again', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'content-bad-download-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requests = 0;
  let consents = 0;
  await assert.rejects(
    obtainPinnedArchive(undefined, () => {}, {
      outDir: dir,
      archiveUrl: 'http://127.0.0.1:9/data.zip',
      expectedDigest: hash('expected'),
      fetchImpl: async (_url, init) => {
        if (init?.method !== 'HEAD') requests++;
        return new Response('served something else', { status: 200 });
      },
      consent: async () => {
        consents++;
        return 'accepted';
      },
    }),
    /not the pinned data archive/,
  );
  assert.equal(requests, 1);
  assert.equal(consents, 1);
});

test('buildContent stamps the converted tree and replaces the previous one', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'content-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'data.zip');
  await writeFile(archive, 'source');
  const outDir = join(dir, 'content');
  await mkdir(outDir);
  await writeFile(join(outDir, 'stale.txt'), 'old tree');
  const stamp = { archiveSha256: hash('source'), irVersion: 7 };

  await buildContent(archive, () => {}, stamp, {
    outDir,
    dataRootOptions: {
      outDir: join(dir, 'cache'),
      expectedDigest: hash('source'),
      extractImpl: (_archive, root) => syntheticPack(root),
    },
    convert: (_dataRoot, out) => writeFile(join(out, 'ir.json'), '{}'),
  });

  assert.deepEqual(JSON.parse(await readFile(join(outDir, 'build-stamp.json'), 'utf8')), stamp);
  assert.equal(existsSync(join(outDir, 'stale.txt')), false);
  assert.equal(await contentIsCurrent(outDir, stamp), true);
});

/** A plain copy, what `cloneTree` makes where the file system cannot clone. */
const copyTree = async (source, target) => {
  await cp(source, target, { recursive: true });
  return 'copy';
};

/** A copy during which the source checkout swaps a rebuilt tree in at the same path, as its build does. */
const copyWhileSwapped = async (source, target) => {
  await copyTree(source, target);
  await rename(source, `${source}-replaced`);
  await cp(`${source}-replaced`, source, { recursive: true });
  return true;
};

test('--if-stale in a worktree clones the primary tree built from the same inputs, else builds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'content-primary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stamp = {
    archiveSha256: pinnedSha256,
    irVersion: await currentIrVersion(),
    translations: await translationsDigest(),
  };
  const primaryOutDir = join(dir, 'primary', 'content');
  await mkdir(primaryOutDir, { recursive: true });
  await writeFile(join(primaryOutDir, 'ir.json'), '{}');
  await writeFile(join(primaryOutDir, 'build-stamp.json'), JSON.stringify(stamp));
  const options = {
    args: ['--if-stale'],
    env: { ON_DATA_ZIP: '' },
    cacheDir: join(dir, 'cache'),
    primaryOutDir,
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
    convert: () => {
      throw new Error('must not convert');
    },
    consent: async () => 'unattended',
  };

  const outDir = join(dir, 'worktree', 'content');
  const logs = [];
  await main({ ...options, outDir, log: (message) => logs.push(message), clone: copyTree });
  assert.equal(await contentIsCurrent(outDir, stamp), true);
  assert.equal(await contentIsCurrent(primaryOutDir, stamp), true);
  assert.match(logs.join('\n'), /copied from .*primary/);
  assert.doesNotMatch(logs.join('\n'), /starting content build/);

  // The swapping case runs last: it leaves a new tree at the primary's path.
  const cases = [
    ['a primary tree of other inputs', { ...stamp, irVersion: stamp.irVersion + 1 }, copyTree],
    ['a primary tree that cannot be copied', stamp, async () => false],
    ['a primary tree swapped in during the clone', stamp, copyWhileSwapped],
  ];
  for (const [index, [why, primary, clone]] of cases.entries()) {
    await writeFile(join(primaryOutDir, 'build-stamp.json'), JSON.stringify(primary));
    const fresh = join(dir, `unbuilt-worktree-${index}`, 'content');
    const freshLogs = [];
    await main({ ...options, outDir: fresh, log: (message) => freshLogs.push(message), clone });
    assert.equal(existsSync(fresh), false, why);
    assert.match(freshLogs.join('\n'), /starting content build/, why);
  }
});

test("a worktree clones the primary checkout's unpacked data instead of extracting the archive", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'data-primary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'data.zip');
  await writeFile(archive, 'source');
  const expectedDigest = hash('source');
  const primaryOutDir = join(dir, 'primary-cache');
  await syntheticPack(join(primaryOutDir, 'unpacked'));
  await writeFile(join(primaryOutDir, 'unpacked.sha256'), `${expectedDigest}\n`);

  const logs = [];
  const root = await obtainPinnedDataRoot(archive, (message) => logs.push(message), {
    outDir: join(dir, 'cache'),
    primaryOutDir,
    expectedDigest,
    extractImpl: () => {
      throw new Error('must not extract');
    },
    clone: copyTree,
  });
  assert.equal(root, join(dir, 'cache', 'unpacked'));
  assert.match(logs.join('\n'), /copied .*primary-cache/);
  assert.equal((await readFile(join(dir, 'cache', 'unpacked.sha256'), 'utf8')).trim(), expectedDigest);
});

test('cloneTree clones or copies a tree, or leaves nothing behind', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clone-tree-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'source', 'nested'), { recursive: true });
  await writeFile(join(dir, 'source', 'nested', 'file.txt'), 'bytes');
  const target = join(dir, 'target');
  const made = await cloneTree(join(dir, 'source'), target);
  // APFS clones within one volume; ext4 or tmpfs cannot, and the tree is copied instead.
  if (process.platform === 'darwin') assert.equal(made, 'clone');
  else assert.match(made, /^(clone|copy)$/);
  assert.equal(await readFile(join(target, 'nested', 'file.txt'), 'utf8'), 'bytes');
  assert.equal(await cloneTree(join(dir, 'missing'), join(dir, 'nothing')), false);
  assert.equal(existsSync(join(dir, 'nothing')), false);
});

test('cloneTree keeps a relative link as a link', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clone-link-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(join(dir, 'source', 'file.txt'), 'bytes');
  await symlink('file.txt', join(dir, 'source', 'link.txt'));
  assert.ok(await cloneTree(join(dir, 'source'), join(dir, 'target')));
  assert.equal(await readlink(join(dir, 'target', 'link.txt')), 'file.txt');
});

test('sweepStaleStaging removes an interrupted build’s trees and keeps a fresh one', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-staging-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const HOUR_S = 60 * 60;
  const nowS = Date.now() / 1000;
  for (const name of ['content-old', 'content-old-previous', 'content-fresh', 'data']) {
    await mkdir(join(dir, name, 'nested'), { recursive: true });
  }
  for (const name of ['content-old', 'content-old-previous', 'data']) {
    await utimes(join(dir, name), nowS - 2 * HOUR_S, nowS - 2 * HOUR_S);
  }
  await sweepStaleStaging(dir, 'content-');
  assert.equal(existsSync(join(dir, 'content-old')), false);
  assert.equal(existsSync(join(dir, 'content-old-previous')), false);
  assert.equal(existsSync(join(dir, 'content-fresh')), true);
  assert.equal(existsSync(join(dir, 'data')), true);
  await sweepStaleStaging(join(dir, 'missing'), 'content-');
});

test('cloneSettledTree keeps a clone of a settled tree and drops one the source swapped meanwhile', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'clone-settled-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source');
  await mkdir(source);
  await writeFile(join(source, 'file.txt'), 'bytes');

  assert.equal(await cloneSettledTree(source, join(dir, 'kept'), copyTree), 'copy');
  assert.equal(await readFile(join(dir, 'kept', 'file.txt'), 'utf8'), 'bytes');
  assert.equal(await cloneSettledTree(source, join(dir, 'dropped'), copyWhileSwapped), false);
  assert.equal(existsSync(join(dir, 'dropped')), false);
});
