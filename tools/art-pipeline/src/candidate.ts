import { join } from 'node:path';
import { z } from 'zod';
import { loadAsset } from './catalog.js';
import { fingerprint, hashes, json } from './files.js';
import { inputHashes } from './inputs.js';
import { inside } from './paths.js';
import { assetId, relativePath } from './recipe.js';
import { exists } from './transaction.js';
import { validateDelivery } from './validate.js';
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reportSchema = z.object({
  version: z.literal(1),
  id: assetId,
  inputs: z.record(relativePath, hash),
  files: z.record(relativePath, hash),
  digest: hash,
});
export async function candidate(root: string, id: string) {
  const base = inside(join(root, '.art-build'), id);
  if (await exists(join(base, 'build.lock'))) throw new Error('Asset build is running');
  const pointer = z
    .object({ digest: hash })
    .strict()
    .parse(await json(join(base, 'current.json')));
  const directory = join(base, pointer.digest),
    report = reportSchema.parse(await json(join(directory, 'report.json')));
  if (report.id !== id || report.digest !== pointer.digest) throw new Error('Candidate identity mismatch');
  const delivery = join(directory, 'delivery');
  const files = await hashes(delivery);
  if (fingerprint(files) !== report.digest || fingerprint(report.files) !== report.digest)
    throw new Error('Candidate bytes changed; rebuild');
  const asset = await loadAsset(root, id);
  if (fingerprint(await inputHashes(root, asset)) !== fingerprint(report.inputs))
    throw new Error('Candidate is stale; rebuild');
  const expected = asset.recipe.outputs.map((o) => o.path).sort();
  if (JSON.stringify(expected) !== JSON.stringify(Object.keys(files).sort()))
    throw new Error('Candidate files disagree with recipe');
  await validateDelivery(delivery);
  return { directory, delivery, report, asset };
}
