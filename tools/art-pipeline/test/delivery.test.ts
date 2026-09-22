import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { approve } from '../src/approval.js';
import { buildAsset } from '../src/build.js';
import { candidate } from '../src/candidate.js';
import { hashes, writeJson } from '../src/files.js';
import { publish } from '../src/publish.js';
import { recipeSchema } from '../src/recipe.js';
import { review } from '../src/review.js';
import { mirrorSharedUi, recover } from '../src/transaction.js';

import { fixture, reviewed, roots } from './delivery-fixture.js';

describe('art delivery', () => {
  it('mirrors the runtime ui subtree to the shared copy the public game reads', async () => {
    const f = await fixture();
    const mirror = join(f.root, 'packages/app/src/assets/ui');
    await mkdir(join(f.runtime, 'ui/foundation'), { recursive: true });
    await writeFile(join(f.runtime, 'ui/foundation/surface.png'), 'next');
    await mkdir(join(mirror, 'retired'), { recursive: true });
    await writeFile(join(mirror, 'retired/old.png'), 'stale');
    await mirrorSharedUi(f.root);
    expect(await hashes(mirror)).toEqual(await hashes(join(f.runtime, 'ui')));
    await rm(join(f.runtime, 'ui'), { recursive: true });
    await mirrorSharedUi(f.root);
    await expect(readdir(mirror)).rejects.toThrow('ENOENT');
  });
  it('builds without touching runtime, publishes an approved complete candidate and repeats safely', async () => {
    const f = await fixture();
    const before = await hashes(f.runtime);
    const c = await reviewed(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(before);
    await publish(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(c.report.files);
    await publish(f.root, f.id);
    expect(await hashes(f.runtime)).toEqual(c.report.files);
  });
  it('rejects an unreviewed candidate and a review for another digest', async () => {
    const f = await fixture();
    await buildAsset(f.root, f.id);
    await expect(publish(f.root, f.id)).rejects.toThrow('visual approval');
    await expect(approve(f.root, f.id, '0'.repeat(64), 'reviewer')).rejects.toThrow('does not match');
    expect(await hashes(f.runtime)).toEqual({});
  });
  it('rejects source changes and edited build output', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
    await expect(publish(f.root, f.id)).rejects.toThrow('stale');
    await writeJson(join(f.source, 'runtime.json'), f.manifest);
    await writeFile(join(c.delivery, 'buildings/home/home.png'), 'broken');
    await expect(publish(f.root, f.id)).rejects.toThrow('bytes changed');
  });
  it('invalidates visual approval for calibration changes', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, scale: 0.75 });
    await buildAsset(f.root, f.id);
    await expect(publish(f.root, f.id)).rejects.toThrow('visual approval');
  });
  it('does not overwrite a file owned by another asset or an unregistered file', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await mkdir(join(f.runtime, 'buildings/home'), { recursive: true });
    await writeFile(join(f.runtime, 'buildings/home/home.png'), 'existing');
    await expect(publish(f.root, f.id)).rejects.toThrow('unowned');
    await rm(join(f.runtime, 'buildings/home/home.png'));
    await writeJson(join(f.root, 'docs/art/delivery.json'), {
      'buildings/other': ['buildings/home/home.png'],
    });
    await expect(publish(f.root, f.id)).rejects.toThrow('belongs to');
  });
  it('validates the combined pack before replacing the current delivery', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    const other = join(f.runtime, 'buildings/other');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'home.png'), await readFile(join(f.source, 'home.png')));
    await writeJson(join(other, 'runtime.json'), f.manifest);
    const before = await hashes(f.runtime);
    await expect(publish(f.root, f.id)).rejects.toThrow('Duplicate binding');
    expect(await hashes(f.runtime)).toEqual(before);
  });
  it('removes only obsolete owned files and retains unrelated valid assets', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    await writeFile(join(f.runtime, 'buildings/home/retired.png'), 'obsolete');
    await writeJson(join(f.root, 'docs/art/delivery.json'), {
      [f.id]: ['buildings/home/home.png', 'buildings/home/runtime.json', 'buildings/home/retired.png'],
    });
    const other = join(f.runtime, 'buildings/other');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'home.png'), await readFile(join(f.source, 'home.png')));
    await writeJson(join(other, 'runtime.json'), { ...f.manifest, typeId: 2, layer: 'other' });
    const before = await hashes(other);
    await publish(f.root, f.id);
    expect(await hashes(other)).toEqual(before);
    await expect(readFile(join(f.runtime, 'buildings/home/retired.png'))).rejects.toThrow();
  });
  it('recovers an interrupted directory swap and its ownership registry', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    const before = await hashes(f.runtime);
    const registry = await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8'),
      base = join(f.root, '.art-build/publication');
    await mkdir(base, { recursive: true });
    await rename(f.runtime, join(base, 'previous'));
    await mkdir(f.runtime);
    await writeFile(join(f.runtime, 'partial'), 'bad');
    await writeJson(join(f.root, 'docs/art/delivery.json'), {});
    await writeJson(join(base, 'journal.json'), { phase: 'swapped', registry });
    await recover(f.root);
    expect(await hashes(f.runtime)).toEqual(before);
    expect(await readFile(join(f.root, 'docs/art/delivery.json'), 'utf8')).toBe(registry);
  });
  it('rejects path traversal, duplicate outputs and escaping source symlinks', async () => {
    const f = await fixture();
    expect(() =>
      recipeSchema.parse({
        ...f.recipe,
        outputs: [{ path: '../escape.png', content: { operation: 'copy', source: 'home.png' } }],
      }),
    ).toThrow();
    expect(() =>
      recipeSchema.parse({ ...f.recipe, outputs: [...f.recipe.outputs, ...f.recipe.outputs] }),
    ).toThrow();
    const external = await mkdtemp(join(tmpdir(), 'art-external-'));
    roots.push(external);
    await writeFile(join(external, 'image.png'), 'external');
    await rm(join(f.source, 'home.png'));
    await symlink(join(external, 'image.png'), join(f.source, 'home.png'));
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('outside repository');
  });
  it('keeps approval stable across JSON formatting changes', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await writeFile(join(f.source, 'runtime.json'), JSON.stringify(f.manifest));
    await buildAsset(f.root, f.id);
    await publish(f.root, f.id);
    expect(Object.keys(await hashes(f.runtime))).toHaveLength(2);
  });
});

