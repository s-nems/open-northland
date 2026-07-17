import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deliberately mirrors packages/desktop/test/support/temp-dir.ts: each package owns its test
// support, which is cheaper than a shared workspace package for fifteen lines.

/** A disposable OS temp directory; `cleanup()` removes it recursively (call from `afterEach`). */
export interface TempDir {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** Makes an `opennorthland-<label>-XXXXXX` temp dir under the OS tmpdir. */
export async function makeTempDir(label: string): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), `opennorthland-${label}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
