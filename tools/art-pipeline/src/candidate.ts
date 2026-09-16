import { join } from 'node:path';
import { readBuiltCandidate } from './build-report.js';
import { loadAsset } from './catalog.js';
import { fingerprint } from './files.js';

export { hash, reportSchema } from './build-report.js';

import { inputHashes } from './inputs.js';
import { inside } from './paths.js';
import { exists } from './transaction.js';
import { validateDelivery } from './validate.js';
export async function candidate(root: string, id: string) {
  const base = inside(join(root, '.art-build'), id);
  if (await exists(join(base, 'build.lock'))) throw new Error('Asset build is running');
  const { directory, delivery, report } = await readBuiltCandidate(base, id);
  const asset = await loadAsset(root, id);
  if (fingerprint(await inputHashes(root, asset)) !== fingerprint(report.inputs))
    throw new Error('Candidate is stale; rebuild');
  const expected = asset.recipe.outputs.map((o) => o.path).sort();
  if (JSON.stringify(expected) !== JSON.stringify(Object.keys(report.files).sort()))
    throw new Error('Candidate files disagree with recipe');
  await validateDelivery(delivery);
  return { directory, delivery, report, asset };
}
