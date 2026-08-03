import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Intentionally duplicated in packages/desktop/test/support: each package owns its test support.

export interface TempDir {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function makeTempDir(label: string): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), `opennorthland-${label}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
