import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentSet } from '@open-northland/data';
import { loadRealContent, mergeRealContent, type RealContentMerge } from '../../src/content/real-content.js';

/**
 * Shared plumbing for the manual real-content suite (`npm run test:content` / `test:pipeline` —
 * docs/TESTING.md "Real-content test modes"). The suite validates whatever content directory
 * `ON_CONTENT_DIR` points at (a fresh pipeline output under `test:pipeline`), defaulting to the
 * checkout's gitignored `content/`; every describe gates on {@link hasRealIr} so plain `npm test`
 * still skips cleanly on a bare checkout.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The content directory under test: `ON_CONTENT_DIR` (absolute, or relative to the repo root) when set, else `content/`. */
export function contentDir(): string {
  const override = process.env.ON_CONTENT_DIR;
  if (override === undefined || override === '') return resolve(REPO_ROOT, 'content');
  return isAbsolute(override) ? override : resolve(REPO_ROOT, override);
}

export function irPath(): string {
  return resolve(contentDir(), 'ir.json');
}

/** `describe.runIf` gate: the whole suite skips on a checkout without generated content. */
export function hasRealIr(): boolean {
  return existsSync(irPath());
}

/** The raw IR plus its sim-ready merge, loaded once per test run. */
export interface RealContentUnderTest {
  readonly real: ContentSet;
  readonly merge: RealContentMerge;
}

let underTest: Promise<RealContentUnderTest> | null = null;

/**
 * Parse the IR under test through the app's real boundary — `loadRealContent` (schema +
 * cross-reference validation) then `mergeRealContent` (clean-room balance overlays) — exactly the
 * path the browser entries run, so a break here is a break the game would hit. Memoized: the
 * multi-MB IR parses once for the whole suite.
 */
export function loadContentUnderTest(): Promise<RealContentUnderTest> {
  underTest ??= (async () => {
    const serveIr: typeof fetch = (input) =>
      Promise.resolve(
        String(input) === '/ir.json'
          ? new Response(readFileSync(irPath(), 'utf8'))
          : new Response(null, { status: 404 }),
      );
    const real = await loadRealContent(serveIr);
    if (real === null) throw new Error(`no ir.json at ${irPath()} — run via npm run test:content`);
    return { real, merge: mergeRealContent(real) };
  })();
  return underTest;
}
