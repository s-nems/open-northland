import type { Plugin } from 'vite';

/** Reported by any build made without `ON_VERSION`. */
const DEV_VERSION = 'dev';
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The release version from `ON_VERSION`, a semantic version without the tag's `v`. */
export function gameVersion(value = process.env.ON_VERSION): string {
  if (value === undefined || value === '') return DEV_VERSION;
  if (!RELEASE_VERSION.test(value))
    throw new Error(`ON_VERSION must be a semantic version like 1.2.3, got "${value}"`);
  return value;
}

/** Writes `version.json` beside `index.html`, so a host can report which build it serves. */
export function emitVersionFile(version: string): Plugin {
  return {
    name: 'emit-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version })}\n` });
    },
  };
}
