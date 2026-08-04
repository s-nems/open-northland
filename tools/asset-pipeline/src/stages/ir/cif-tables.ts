import { readFile } from 'node:fs/promises';
import { cifBytesToSections, type RuleSection, type SourceRef } from '../../decoders/ini.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

/**
 * Loads a `.cif`-only table at `relFile`, resolved overlay-first because the mod ships patched copies
 * of several base `.cif` tables, and runs `extract` over its sections. An absent file degrades to
 * `fallback`; a present but undecodable one throws, so corrupt input is not mistaken for absent input.
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
