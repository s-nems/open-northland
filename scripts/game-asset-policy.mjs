import { basename, extname } from 'node:path';

/**
 * Extensions only original game material carries. Nothing with one of these may be committed, and
 * nothing with one may appear in a deployment bundle: the site ships no game content.
 */
export const forbiddenGameExtensions = new Set([
  '.bmd',
  '.cif',
  '.cur',
  '.dll',
  '.dls',
  '.exe',
  '.fnt',
  '.hlt',
  '.lib',
  '.pcx',
  '.sgt',
  '.wav',
]);

/** Archives hide every rule above, so a deployment must not carry one either. */
const forbiddenArchiveExtensions = new Set(['.7z', '.cab', '.gz', '.rar', '.tar', '.tgz', '.zip']);

/** True for a name that may never be committed or deployed, whatever it holds. */
export function isForbiddenGameFile(name) {
  const lower = name.toLowerCase();
  return forbiddenGameExtensions.has(extname(lower)) || basename(lower) === 'map.dat';
}

/** The deployment rule: everything above, plus archives that could smuggle it past the check. */
export function isForbiddenInDeployment(name) {
  return isForbiddenGameFile(name) || forbiddenArchiveExtensions.has(extname(name.toLowerCase()));
}