describe('candidate and recovery lifecycle', () => {
  it('cleans temporary delivery and releases its lock when the raster browser cannot start', async () => {
    const f = await fixture();
    await writeJson(join(f.source, 'asset.json'), {
      ...f.recipe,
      outputs: [
        {
          path: 'buildings/home/home.png',
          content: {
            operation: 'raster',
            width: 4,
            height: 4,
            alpha: 'transparent',
            draws: [{ source: 'home.png', box: [0, 0, 4, 4] }],
          },
        },
        f.recipe.outputs[1],
      ],
    });
    vi.spyOn(chromium, 'launch').mockRejectedValueOnce(new Error('Browser missing'));
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('Browser missing');
    expect((await readdir(join(f.root, '.art-build'))).filter((name) => name.startsWith('build-'))).toEqual(
      [],
    );
    expect(await readdir(join(f.root, '.art-build', f.id))).toEqual([]);
    expect(await hashes(f.runtime)).toEqual({});
  });
  it('shows JSON-only selection changes and removed owned files in the review', async () => {
    const f = await fixture();
    await reviewed(f.root, f.id);
    await publish(f.root, f.id);
    await writeJson(join(f.source, 'asset.json'), {
      ...f.recipe,
      kind: 'character',
      outputs: [
        { path: 'characters/job-selection.json', content: { operation: 'json', value: { smith: 'red' } } },
      ],
    });
    await buildAsset(f.root, f.id);
    const result = await review(f.root, f.id);
    const html = await readFile(result.path, 'utf8');
    expect(html).toContain('"path":"characters/job-selection.json","next":{"smith":"red"},"previous":null');
    expect(html).toContain('"path":"buildings/home/runtime.json","next":null,"previous":');
    expect(html).toContain('"path":"buildings/home/home.png","next":null,"previous":');
  });
  it('rebuilding repairs corrupted candidate bytes', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeFile(join(c.delivery, 'buildings/home/home.png'), 'corrupted');
    await buildAsset(f.root, f.id);
    expect((await candidate(f.root, f.id)).report.digest).toBe(c.report.digest);
  });
  it('a failed rebuild preserves the previous candidate', async () => {
    const f = await fixture();
    const c = await reviewed(f.root, f.id);
    await writeJson(join(f.source, 'runtime.json'), { ...f.manifest, width: 8 });
    await expect(buildAsset(f.root, f.id)).rejects.toThrow('dimensions');
    expect(await hashes(c.delivery)).toEqual(c.report.files);
    await writeJson(join(f.source, 'runtime.json'), f.manifest);
    expect((await candidate(f.root, f.id)).report.digest).toBe(c.report.digest);
  });
  it('recovery refuses to interrupt a live publishing process', async () => {
    const f = await fixture();
    await writeJson(join(f.root, '.art-build/publish.lock/owner.json'), { pid: process.pid });
    await expect(recover(f.root)).rejects.toThrow('still running');
    expect(await readFile(join(f.root, '.art-build/publish.lock/owner.json'), 'utf8')).toContain(
      String(process.pid),
    );
  });
});
