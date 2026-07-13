import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { combatContent } from './combat.js';
import { economyContent } from './economy.js';
import { societyContent } from './societies.js';

/**
 * A tiny, hand-authored synthetic content set for deterministic tests. It contains no original
 * game assets; real extracted content stays outside the repository.
 */
export function testContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    ...economyContent,
    ...combatContent,
    ...societyContent,
  });
}
