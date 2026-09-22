import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { candidate } from './candidate.js';
import { fingerprint, writeJson } from './files.js';
import { lock } from './lock.js';
import { inside, runtimePack } from './paths.js';
import { prepareDelivery } from './prepare.js';
import { exists } from './transaction.js';

async function stage(root: string, stages: string[], id: string, pack: string) {
  const current = await candidate(root, id);
  const directory = await mkdtemp(join(root, '.art-build/preview-'));
  stages.push(directory);
  const own = join(directory, 'custom');
  const { files } = await prepareDelivery(root, current, own, pack);
  return { directory, own, files };
}

// Several candidates stack onto one pack; the first id names the preview location.
export async function preparePreview(root: string, ids: readonly string[]) {
  const [first] = ids;
  if (first === undefined) throw new Error('preview needs at least one package id');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate preview id');
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const release = await lock(join(base, 'publish.lock'));
  const stages: string[] = [];
  try {
    if (await exists(join(base, 'publication/journal.json')))
      throw new Error('Interrupted publication: run art recover');
    let last = await stage(root, stages, first, runtimePack(root));
    for (const id of ids.slice(1)) last = await stage(root, stages, id, last.own);
    await writeJson(join(last.directory, 'report.json'), {
      version: 1,
      id: first,
      ids,
      files: last.files,
      digest: fingerprint(last.files),
    });
    const destination = join(inside(base, first), 'preview');
    await rm(destination, { recursive: true, force: true });
    await rename(last.directory, destination);
    return { ids, path: join(destination, 'custom') };
  } finally {
    for (const directory of stages) await rm(directory, { recursive: true, force: true });
    await release();
  }
}
