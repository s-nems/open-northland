import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { candidate } from './candidate.js';
import { fingerprint, writeJson } from './files.js';
import { lock } from './lock.js';
import { inside } from './paths.js';
import { prepareDelivery } from './prepare.js';
import { exists } from './transaction.js';

export async function preparePreview(root: string, id: string) {
  const base = join(root, '.art-build');
  await mkdir(base, { recursive: true });
  const release = await lock(join(base, 'publish.lock'));
  let temporary: string | undefined;
  try {
    if (await exists(join(base, 'publication/journal.json')))
      throw new Error('Interrupted publication: run art recover');
    const current = await candidate(root, id);
    temporary = await mkdtemp(join(base, 'preview-'));
    const { files } = await prepareDelivery(root, current, join(temporary, 'own'));
    await writeJson(join(temporary, 'report.json'), { version: 1, id, files, digest: fingerprint(files) });
    const destination = join(inside(base, id), 'preview');
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
    return { id, path: join(destination, 'own') };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await release();
  }
}
