import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deliverySchema } from './approval.js';
import { candidate } from './candidate.js';
import { fingerprint, hashes, json, listFiles } from './files.js';
import { inside } from './paths.js';
import { exists } from './transaction.js';
import { validateDelivery } from './validate.js';

export async function prepareDelivery(
  root: string,
  current: Awaited<ReturnType<typeof candidate>>,
  prepared: string,
  pack = join(root, 'packages/app/src/assets/own'),
) {
  const id = current.report.id;
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
  await cp(pack, prepared, { recursive: true });
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
    throw new Error('Candidate changed during delivery preparation');
  const preparedFiles = await hashes(prepared);
  for (const file of next)
    if (preparedFiles[file] !== current.report.files[file])
      throw new Error('Prepared candidate bytes changed');
  if (fingerprint(await hashes(runtime)) !== fingerprint(previousFiles))
    throw new Error('Runtime changed during delivery preparation');
  if (
    JSON.stringify(deliverySchema.parse(await json(join(root, 'docs/art/delivery.json')))) !==
    registrySnapshot
  )
    throw new Error('Ownership registry changed during delivery preparation');
  registry[id] = next;
  return { registry, files: preparedFiles };
}
