import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { approvalSchema } from './approval.js';
import { candidate } from './candidate.js';
import { json } from './files.js';
import { lock as acquireLock } from './lock.js';
import { prepareDelivery } from './prepare.js';
import { presentationDigest } from './presentation.js';
import { exists, installDelivery } from './transaction.js';
export async function publish(root: string, id: string) {
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const lock = join(base, 'publish.lock');
  const release = await acquireLock(lock);
  let temporary: string | undefined;
  try {
    if (await exists(join(base, 'publication/journal.json')))
      throw new Error('Interrupted publication: run art recover');
    const current = await candidate(root, id);
    const approvals = approvalSchema.parse(await json(join(root, 'docs/art/approvals.json')));
    if (approvals[id]?.digest !== (await presentationDigest(current.delivery)))
      throw new Error('Candidate needs visual approval; run art review');
    temporary = await mkdtemp(join(base, 'publish-'));
    const prepared = join(temporary, 'custom');
    const { registry } = await prepareDelivery(root, current, prepared);
    const latestApproval = approvalSchema.parse(await json(join(root, 'docs/art/approvals.json')))[id];
    if (latestApproval?.digest !== approvals[id]?.digest)
      throw new Error('Approval changed during publication');
    await installDelivery(root, prepared, registry);
    return { id, files: Object.keys(current.report.files).length };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await release();
  }
}
