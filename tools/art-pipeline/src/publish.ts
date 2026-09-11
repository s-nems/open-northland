import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { approvalSchema, deliverySchema } from './approval.js';
import { candidate } from './candidate.js';
import { fingerprint, hashes, json, listFiles } from './files.js';
import { lock as acquireLock } from './lock.js';
import { inside } from './paths.js';
import { presentationDigest } from './presentation.js';
import { exists, installDelivery } from './transaction.js';
import { validateDelivery } from './validate.js';
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
    const registry = deliverySchema.parse(await json(join(root, 'docs/art/delivery.json')));
    const registrySnapshot = JSON.stringify(registry);
    const next = Object.keys(current.report.files),
      owned = new Set(registry[id] ?? []);
    const runtime = join(root, 'packages/app/src/assets/own');
    const previousFiles = await hashes(runtime);
    const existing = new Set(Object.keys(previousFiles));
    for (const file of next) {
      if (existing.has(file) && !owned.has(file)) throw new Error(`Cannot overwrite unowned output: ${file}`);
      for (const [other, files] of Object.entries(registry))
        if (other !== id && files.includes(file)) throw new Error(`Output belongs to ${other}: ${file}`);
    }
    temporary = await mkdtemp(join(base, 'publish-'));
    const prepared = join(temporary, 'own');
    await cp(runtime, prepared, { recursive: true });
    for (const file of owned) await rm(inside(prepared, file), { force: true });
    for (const file of next) {
      const destination = inside(prepared, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(inside(current.delivery, file), destination);
    }
    // Empty retired slots must not look like runtime packages.
    for (const folder of new Set([...owned].map(dirname))) {
      if (folder === 'terrain') continue;
      const path = inside(prepared, folder);
      if ((await exists(path)) && (await listFiles(path)).length === 0) await rm(path, { recursive: true });
    }
    await validateDelivery(prepared, true);
    const latest = await candidate(root, id);
    if (latest.report.digest !== current.report.digest)
      throw new Error('Candidate changed during publication');
    const preparedFiles = await hashes(prepared);
    for (const file of next)
      if (preparedFiles[file] !== current.report.files[file])
        throw new Error('Prepared candidate bytes changed');
    if (fingerprint(await hashes(runtime)) !== fingerprint(previousFiles))
      throw new Error('Runtime changed during publication');
    if (
      JSON.stringify(deliverySchema.parse(await json(join(root, 'docs/art/delivery.json')))) !==
      registrySnapshot
    )
      throw new Error('Ownership registry changed during publication');
    const latestApproval = approvalSchema.parse(await json(join(root, 'docs/art/approvals.json')))[id];
    if (latestApproval?.digest !== approvals[id]?.digest)
      throw new Error('Approval changed during publication');
    registry[id] = next;
    await installDelivery(root, prepared, registry);
    return { id, files: next.length };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await release();
  }
}
