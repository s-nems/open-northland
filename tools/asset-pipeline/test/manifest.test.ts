import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_MANIFEST,
  clearPipelineManifest,
  PIPELINE_MANIFEST_NAME,
  readPipelineManifest,
  writePipelineManifest,
} from '../src/manifest.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

/** The conversion stamp (`src/manifest.ts`): exact round-trip, and tolerant reads for anything else. */
describe('pipeline manifest', () => {
  let out: TempDir;

  beforeEach(async () => {
    out = await makeTempDir('manifest');
  });

  afterEach(async () => {
    await out.cleanup();
  });

  it('round-trips the current stamp', async () => {
    await writePipelineManifest(out.path);
    expect(await readPipelineManifest(out.path)).toEqual(CURRENT_MANIFEST);
  });

  it('clears a previous stamp so an interrupted rerun cannot pass as complete', async () => {
    await writePipelineManifest(out.path);
    await clearPipelineManifest(out.path);
    expect(await readPipelineManifest(out.path)).toBeUndefined();
    await clearPipelineManifest(out.path); // absent stamp (first run) is a no-op, not an error
  });

  it('reads absent or malformed stamps as undefined', async () => {
    expect(await readPipelineManifest(out.path)).toBeUndefined();
    await writeFile(join(out.path, PIPELINE_MANIFEST_NAME), 'not json');
    expect(await readPipelineManifest(out.path)).toBeUndefined();
    await writeFile(join(out.path, PIPELINE_MANIFEST_NAME), '{"irVersion":"x","contentRevision":1}');
    expect(await readPipelineManifest(out.path)).toBeUndefined();
  });
});
