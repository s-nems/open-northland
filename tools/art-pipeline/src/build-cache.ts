import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { InvalidCandidate, readBuiltCandidate } from './build-report.js';
import { digest, fingerprint } from './files.js';

export async function buildTools(raster: boolean) {
  const tools: Record<string, string> = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os: release(),
    ...Object.fromEntries(
      Object.entries(sharp.versions).map(([name, version]) => [`sharp/${name}`, version]),
    ),
  };
  if (raster) {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('playwright-core/package.json');
    tools.playwright = digest(await readFile(manifest));
    // Default launches use the bundled headless shell pinned by this manifest.
    tools.chromium = digest(await readFile(join(dirname(manifest), 'browsers.json')));
  }
  return tools;
}

export async function cachedBuild(
  base: string,
  id: string,
  inputs: Record<string, string>,
  tools: Record<string, string>,
  outputs: string[],
) {
  try {
    const { report } = await readBuiltCandidate(base, id);
    if (fingerprint(report.inputs) !== fingerprint(inputs))
      return { reason: 'inputs, recipe or tool sources changed' };
    if (fingerprint(report.tools) !== fingerprint(tools)) return { reason: 'tool environment changed' };
    if (JSON.stringify(Object.keys(report.files).sort()) !== JSON.stringify([...outputs].sort()))
      return { reason: 'output list changed' };
    return { report, reason: 'inputs and output bytes unchanged' };
  } catch (error) {
    if (error instanceof InvalidCandidate || error instanceof SyntaxError) return { reason: error.message };
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { reason: 'candidate files missing' };
    throw error;
  }
}
