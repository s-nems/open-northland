import { basename, extname } from 'node:path';

/** Extensions only original game material carries; nothing with one of these may be committed. */
const forbiddenGameExtensions = new Set([
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

/** True for a name that may never be committed, whatever it holds. */
export function isForbiddenGameFile(name) {
  const lower = name.toLowerCase();
  return forbiddenGameExtensions.has(extname(lower)) || basename(lower) === 'map.dat';
}
