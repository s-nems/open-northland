import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readContentMod } from '../../../src/content/mods/archive.js';

const IR = parseContentSet({
  manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
  goods: [],
  jobs: [],
  buildings: [],
});

describe('content mod ZIPs', () => {
  it('loads content files from a wrapped folder after validating its IR', async () => {
    const archive = zipSync({
      'Northland Pack/content/ir.json': new TextEncoder().encode(JSON.stringify(IR)),
      'Northland Pack/content/bobs/custom.png': new Uint8Array([1, 2, 3]),
      'Northland Pack/readme.txt': new Uint8Array([4]),
    });
    const mod = await readContentMod('northland-pack.zip', archive);
    expect(mod.name).toBe('northland-pack');
    expect(mod.files.map(({ path }) => path).sort()).toEqual(['bobs/custom.png', 'ir.json']);
    expect(mod.files[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(mod.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a missing IR document and an invalid row with its failing field', async () => {
    await expect(readContentMod('empty.zip', zipSync({ 'readme.txt': new Uint8Array([1]) }))).rejects.toThrow(
      'content/ir.json',
    );
    await expect(
      readContentMod(
        'invalid.zip',
        zipSync({ 'content/ir.json': new TextEncoder().encode('{"goods":[{}]}') }),
      ),
    ).rejects.toThrow(/goods[\s\S]*id/);
  });
});
