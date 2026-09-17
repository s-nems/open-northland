import { readFile } from 'node:fs/promises';
import {
  cifBytesToSections,
  iniBytesToSections,
  type RuleSection,
  type SourceRef,
} from '../../decoders/ini.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

/**
 * Loads a `.cif`-only table at `relFile` (the mod ships patched copies of several base `.cif` tables)
 * and runs `extract` over its sections. An absent file degrades to `fallback`; a present but
 * undecodable one throws, so corrupt input is not mistaken for absent input.
 */
export async function loadCifTable<T>(
  roots: SourceRoots,
  relFile: string,
  extract: (sections: RuleSection[], src: SourceRef) => T,
  fallback: T,
): Promise<T> {
  return loadRuleTable(roots, relFile, cifBytesToSections, extract, fallback);
}

/** {@link loadCifTable} for a table the mod ships as readable `.ini` text instead. */
export async function loadIniTable<T>(
  roots: SourceRoots,
  relFile: string,
  extract: (sections: RuleSection[], src: SourceRef) => T,
  fallback: T,
): Promise<T> {
  return loadRuleTable(roots, relFile, iniBytesToSections, extract, fallback);
}

async function loadRuleTable<T>(
  roots: SourceRoots,
  relFile: string,
  toSections: (bytes: Uint8Array) => RuleSection[],
  extract: (sections: RuleSection[], src: SourceRef) => T,
  fallback: T,
): Promise<T> {
  const path = await resolveSourceFile(roots, relFile);
  if (path === undefined) return fallback;
  return extract(toSections(await readFile(path)), { file: relFile, layer: 'base' });
}
