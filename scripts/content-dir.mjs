// The content directory a manual mode runs against. Resolution rules mirror
// packages/app/test/content/helpers.ts `contentDir()` - keep them in step.
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');

export function contentDir() {
  const override = process.env.ON_CONTENT_DIR;
  if (override === undefined || override === '') return resolve(repoRoot, 'content');
  return isAbsolute(override) ? override : resolve(repoRoot, override);
}
