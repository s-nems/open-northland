import assert from 'node:assert/strict';
import test from 'node:test';
import { customArtPolicy, customArtRoot } from '../custom-art-policy.mjs';
import { isForbiddenGameFile } from '../game-asset-policy.mjs';

const recipe = 'docs/art/terrain/ferns/asset.json';
const image = 'props/fern/sprite.png';
const catalog = { version: 1, assets: [{ id: 'terrain/ferns', recipe }] };
const delivery = { 'terrain/ferns': [image] };
const source = {
  directory: 'docs/art/characters/shared/body',
  provenance: 'docs/art/characters/shared/body/README.md',
};
const tracked = new Set([recipe, `${customArtRoot}${image}`, source.provenance]);
const readJson = () => ({ id: 'terrain/ferns', sourceBasis: 'Independent generated artwork' });
function policy(c = catalog, d = delivery, shared = [source], read = readJson) {
  return customArtPolicy(c, d, shared, read, (path) => tracked.has(path));
}

test('admits registered sources and owned delivery, without opening neighbouring directories', () => {
  const accepts = policy();
  assert.ok(accepts('docs/art/terrain/ferns/source.png'));
  assert.ok(accepts('docs/art/characters/shared/body/model.glb'));
  assert.ok(accepts(`${customArtRoot}${image}`));
  assert.ok(!accepts('docs/art/terrain/ferns-other/source.png'));
  assert.ok(!accepts('docs/art/unregistered/source.png'));
  assert.ok(!accepts(`${customArtRoot}props/fern/unowned.png`));
  assert.ok(!accepts('packages/app/public/source.png'));
});

test('requires source provenance and matching recipe identity', () => {
  assert.throws(() => policy(catalog, delivery, [], () => ({ id: 'terrain/ferns' })), /source basis/);
  assert.throws(() => policy(catalog, delivery, [], () => ({ id: 'other', sourceBasis: 'custom' })), /id/);
  assert.throws(() => policy(catalog, delivery, [{ ...source, provenance: 'missing.md' }]), /source/);
});

test('rejects stale ownership, duplicate outputs and unregistered owners', () => {
  assert.throws(() => policy(catalog, { missing: [image] }), /owner/);
  assert.throws(() => policy(catalog, { 'terrain/ferns': ['missing.png'] }), /missing/);
  assert.throws(() => policy(catalog, { 'terrain/ferns': [image, image] }), /duplicate/);
});

test('rejects traversal and overly broad source roots', () => {
  for (const path of ['../file.png', '/file.png', 'a/../../file.png', 'a\\file.png', 'C:/file.png']) {
    assert.throws(() => policy(catalog, { 'terrain/ferns': [path] }), /Invalid/);
  }
  assert.throws(() => policy(catalog, delivery, [{ directory: 'docs/art', provenance: recipe }]), /source/);
  assert.throws(() => policy({ ...catalog, assets: [...catalog.assets, ...catalog.assets] }), /id/);
});

test('source registration cannot exempt original game formats from the independent ban', () => {
  const path = 'docs/art/terrain/ferns/original.cif';
  assert.ok(policy()(path));
  assert.ok(isForbiddenGameFile(path));
});
