import { join } from 'node:path';
import { z } from 'zod';
import { candidate, hash } from './candidate.js';
import { json, writeJson } from './files.js';
import { lock } from './lock.js';
import { presentationDigest } from './presentation.js';
import { assetId, relativePath } from './recipe.js';
export const approvalSchema = z.record(
  assetId,
  z.object({ digest: hash, reviewer: z.string().min(1), basis: z.string().min(1) }).strict(),
);
export const deliverySchema = z.record(assetId, z.array(relativePath)).superRefine((registry, ctx) => {
  const owners = new Set<string>();
  for (const files of Object.values(registry))
    for (const file of files) {
      if (owners.has(file))
        ctx.addIssue({ code: 'custom', message: `Duplicate delivery ownership: ${file}` });
      owners.add(file);
    }
});
export async function approve(root: string, id: string, expected: string, reviewer: string) {
  hash.parse(expected);
  z.string().min(1).parse(reviewer);
  const current = await candidate(root, id),
    digest = await presentationDigest(current.delivery);
  if (digest !== expected) throw new Error('Review digest does not match candidate');
  const release = await lock(join(root, '.art-build/approve.lock'));
  try {
    const path = join(root, 'docs/art/approvals.json');
    const approvals = approvalSchema.parse(await json(path));
    approvals[id] = {
      digest,
      reviewer,
      basis: 'Explicit visual review of candidate pixels and presentation metadata',
    };
    await writeJson(path, approvals);
    return { id, digest };
  } finally {
    await release();
  }
}
