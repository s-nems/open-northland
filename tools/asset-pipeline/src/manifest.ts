import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IR_VERSION } from '@open-northland/data';

/**
 * The stamp `runPipeline` writes LAST into its output — both the completion marker (an interrupted
 * conversion never gets one) and the staleness signal an installed desktop shell compares against
 * its own bundled expectation to offer regeneration.
 */

/**
 * Bump when a decoder/extraction change alters `content/` bytes without touching the IR schema
 * (IR_VERSION covers that leg) — e.g. a fixed palette decode or a new atlas emission. An installed
 * shell treats a mismatch as "regeneration recommended", so forgetting a bump costs staleness
 * detection, never correctness.
 */
export const CONTENT_REVISION = 1;

export const PIPELINE_MANIFEST_NAME = 'pipeline-manifest.json';

export interface PipelineManifest {
  readonly irVersion: number;
  readonly contentRevision: number;
}

/** What a conversion run by THIS build of the pipeline stamps — the comparison baseline. */
export const CURRENT_MANIFEST: PipelineManifest = {
  irVersion: IR_VERSION,
  contentRevision: CONTENT_REVISION,
};

export async function writePipelineManifest(outDir: string): Promise<void> {
  await writeFile(join(outDir, PIPELINE_MANIFEST_NAME), `${JSON.stringify(CURRENT_MANIFEST, null, 2)}\n`);
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
