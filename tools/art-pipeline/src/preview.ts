import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { candidate } from './candidate.js';
import { fingerprint, writeJson } from './files.js';
import { lock } from './lock.js';
import { inside } from './paths.js';
import { prepareDelivery } from './prepare.js';
import { exists } from './transaction.js';

// Several candidates stack onto one pack; the first id names the preview location.
export async function preparePreview(root: string, ids: readonly string[]) {
  const [first] = ids;
  if (first === undefined) throw new Error('preview needs at least one package id');
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const release = await lock(join(base, 'publish.lock'));
  const stages: string[] = [];
  try {
    if (await exists(join(base, 'publication/journal.json')))
      throw new Error('Interrupted publication: run art recover');
    let pack = join(root, 'packages/app/src/assets/own');
    let files: Record<string, string> = {};
    for (const id of ids) {
      const current = await candidate(root, id);
      const stage = await mkdtemp(join(base, 'preview-'));
      stages.push(stage);
      ({ files } = await prepareDelivery(root, current, join(stage, 'own'), pack));
      pack = join(stage, 'own');
    }
    const last = stages.pop();
    if (last === undefined) throw new Error('preview needs at least one package id');
    await writeJson(join(last, 'report.json'), { version: 1, id: first, ids, files, digest: fingerprint(files) });
    const destination = join(inside(base, first), 'preview');
    await rm(destination, { recursive: true, force: true });
    await rename(last, destination);
    return { ids, path: join(destination, 'own') };
  } finally {
    for (const stage of stages) await rm(stage, { recursive: true, force: true });
    await release();
  }
}
