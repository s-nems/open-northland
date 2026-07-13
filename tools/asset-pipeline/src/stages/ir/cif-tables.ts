import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeCifStringArray } from '../../decoders/cif.js';
import { cifLinesToSections, type RuleSection, type SourceRef } from '../../decoders/ini.js';

/**
 * Decodes a `.cif`-only table (no readable `.ini` twin — `pattern.cif`, `trianglepatterntypes.cif`)
 * into the shared {@link RuleSection} model, or `null` if the file is absent. Mirrors the
 * graceful-skip stance of {@link import('./sources.js').resolveIniSources}: a partial install still
 * produces an IR from whatever is present rather than aborting the batch.
 */
async function loadCifSections(path: string): Promise<RuleSection[] | null> {
  try {
    await access(path);
  } catch {
    return null;
  }
  const { lines } = decodeCifStringArray(new Uint8Array(await readFile(path)));
  return cifLinesToSections(lines);
}

/**
 * Loads a base-game `.cif`-only table at `gameDir/relFile` and runs `extract` over its sections,
 * returning `fallback` when the file is absent/undecodable (a partial install degrades per-table, not
 * fatally). Collapses the five identical load→guard→extract triples buildIr does for the pattern,
 * triangle, transition, landscape, and sound tables.
 */
export async function loadCifTable<T>(
  gameDir: string,
  relFile: string,
  extract: (sections: RuleSection[], src: SourceRef) => T,
  fallback: T,
): Promise<T> {
  const sections = await loadCifSections(join(gameDir, relFile));
  return sections ? extract(sections, { file: relFile, layer: 'base' }) : fallback;
}
