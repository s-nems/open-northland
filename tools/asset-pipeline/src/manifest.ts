/**
 * The stamp `runPipeline` writes as its final step: the completion marker an interrupted conversion
 * never carries, and the staleness signal an installed shell compares against its own expectation.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IR_VERSION } from '@open-northland/data';

/**
 * Bump when a decoder or extraction change alters `content/` bytes without touching the IR schema
 * (IR_VERSION covers that leg). A mismatch reads as "regeneration recommended", so a forgotten bump
 * costs staleness detection, never correctness.
 */
export const CONTENT_REVISION = 4;

export const PIPELINE_MANIFEST_NAME = 'pipeline-manifest.json';

export interface PipelineManifest {
  readonly irVersion: number;
  readonly contentRevision: number;
}

/** What a conversion run by this build stamps; the baseline a stored manifest is compared against. */
export const CURRENT_MANIFEST: PipelineManifest = {
  irVersion: IR_VERSION,
  contentRevision: CONTENT_REVISION,
};

export async function writePipelineManifest(outDir: string): Promise<void> {
  await writeFile(join(outDir, PIPELINE_MANIFEST_NAME), `${JSON.stringify(CURRENT_MANIFEST, null, 2)}\n`);
}

/**
 * Drops a previous conversion's stamp before the first stage, so an interrupted rerun over existing
 * content degrades to "regenerate" instead of passing the mixed tree off as complete.
 */
export async function clearPipelineManifest(outDir: string): Promise<void> {
  await rm(join(outDir, PIPELINE_MANIFEST_NAME), { force: true });
}

/** The stamp of a previous conversion under `outDir`; absent or malformed reads as `undefined`. */
export async function readPipelineManifest(outDir: string): Promise<PipelineManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(outDir, PIPELINE_MANIFEST_NAME), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { irVersion, contentRevision } = parsed as Record<string, unknown>;
    if (typeof irVersion !== 'number' || typeof contentRevision !== 'number') return undefined;
    return { irVersion, contentRevision };
  } catch {
    return undefined;
  }
}
