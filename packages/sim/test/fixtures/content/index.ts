import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { combatContent } from './combat.js';
import { economyContent } from './economy.js';
import { societyContent } from './societies.js';

/**
 * The manifest every synthetic fixture carries — boilerplate a `parseContentSet` call must satisfy but
 * that no test varies. Spread it rather than restating it, so a manifest schema change is one edit.
 */
export const TEST_MANIFEST = {
  version: IR_VERSION,
  generatedFrom: { game: 'synthetic-test-fixture' },
  locale: 'eng',
} as const;

/**
 * A tiny, hand-authored synthetic content set for deterministic tests. It contains no original
 * game assets; real extracted content stays outside the repository.
 */
export function testContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
  });
}
