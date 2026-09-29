import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * What a save of this build needs to restore in another: the client sources (which fix the save
 * layout and how content is joined) and the generated IR the join reads. Null without content, so a
 * build that cannot vouch for its content never offers to carry a game over.
 */
export function restoreIdentity(clientBuild: string, contentRoot: string): string | null {
  const ir = join(contentRoot, 'ir.json');
  if (!existsSync(ir)) return null;
  return createHash('sha256').update(clientBuild).update('\n').update(readFileSync(ir)).digest('hex');
}

/** What `version.json` reports beside the build's own entry script: the release, and the identity a
 *  running game must share for its save to survive a reload into this build. */
export interface ServedBuildFile {
  readonly version: string;
  readonly restore: string | null;
}

const PAGE_ENTRY = 'index.html';

/**
 * Writes `version.json` beside `index.html`, so a host and an open tab can tell which build it serves.
 * `build` is the page's entry script, whose hashed name changes with any chunk it reaches: a release
 * rebuilt under the same version still reads as another build.
 */
export function emitVersionFile(served: ServedBuildFile): Plugin {
  return {
    name: 'emit-version-file',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (file) => file.type === 'chunk' && file.isEntry && file.facadeModuleId?.endsWith(PAGE_ENTRY) === true,
      );
      if (entry === undefined) this.error(`no entry chunk for ${PAGE_ENTRY}`);
      const file = { ...served, build: `/${entry.fileName}` };
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(file)}\n` });
    },
  };
}
