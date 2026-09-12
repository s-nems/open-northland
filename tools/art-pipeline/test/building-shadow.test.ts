import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeJson } from '../src/files.js';
import { validateDelivery } from '../src/validate.js';
import { fixture } from './delivery-fixture.js';

describe('building shadow delivery', () => {
  it('requires a transparent image with the declared canvas size', async () => {
    const f = await fixture();
    const folder = join(f.runtime, 'buildings/home');
    await mkdir(folder, { recursive: true });
    await copyFile(join(f.source, 'home.png'), join(folder, 'home.png'));
    const shadow = { sprite: 'shadow.png', width: 4, height: 4, entrancePixel: { x: 2, y: 3 } };
    await writeJson(join(folder, 'runtime.json'), { ...f.manifest, shadow });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('Missing image');
    await copyFile(join(f.source, 'home.png'), join(folder, 'shadow.png'));
    await expect(validateDelivery(f.runtime)).resolves.toEqual({ files: 3, bindings: 1 });
    await writeJson(join(folder, 'runtime.json'), { ...f.manifest, shadow: { ...shadow, width: 5 } });
    await expect(validateDelivery(f.runtime)).rejects.toThrow('dimensions');
  });
});
