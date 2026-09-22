import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { customCharacterShadow } from '@open-northland/art-contracts/custom';
import { z } from 'zod';

const receipt = customCharacterShadow.extend({
  basis: z.string().min(1),
  /** Clip names in the shadow atlas's cell order, for the body packer to check against its own. */
  clips: z.array(z.string()).min(1).optional(),
  inputs: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});

export async function characterShadow(directory: string, source: string) {
  const raw = receipt.parse(JSON.parse(await readFile(resolve(directory, source), 'utf8')));
  const { inputs, basis: _basis, clips, ...manifest } = raw;
  if (!Object.keys(inputs).length) throw new Error('Shadow receipt has no source dependencies');
  for (const [file, expected] of Object.entries(inputs)) {
    const hash = createHash('sha256')
      .update(await readFile(resolve(directory, file)))
      .digest('hex');
    if (hash !== expected)
      throw new Error(`Stale character shadow: ${file}; re-export shadows after changing motion or geometry`);
  }
  return { manifest, clips, inputs: Object.keys(inputs).map((file) => resolve(directory, file)) };
}
