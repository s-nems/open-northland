import { readFile } from 'node:fs/promises';
import { cifBytesToSections, type RuleSection, type SourceRef } from '../../decoders/ini.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

/**
 * Loads a `.cif`-only table at `relFile` (no readable `.ini` twin — overlay-first, since the CnMod
 * zip ships patched copies of several base `.cif` tables) and runs `extract` over its sections,
 * returning `fallback` when the file is absent. Collapses the five identical load→guard→extract
 * triples buildIr does for the pattern, triangle, transition, landscape, and sound tables.
 *
 * An absent table degrades to `fallback`; a *present but undecodable* one throws and aborts the run
 * (see docs/tickets/pipeline/cif-table-decode-degrade.md).
 */
export async function loadCifTable<T>(
  roots: SourceRoots,
  relFile: string,
  extract: (sections: RuleSection[], src: SourceRef) => T,
  fallback: T,
): Promise<T> {
  const path = await resolveSourceFile(roots, relFile);
  if (path === undefined) return fallback;
  const sections = cifBytesToSections(await readFile(path));
  return extract(sections, { file: relFile, layer: 'base' });
}
