import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { json, writeJson } from './files.js';
import { assertStopped } from './lock.js';
import { runtimePack, SHARED_UI, sharedUiMirror } from './paths.js';

const journalSchema = z
  .object({ phase: z.enum(['prepared', 'swapped', 'committed']), registry: z.string() })
  .strict();
export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function recover(root: string) {
  const locks = [];
  for (const name of ['publish.lock', 'approve.lock']) {
    const path = join(root, '.art-build', name);
    if (await exists(path)) {
      await assertStopped(path);
      locks.push(path);
    }
  }
  if (await exists(join(root, '.art-build/publication/journal.json'))) await restorePublication(root);
  else if (locks.length === 0) throw new Error('No interrupted publication');
  for (const path of locks) await rm(path, { recursive: true, force: true });
}
async function restorePublication(root: string) {
  const base = join(root, '.art-build/publication'),
    journalPath = join(base, 'journal.json');
  if (!(await exists(journalPath))) throw new Error('No interrupted publication');
  const journal = journalSchema.parse(await json(journalPath));
  const destination = runtimePack(root),
    backup = join(base, 'previous');
  if (journal.phase !== 'committed') {
    if (await exists(backup)) {
      await rm(destination, { recursive: true, force: true });
      await rename(backup, destination);
    }
    await writeFile(join(root, 'docs/art/delivery.json'), journal.registry);
  }
  await rm(base, { recursive: true, force: true });
  await mirrorSharedUi(root);
}
export async function mirrorSharedUi(root: string) {
  const source = join(runtimePack(root), SHARED_UI),
    mirror = sharedUiMirror(root);
  await rm(mirror, { recursive: true, force: true });
  if (await exists(source)) await cp(source, mirror, { recursive: true });
}
export async function installDelivery(root: string, prepared: string, registry: unknown) {
  const base = join(root, '.art-build/publication');
  await mkdir(base, { recursive: true });
  const journalPath = join(base, 'journal.json'),
    registryPath = join(root, 'docs/art/delivery.json');
  const previous = await readFile(registryPath, 'utf8');
  const journal = { phase: 'prepared', registry: previous };
  await writeJson(journalPath, journal);
  const destination = runtimePack(root),
    backup = join(base, 'previous');
  try {
    await rename(destination, backup);
    await rename(prepared, destination);
    await writeJson(journalPath, { ...journal, phase: 'swapped' });
    const next = join(base, 'delivery.json');
    await writeJson(next, registry);
    await rename(next, registryPath);
    await writeJson(journalPath, { ...journal, phase: 'committed' });
  } catch (error) {
    await restorePublication(root);
    throw error;
  }
  await rm(base, { recursive: true, force: true });
  await mirrorSharedUi(root);
}
