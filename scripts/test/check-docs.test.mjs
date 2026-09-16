import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'on-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(path, text) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  await write('package.json', '{"type":"module","scripts":{}}');
  await write('docs/tickets/README.md', '# Tickets\n');
  await write('scripts/check-docs.mjs', '');
  await copyFile(new URL('../check-docs.mjs', import.meta.url), join(root, 'scripts/check-docs.mjs'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return {
    root,
    write,
    run: () => spawnSync(process.execPath, ['scripts/check-docs.mjs'], { cwd: root, encoding: 'utf8' }),
  };
}

test('checks new docs while excluding ignored scratch files and nested worktrees', async (t) => {
  const f = await fixture(t);
  await f.write('.gitignore', 'scratch/\n.claude/worktrees/\n');
  await f.write('scratch/broken.md', '[broken](missing.md)');
  await f.write('.claude/worktrees/task/README.md', '[broken](missing.md)');
  assert.equal(f.run().status, 0);
  await f.write('docs/new.md', '[broken](missing.md)');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/new.md: broken local link/);
  assert.doesNotMatch(result.stderr, /scratch|worktrees/);
});

test('checks tracked ignored files and tolerates working-tree deletions', async (t) => {
  const f = await fixture(t);
  await f.write('tracked.md', '[broken](missing.md)');
  execFileSync('git', ['add', 'tracked.md'], { cwd: f.root });
  await f.write('.gitignore', 'tracked.md\n');
  assert.equal(f.run().status, 1);
  await rm(join(f.root, 'tracked.md'));
  assert.equal(f.run().status, 0);
});

test('checks ticket references in source directories named content', async (t) => {
  const f = await fixture(t);
  const missing = ['docs', 'tickets', 'app', 'missing.md'].join('/');
  await f.write('packages/app/src/content/join.ts', `// ${missing}\n`);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /packages\/app\/src\/content\/join.ts: missing ticket/);
});
