import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A disposable OS temp directory; `cleanup()` removes it recursively. */
export interface TempDir {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function makeTempDir(label: string): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), `opennorthland-installer-${label}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
