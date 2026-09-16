import { join } from 'node:path';
import { z } from 'zod';
import { fingerprint, hashes, json } from './files.js';
import { assetId, relativePath } from './recipe.js';

export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reportSchema = z.object({
  version: z.literal(2),
  id: assetId,
  inputs: z.record(relativePath, hash),
  files: z.record(relativePath, hash),
  digest: hash,
  tools: z.record(z.string(), z.string()),
  chromiumVersion: z.string().nullable(),
  operations: z.array(z.unknown()),
  validation: z.object({ files: z.number().int().nonnegative(), bindings: z.number().int().nonnegative() }),
});

export class InvalidCandidate extends Error {}

export async function readBuiltCandidate(base: string, id: string) {
  const pointer = z
    .object({ digest: hash })
    .strict()
    .safeParse(await json(join(base, 'current.json')));
  if (!pointer.success) throw new InvalidCandidate('Invalid candidate pointer');
  const directory = join(base, pointer.data.digest);
  const parsed = reportSchema.safeParse(await json(join(directory, 'report.json')));
  if (!parsed.success) throw new InvalidCandidate('Missing or incompatible build report');
  const report = parsed.data;
  if (report.id !== id || report.digest !== pointer.data.digest)
    throw new InvalidCandidate('Candidate identity mismatch');
  const delivery = join(directory, 'delivery');
  const files = await hashes(delivery);
  if (fingerprint(files) !== report.digest || fingerprint(report.files) !== report.digest)
    throw new InvalidCandidate('Candidate bytes changed; rebuild');
  return { directory, delivery, report };
}
