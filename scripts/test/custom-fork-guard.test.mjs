import assert from 'node:assert/strict';
import test from 'node:test';
import { forkViolation } from '../custom-fork-guard.mjs';

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
