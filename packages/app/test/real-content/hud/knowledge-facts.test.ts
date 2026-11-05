import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { FACTS, factText } from '../../../src/hud/knowledge/facts/index.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

describe.runIf(hasRealIr())('knowledge facts', () => {
  it('resolves every fact against the served content', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    expect(Object.keys(FACTS).filter((name) => factText(name, base) === undefined)).toEqual([]);
  });
});
