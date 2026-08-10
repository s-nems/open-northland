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
