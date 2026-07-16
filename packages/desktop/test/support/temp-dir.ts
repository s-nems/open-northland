import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A disposable OS temp directory; `cleanup()` removes it recursively (call from `afterEach`). */
export interface TempDir {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** Makes an `opennorthland-desktop-<label>-XXXXXX` temp dir under the OS tmpdir. */
export async function makeTempDir(label: string): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), `opennorthland-desktop-${label}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
