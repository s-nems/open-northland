import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAsset } from '../src/build.js';
import { hashes, writeJson } from '../src/files.js';
import { preparePreview } from '../src/preview.js';
import { publish } from '../src/publish.js';
import { fixture, reviewed } from './delivery-fixture.js';

describe('candidate preview', () => {
  it('previews unapproved art with the publication merge, retaining runtime and receipts', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    const before = await hashes(f.runtime);
    const approvals = await readFile(join(f.root, 'docs/art/approvals.json'), 'utf8');
    const registry = await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8');
    const other = join(f.runtime, 'buildings/other');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'home.png'), await readFile(join(f.source, 'home.png')));
    await writeJson(join(other, 'runtime.json'), { ...f.manifest, typeId: 2, layer: 'other' });
    const unrelated = await hashes(other);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
    await buildAsset(f.root, f.id);
    await expect(publish(f.root, f.id)).rejects.toThrow('visual approval');
    const preview = await preparePreview(f.root, [f.id]);
    expect(JSON.parse(await readFile(join(preview.path, 'buildings/home/runtime.json'), 'utf8')).scale).toBe(
      0.75,
    );
    expect(await hashes(join(preview.path, 'buildings/other'))).toEqual(unrelated);
    expect(await hashes(join(f.runtime, 'buildings/home'))).toEqual(
      Object.fromEntries(
        Object.entries(before).map(([path, hash]) => [path.replace('buildings/home/', ''), hash]),
      ),
    );
    expect(await readFile(join(f.root, 'docs/art/approvals.json'), 'utf8')).toBe(approvals);
    expect(await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8')).toBe(registry);
    const report = JSON.parse(await readFile(join(preview.path, '../report.json'), 'utf8'));
    expect(report.files).toEqual(await hashes(preview.path));
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 1 });
    await expect(preparePreview(f.root, [f.id])).rejects.toThrow('stale');
    expect(await hashes(preview.path)).toEqual(report.files);
  });
  it('stacks several candidates into one preview named by the first id', async () => {
    const f = await fixture();
    const second = join(f.root, 'docs/art/buildings/barn');
    await cp(f.source, second, { recursive: true });
    await writeJson(join(second, 'runtime.json'), { ...f.manifest, typeId: 2, layer: 'own-barn' });
    await writeJson(join(second, 'asset.json'), {
      ...f.recipe,
      id: 'buildings/barn',
      outputs: [
        { path: 'buildings/barn/home.png', content: { operation: 'copy', source: 'home.png' } },
        { path: 'buildings/barn/runtime.json', content: { operation: 'copy', source: 'runtime.json' } },
      ],
    });
    await writeJson(join(f.root, 'docs/art/assets.json'), {
      version: 1,
      assets: [
        { id: f.id, recipe: 'docs/art/buildings/home/asset.json' },
        { id: 'buildings/barn', recipe: 'docs/art/buildings/barn/asset.json' },
      ],
    });
    await buildAsset(f.root, f.id);
    await buildAsset(f.root, 'buildings/barn');
    const preview = await preparePreview(f.root, [f.id, 'buildings/barn']);
    expect(preview.path).toBe(join(f.root, '.art-build/buildings/home/preview/custom'));
    expect(JSON.parse(await readFile(join(preview.path, 'buildings/barn/runtime.json'), 'utf8')).typeId).toBe(
      2,
    );
    expect(JSON.parse(await readFile(join(preview.path, 'buildings/home/runtime.json'), 'utf8')).typeId).toBe(
      1,
    );
    const report = JSON.parse(await readFile(join(preview.path, '../report.json'), 'utf8'));
    expect(report.id).toBe(f.id);
    expect(report.ids).toEqual([f.id, 'buildings/barn']);
    expect(report.files).toEqual(await hashes(preview.path));
    expect(await hashes(f.runtime)).toEqual({});
    expect((await readdir(join(f.root, '.art-build'))).filter((n) => n.startsWith('preview-'))).toEqual([]);
    await expect(preparePreview(f.root, [f.id, f.id])).rejects.toThrow('Duplicate');
  });
  it('rejects a stacked candidate that overwrites an earlier stacked output', async () => {
    const f = await fixture();
    const second = join(f.root, 'docs/art/buildings/barn');
    await cp(f.source, second, { recursive: true });
    await writeJson(join(second, 'asset.json'), { ...f.recipe, id: 'buildings/barn' });
    await writeJson(join(f.root, 'docs/art/assets.json'), {
      version: 1,
      assets: [
        { id: f.id, recipe: 'docs/art/buildings/home/asset.json' },
        { id: 'buildings/barn', recipe: 'docs/art/buildings/barn/asset.json' },
      ],
    });
    await buildAsset(f.root, f.id);
    await buildAsset(f.root, 'buildings/barn');
    await expect(preparePreview(f.root, [f.id, 'buildings/barn'])).rejects.toThrow('unowned');
    expect((await readdir(join(f.root, '.art-build'))).filter((n) => n.startsWith('preview-'))).toEqual([]);
  });
  it('preview rejects an unowned collision without changing runtime', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    await mkdir(join(f.runtime, 'buildings/home'), { recursive: true });
    await writeFile(join(f.runtime, 'buildings/home/home.png'), 'unregistered');
    const before = await hashes(f.runtime);
    await expect(preparePreview(f.root, [f.id])).rejects.toThrow('unowned');
    expect(await hashes(f.runtime)).toEqual(before);
  });
});
