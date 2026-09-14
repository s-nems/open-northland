import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAsset } from '../src/build.js';
import { hashes, writeJson } from '../src/files.js';
import { preparePreview } from '../src/preview.js';
import { validateDelivery } from '../src/validate.js';
import { fixture } from './delivery-fixture.js';

const material = {
  id: 'mud',
  image: 'new-mud.png',
  tint: [1, 1, 1],
  wear: 0,
  pages: [],
  names: [],
  transitions: [],
};
const manifest = { sourceBasis: 'Synthetic fixture', materials: [material] };

async function terrainFixture() {
  const f = await fixture();
  await writeJson(join(f.source, 'asset.json'), {
    ...f.recipe,
    kind: 'terrain',
    outputs: [
      { path: 'terrain/new-mud.png', content: { operation: 'copy', source: 'home.png' } },
      { path: 'terrain/mud.json', content: { operation: 'json', value: manifest } },
    ],
  });
  return f;
}

describe('terrain delivery discovery', () => {
  it('builds and prepares a new material without changing runtime', async () => {
    const f = await terrainFixture();
    const before = await hashes(f.runtime);
    await buildAsset(f.root, f.id);
    const preview = await preparePreview(f.root, [f.id]);
    expect(await validateDelivery(preview.path, true)).toEqual({ files: 2, bindings: 1 });
    expect(JSON.parse(await readFile(join(preview.path, 'terrain/mud.json'), 'utf8'))).toEqual(manifest);
    expect(await hashes(f.runtime)).toEqual(before);
  });
  it('rejects a missing image in the complete pack but allows a cross-package candidate reference', async () => {
    const f = await fixture();
    await writeJson(join(f.runtime, 'terrain/mud.json'), manifest);
    await expect(validateDelivery(f.runtime)).resolves.toMatchObject({ bindings: 1 });
    await expect(validateDelivery(f.runtime, true)).rejects.toThrow('Missing terrain material image');
  });
  it('rejects duplicate material IDs before preparing a preview', async () => {
    const f = await terrainFixture();
    await buildAsset(f.root, f.id);
    await writeJson(join(f.runtime, 'terrain/other.json'), manifest);
    const before = await hashes(f.runtime);
    await expect(preparePreview(f.root, [f.id])).rejects.toThrow('Duplicate binding: material:mud');
    expect(await hashes(f.runtime)).toEqual(before);
  });
  it('rejects nested terrain files the runtime glob cannot discover', async () => {
    const f = await fixture();
    await mkdir(join(f.runtime, 'terrain/nested'), { recursive: true });
    await writeFile(join(f.runtime, 'terrain/nested/image.png'), await readFile(join(f.source, 'home.png')));
    await expect(validateDelivery(f.runtime, true)).rejects.toThrow('Terrain files must be flat');
  });
});
