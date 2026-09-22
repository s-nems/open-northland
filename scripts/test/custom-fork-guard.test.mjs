import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { forkChanges, forkViolation } from '../custom-fork-guard.mjs';

test('admits the fork paths and its whitelisted upstream edits', () => {
  for (const path of [
    'docs/art/buildings/farm/asset.json',
    'packages/app/src/custom/pack.ts',
    'packages/app/src/assets/custom/ui/foundation/icons.png',
    'scripts/custom-art-policy.mjs',
    'package-lock.json',
    'tsconfig.json',
  ])
    assert.equal(forkViolation(path), null, path);
});

test('rejects upstream files, near-miss names and an unpublished shared UI mirror', () => {
  assert.match(forkViolation('packages/app/src/entries/map/boot.ts'), /upstream file/);
  assert.match(forkViolation('packages/app/src/customised.ts'), /upstream file/);
  assert.match(forkViolation('scripts/custom-art-policy.mjs.bak'), /upstream file/);
  assert.match(forkViolation('packages/app/src/assets/ui/foundation/icons.png'), /shared HUD chrome/);
});

test('reports both sides of a file moved from upstream into a fork path', () => {
  const root = mkdtempSync(join(tmpdir(), 'fork-guard-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'guard@example.invalid');
    git('config', 'user.name', 'Guard');
    mkdirSync(join(root, 'packages/app/src'), { recursive: true });
    writeFileSync(join(root, 'packages/app/src/upstream.ts'), 'export const upstream = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'upstream');
    git('branch', 'upstream');
    mkdirSync(join(root, 'packages/app/src/custom'), { recursive: true });
    git('mv', 'packages/app/src/upstream.ts', 'packages/app/src/custom/upstream.ts');
    git('commit', '-q', '-m', 'move');
    const changed = forkChanges('upstream', root);
    assert.deepEqual(changed.sort(), ['packages/app/src/custom/upstream.ts', 'packages/app/src/upstream.ts']);
    assert.match(forkViolation('packages/app/src/upstream.ts'), /upstream file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
